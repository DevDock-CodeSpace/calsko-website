// github: Calsko's side of the Calsko GitHub App. The App's private key and
// OAuth client secret never leave this function.
//
// POST { action, … } with the user's Supabase access token:
//   start    { teamId } → { state, authorizeUrl }
//     A one-time state (start_github_connect: owners/admins, 30 min, this
//     person) and GitHub's sign-in URL. Sign-in always comes back to
//     /github/callback, unlike the install page, which stays on GitHub when the
//     App is already installed on the account.
//   connect  { state, code?, installationId? } → connected | choose | install
//     Back from GitHub. A new install brings code + installationId; sign-in
//     brings code only, and we answer with the installations that person can
//     reach and the group lacks (kept on the state), to pick one with
//     { state, installationId }, or `install` when there are none. Every
//     installation is verified with the person's own GitHub token, so nobody
//     can attach someone else's. Saving it also matches existing repos.
//   repos    { teamId } → { repos: [{ githubRepoId, owner, name, private }] }
//     Repos the group's installations can reach (owners/admins only).
//   add_repo { teamId, githubRepoId } → { repo }
//     Adds (or connects) that repo in the group (owners/admins only), after
//     checking one of the group's installations can reach it.
//   create_branch { issueId } → { branch, created }
//     The issue's branch (wa-2-add-login) in its repo (or the project's only
//     repo), from the project's base branch. Anyone who can see the issue
//     (checked under their RLS). Adopts an existing branch of that name;
//     does nothing if the issue already has one.
//   sync_issue_hierarchy { issueId } → { issue, parent }
//     Creates (or finds) GitHub issues for the Calsko issue and its parent,
//     then makes GitHub's parent link match Calsko. Both must use the same repo.
//   branches { repoId } → { defaultBranch, branches }
//     Branch names, for picking a project's base and "done" branches.
//
// Errors: 400 bad_request / state_invalid · 401 unauthorized · 403 forbidden /
// installation_denied · 404 repo_not_found / not_found · 409 no_repo /
// repo_not_connected / base_missing · 502 github_error · 503 not_configured
//
// Secrets (set with `supabase secrets set`, never in the repo):
//   GITHUB_APP_ID         the App's ID (or its Client ID)
//   GITHUB_APP_PRIVATE_KEY the App's private key, converted to PKCS#8 PEM
//   GITHUB_CLIENT_ID      the App's Client ID (OAuth)
//   GITHUB_CLIENT_SECRET  an OAuth client secret generated for the App

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { importPKCS8, SignJWT } from 'npm:jose@6'
import { startErrorReporting } from '../_shared/report-errors.ts'

startErrorReporting('github')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STATE_MAX_AGE_MS = 30 * 60_000
// Overridable only so a local test can stand in for GitHub; never set in a deployed project.
const GITHUB_API = Deno.env.get('GITHUB_API_URL') ?? 'https://api.github.com'
const GITHUB_WEB = Deno.env.get('GITHUB_WEB_URL') ?? 'https://github.com'
const REPO_COLUMNS = 'id, team_id, owner, name, created_at, github_repo_id, installation_id'

type GitHubRepo = { id: number; name: string; private: boolean; owner: { login: string } }
type GitHubInstallation = { id: number; account: { login: string; type: string } | null }

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

// ------------------------------------------------------------------ GitHub

async function github<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Calsko',
      ...init.headers,
    },
  })
  if (!res.ok) {
    console.error(`[github] ${init.method ?? 'GET'} ${path} → ${res.status}`, await res.text())
    throw new HttpError(502, 'github_error')
  }
  return (await res.json()) as T
}

async function githubIssueRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'Calsko',
      ...init.headers,
    },
  })
  if (!res.ok) {
    const detail = await res.text()
    console.error(`[github] ${init.method ?? 'GET'} ${path} → ${res.status}`, detail)
    if (res.status === 403) throw new HttpError(403, 'issues_permission')
    throw new HttpError(502, 'github_error')
  }
  return (await res.json()) as T
}

async function githubIssueParent(path: string, token: string): Promise<{ id: number; number: number } | null> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'Calsko',
    },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    console.error(`[github] GET ${path} → ${res.status}`, await res.text())
    if (res.status === 403) throw new HttpError(403, 'issues_permission')
    throw new HttpError(502, 'github_error')
  }
  return (await res.json()) as { id: number; number: number }
}

type AppConfig = { appId: string; privateKey: string; clientId: string; clientSecret: string }

function appConfig(): AppConfig | null {
  const appId = Deno.env.get('GITHUB_APP_ID')
  // `supabase secrets set` may store the PEM's newlines as literal "\n".
  const privateKey = Deno.env.get('GITHUB_APP_PRIVATE_KEY')?.replace(/\\n/g, '\n')
  const clientId = Deno.env.get('GITHUB_CLIENT_ID')
  const clientSecret = Deno.env.get('GITHUB_CLIENT_SECRET')
  return appId && privateKey && clientId && clientSecret ? { appId, privateKey, clientId, clientSecret } : null
}

/** A 9-minute JWT that authenticates as the App itself. */
async function appJwt(config: AppConfig) {
  let key: CryptoKey
  try {
    key = await importPKCS8(config.privateKey, 'RS256')
  } catch (error) {
    console.error('[github] GITHUB_APP_PRIVATE_KEY must be a PKCS#8 PEM ("BEGIN PRIVATE KEY")', error)
    throw new HttpError(503, 'not_configured')
  }
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.appId)
    .setIssuedAt(now - 60) // GitHub allows for clock drift this way
    .setExpirationTime(now + 9 * 60)
    .sign(key)
}

/** A short-lived token acting as the App on one installation (its granted repos only). */
async function installationToken(config: AppConfig, installationId: number) {
  const { token } = await github<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    await appJwt(config),
    { method: 'POST' },
  )
  return token
}

async function installationRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = []
  for (let page = 1; page <= 20; page++) {
    const data = await github<{ repositories: GitHubRepo[] }>(`/installation/repositories?per_page=100&page=${page}`, token)
    repos.push(...data.repositories)
    if (data.repositories.length < 100) break
  }
  return repos
}

/** Exchanges the one-time OAuth code from the install redirect for the person's GitHub token. */
async function userToken(config: AppConfig, code: string) {
  const res = await fetch(`${GITHUB_WEB}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Calsko' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (!res.ok || !body.access_token) {
    console.error('[github] OAuth code exchange failed', res.status, body.error)
    throw new HttpError(400, 'state_invalid')
  }
  return body.access_token
}

async function userInstallations(token: string): Promise<GitHubInstallation[]> {
  const all: GitHubInstallation[] = []
  for (let page = 1; page <= 10; page++) {
    const data = await github<{ installations: GitHubInstallation[] }>(`/user/installations?per_page=100&page=${page}`, token)
    all.push(...data.installations)
    if (data.installations.length < 100) break
  }
  return all
}

// ---------------------------------------------------------------- database

async function requireAdmin(admin: SupabaseClient, teamId: string, userId: string) {
  const { data, error } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[github] role lookup failed', error)
    throw new HttpError(500, 'server_error')
  }
  if (data?.role !== 'owner' && data?.role !== 'admin') throw new HttpError(403, 'forbidden')
}

async function teamInstallationIds(admin: SupabaseClient, teamId: string): Promise<number[]> {
  const { data, error } = await admin.from('github_installations').select('installation_id').eq('team_id', teamId)
  if (error) {
    console.error('[github] installations lookup failed', error)
    throw new HttpError(500, 'server_error')
  }
  return data.map((r: { installation_id: number }) => r.installation_id)
}

type RepoRow = { id: string; owner: string; name: string; github_repo_id: number | null; installation_id: number | null }

/**
 * Records a GitHub repo in the group: the row already carrying its GitHub id,
 * else a row added by the same name before connecting, else a new row.
 */
async function upsertRepo(admin: SupabaseClient, teamId: string, installationId: number, repo: GitHubRepo, userId?: string) {
  const { data: rows, error } = await admin
    .from('repos')
    .select('id, owner, name, github_repo_id, installation_id')
    .eq('team_id', teamId)
  if (error) throw new HttpError(500, 'server_error')
  const lower = (s: string) => s.toLowerCase()
  const existing =
    (rows as RepoRow[]).find((r) => r.github_repo_id === repo.id) ??
    (rows as RepoRow[]).find(
      (r) => r.github_repo_id === null && lower(r.owner) === lower(repo.owner.login) && lower(r.name) === lower(repo.name),
    )
  const fields = { owner: repo.owner.login, name: repo.name, github_repo_id: repo.id, installation_id: installationId }
  const query = existing
    ? admin.from('repos').update(fields).eq('id', existing.id)
    : admin.from('repos').insert({ ...fields, team_id: teamId, created_by: userId ?? null })
  const { data, error: writeError } = await query.select(REPO_COLUMNS).single()
  if (writeError) {
    console.error('[github] saving repo failed', writeError)
    throw new HttpError(500, 'server_error')
  }
  return data
}

// ----------------------------------------------------------------- actions

type Installation = { id: number; login: string; type: 'User' | 'Organization' }

const toInstallation = (i: GitHubInstallation): Installation | null =>
  i.account ? { id: i.id, login: i.account.login, type: i.account.type === 'Organization' ? 'Organization' : 'User' } : null

/** The choices kept on a state (written by `connect`, but read back defensively). */
function savedInstallations(value: unknown): Installation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v) =>
    v && typeof v === 'object' && isId(v.id) && typeof v.login === 'string' && (v.type === 'User' || v.type === 'Organization')
      ? [{ id: v.id, login: v.login, type: v.type }]
      : [],
  )
}

/** Saves a verified installation for the group, then connects the repos it already has. */
async function saveInstallation(admin: SupabaseClient, config: AppConfig, teamId: string, userId: string, inst: Installation) {
  const { error: saveError } = await admin.from('github_installations').upsert({
    team_id: teamId,
    installation_id: inst.id,
    account_login: inst.login,
    account_type: inst.type,
    connected_by: userId,
  })
  if (saveError) {
    console.error('[github] saving installation failed', saveError)
    throw new HttpError(500, 'server_error')
  }

  // Connect repos the group already has (by GitHub id, or by name for ones typed in earlier).
  const { data: existing } = await admin.from('repos').select('owner, name, github_repo_id').eq('team_id', teamId)
  const rows = (existing ?? []) as RepoRow[]
  const known = (r: GitHubRepo) =>
    rows.some(
      (row) =>
        row.github_repo_id === r.id ||
        (row.owner.toLowerCase() === r.owner.login.toLowerCase() && row.name.toLowerCase() === r.name.toLowerCase()),
    )
  const reachable = await installationRepos(await installationToken(config, inst.id))
  for (const repo of reachable.filter(known)) {
    await upsertRepo(admin, teamId, inst.id, repo).catch((e) => console.error('[github] matching repo failed', e))
  }
}

/** A state for connecting the group, and where to send the person: GitHub sign-in, which always comes back. */
async function start(asUser: SupabaseClient, config: AppConfig, body: Record<string, unknown>) {
  const { teamId } = body
  if (!isUuid(teamId)) throw new HttpError(400, 'bad_request')
  const { data: state, error } = await asUser.rpc('start_github_connect', { p_team_id: teamId })
  if (error) {
    if (error.code === '42501') throw new HttpError(403, 'forbidden')
    console.error('[github] start_github_connect failed', error)
    throw new HttpError(500, 'server_error')
  }
  const authorizeUrl = `${GITHUB_WEB}/login/oauth/authorize?client_id=${encodeURIComponent(config.clientId)}&state=${state}`
  return { state: state as string, authorizeUrl }
}

/**
 * Back from GitHub with the state from `start`, in one of three ways:
 *  - { code, installationId }: a new install (GitHub signs them in on the way back);
 *  - { code }: GitHub sign-in only. Returns the installations they can reach that the group
 *    doesn't have yet, kept on the state: `choose` one, or `install` when there are none;
 *  - { installationId }: their pick from that list.
 * The state stays valid (same person, 30 minutes) until a connection is made.
 */
async function connect(admin: SupabaseClient, config: AppConfig, userId: string, body: Record<string, unknown>) {
  const { state, code, installationId } = body
  const hasCode = code !== undefined && code !== null
  const hasId = installationId !== undefined && installationId !== null
  if (!isUuid(state) || (hasCode && (typeof code !== 'string' || !code)) || (hasId && !isId(installationId)) || (!hasCode && !hasId)) {
    throw new HttpError(400, 'bad_request')
  }

  const { data: saved, error } = await admin
    .from('github_connect_states')
    .select('team_id, user_id, created_at, installations')
    .eq('state', state)
    .maybeSingle()
  if (error) throw new HttpError(500, 'server_error')
  if (!saved || saved.user_id !== userId || Date.now() - Date.parse(saved.created_at) > STATE_MAX_AGE_MS) {
    throw new HttpError(400, 'state_invalid')
  }
  const teamId: string = saved.team_id
  await requireAdmin(admin, teamId, userId)
  const { data: team } = await admin.from('teams').select('slug').eq('id', teamId).single()
  const teamSlug = team?.slug as string

  const finish = async (inst: Installation) => {
    await saveInstallation(admin, config, teamId, userId, inst)
    await admin.from('github_connect_states').delete().eq('state', state)
    return { kind: 'connected' as const, teamSlug, account: inst.login }
  }

  // A pick: only from the list this person's own GitHub token produced.
  if (!hasCode) {
    const inst = savedInstallations(saved.installations).find((i) => i.id === installationId)
    if (!inst) throw new HttpError(403, 'installation_denied')
    return finish(inst)
  }

  const reachable = (await userInstallations(await userToken(config, code as string))).flatMap((i) => toInstallation(i) ?? [])
  if (hasId) {
    // Verified with their token, so nobody can attach someone else's installation id.
    const inst = reachable.find((i) => i.id === installationId)
    if (!inst) throw new HttpError(403, 'installation_denied')
    return finish(inst)
  }

  const connectedIds = await teamInstallationIds(admin, teamId)
  const choices = reachable.filter((i) => !connectedIds.includes(i.id))
  const { error: keepError } = await admin.from('github_connect_states').update({ installations: choices }).eq('state', state)
  if (keepError) {
    console.error('[github] saving choices failed', keepError)
    throw new HttpError(500, 'server_error')
  }
  return {
    kind: choices.length > 0 ? ('choose' as const) : ('install' as const),
    teamSlug,
    accounts: choices.map((i) => ({ installationId: i.id, account: i.login, type: i.type })),
    connected: reachable.filter((i) => connectedIds.includes(i.id)).map((i) => i.login),
  }
}

async function listRepos(admin: SupabaseClient, config: AppConfig, userId: string, body: Record<string, unknown>) {
  const { teamId } = body
  if (!isUuid(teamId)) throw new HttpError(400, 'bad_request')
  await requireAdmin(admin, teamId, userId)
  const repos: { githubRepoId: number; owner: string; name: string; private: boolean }[] = []
  for (const installationId of await teamInstallationIds(admin, teamId)) {
    for (const r of await installationRepos(await installationToken(config, installationId))) {
      if (!repos.some((x) => x.githubRepoId === r.id)) {
        repos.push({ githubRepoId: r.id, owner: r.owner.login, name: r.name, private: r.private })
      }
    }
  }
  repos.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`, undefined, { sensitivity: 'base' }))
  return { repos }
}

async function addRepo(admin: SupabaseClient, config: AppConfig, userId: string, body: Record<string, unknown>) {
  const { teamId, githubRepoId } = body
  if (!isUuid(teamId) || !isId(githubRepoId)) throw new HttpError(400, 'bad_request')
  await requireAdmin(admin, teamId, userId)
  // Only a repo one of the group's installations was granted. (Not GET
  // /repositories/:id: installation tokens can read any public repo.)
  for (const installationId of await teamInstallationIds(admin, teamId)) {
    const granted = await installationRepos(await installationToken(config, installationId))
    const repo = granted.find((r) => r.id === githubRepoId)
    if (repo) return { repo: await upsertRepo(admin, teamId, installationId, repo, userId) }
  }
  throw new HttpError(404, 'repo_not_found')
}

// ----------------------------------------------------------------- branches

/** Same as issueBranchName() in src/features/issues/meta.ts: dock/wa-2-add-login-page. */
function branchName(key: string, number: number, title: string) {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `dock/${key.toLowerCase()}-${number}${slug ? `-${slug}` : ''}`
}

const refPath = (branch: string) => branch.split('/').map(encodeURIComponent).join('/')

type LinkedRepo = {
  repo_id: string
  base_branch: string | null
  repos: { id: string; github_repo_id: number | null; installation_id: number | null } | null
}

/** A connected repo's full name and default branch, with a token for it. */
async function connectedRepo(config: AppConfig, repo: { github_repo_id: number | null; installation_id: number | null } | null) {
  if (!repo?.github_repo_id || !repo.installation_id) throw new HttpError(409, 'repo_not_connected')
  const token = await installationToken(config, repo.installation_id)
  const info = await github<{ full_name: string; default_branch: string }>(`/repositories/${repo.github_repo_id}`, token)
  return { token, fullName: info.full_name, defaultBranch: info.default_branch }
}

async function createBranch(
  admin: SupabaseClient,
  asUser: SupabaseClient,
  config: AppConfig,
  userId: string,
  body: Record<string, unknown>,
) {
  const { issueId } = body
  if (!isUuid(issueId)) throw new HttpError(400, 'bad_request')

  // Read as the caller: if RLS hides the issue, they can't branch it.
  const { data: issue } = await asUser
    .from('issues')
    .select('id, workspace_id, number, title, repo_id, workspaces!issues_workspace_team_fkey(issue_key)')
    .eq('id', issueId)
    .maybeSingle()
  if (!issue) throw new HttpError(404, 'not_found')
  const { data: links } = await asUser
    .from('workspace_repos')
    .select('repo_id, base_branch, repos!workspace_repos_repo_fkey(id, github_repo_id, installation_id)')
    .eq('workspace_id', issue.workspace_id)
  const linked = (links ?? []) as unknown as LinkedRepo[]
  const link = issue.repo_id ? linked.find((l) => l.repo_id === issue.repo_id) : linked.length === 1 ? linked[0] : undefined
  if (!link) throw new HttpError(409, 'no_repo')

  const { data: existing } = await admin
    .from('issue_branches')
    .select('name, base, sha')
    .eq('issue_id', issue.id)
    .eq('repo_id', link.repo_id)
    .maybeSingle()
  if (existing) return { branch: existing, created: false }

  const repo = link.repos
  if (!repo || repo.github_repo_id === null || repo.installation_id === null) throw new HttpError(409, 'repo_not_connected')
  if (link.base_branch === null) throw new HttpError(409, 'base_branch_unset')
  const { token, fullName } = await connectedRepo(config, repo)
  const base = link.base_branch
  const key = (issue.workspaces as unknown as { issue_key: string }).issue_key
  const name = branchName(key, issue.number, issue.title)

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Calsko',
  }
  const baseRef = await fetch(`${GITHUB_API}/repos/${fullName}/git/ref/heads/${refPath(base)}`, { headers })
  if (baseRef.status === 404) throw new HttpError(409, 'base_missing')
  if (!baseRef.ok) throw new HttpError(502, 'github_error')
  const baseSha = ((await baseRef.json()) as { object: { sha: string } }).object.sha

  let sha = baseSha
  const created = await fetch(`${GITHUB_API}/repos/${fullName}/git/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: baseSha }),
  })
  const adopted = created.status === 422
  if (adopted) {
    // Already exists on GitHub (made by hand, or an earlier try): use it.
    const found = await github<{ object: { sha: string } }>(`/repos/${fullName}/git/ref/heads/${refPath(name)}`, token)
    sha = found.object.sha
  } else if (!created.ok) {
    console.error('[github] creating branch failed', created.status, await created.text())
    throw new HttpError(502, 'github_error')
  }

  const { error: saveError } = await admin.from('issue_branches').upsert(
    { issue_id: issue.id, workspace_id: issue.workspace_id, repo_id: link.repo_id, name, base, sha, created_by: userId },
    { onConflict: 'issue_id,repo_id', ignoreDuplicates: true },
  )
  if (saveError) {
    console.error('[github] saving branch failed', saveError)
    throw new HttpError(500, 'server_error')
  }
  // The project's only repo becomes the issue's repo (logged as the caller's change).
  if (!issue.repo_id) await asUser.from('issues').update({ repo_id: link.repo_id }).eq('id', issue.id)
  await admin
    .from('issue_activity')
    .insert({ issue_id: issue.id, workspace_id: issue.workspace_id, actor_id: userId, kind: 'branch_created', to_value: name })

  return { branch: { name, base, sha }, created: !adopted }
}

type CalskoIssue = {
  id: string
  workspace_id: string
  number: number
  title: string
  repo_id: string | null
  parent_id: string | null
  workspaces: { issue_key: string } | null
}

type GitHubIssueLink = {
  issue_id: string
  repo_id: string
  github_issue_id: number
  github_issue_number: number
  url: string
}

type IssueRepoLink = {
  repo_id: string
  repos: { id: string; owner: string; name: string; github_repo_id: number | null; installation_id: number | null } | null
}

async function readCalskoIssue(asUser: SupabaseClient, issueId: string): Promise<CalskoIssue> {
  const { data, error } = await asUser
    .from('issues')
    .select('id, workspace_id, number, title, repo_id, parent_id, workspaces!issues_workspace_team_fkey(issue_key)')
    .eq('id', issueId)
    .maybeSingle()
  if (error) {
    console.error('[github] reading issue for sync failed', error)
    throw new HttpError(500, 'server_error')
  }
  if (!data) throw new HttpError(404, 'not_found')
  return data as unknown as CalskoIssue
}

async function ensureGitHubIssue(
  admin: SupabaseClient,
  issue: CalskoIssue,
  repoId: string,
  repo: IssueRepoLink['repos'],
  token: string,
  fullName: string,
): Promise<GitHubIssueLink> {
  const { data: existing, error: existingError } = await admin
    .from('issue_github_links')
    .select('issue_id, repo_id, github_issue_id, github_issue_number, url')
    .eq('issue_id', issue.id)
    .maybeSingle()
  if (existingError) {
    console.error('[github] reading issue link failed', existingError)
    throw new HttpError(500, 'server_error')
  }
  if (existing) {
    if (existing.repo_id !== repoId) throw new HttpError(409, 'repo_mismatch')
    return existing as GitHubIssueLink
  }
  if (!repo) throw new HttpError(404, 'repo_not_found')

  const [owner, name] = fullName.split('/')
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const issueKey = `${issue.workspaces?.issue_key ?? 'ISSUE'}-${issue.number}`
  const marker = `calsko_issue_${issue.id.replace(/-/g, '')}`
  const search = await githubIssueRequest<{ items: { id: number; number: number; html_url: string }[] }>(
    `/search/issues?q=${encodeURIComponent(`repo:${fullName} is:issue in:body ${marker}`)}&per_page=2`,
    token,
  )
  if (search.items.length > 1) throw new HttpError(409, 'duplicate_issue')
  const remote =
    search.items[0] ??
    (await githubIssueRequest<{ id: number; number: number; html_url: string }>(`${repositoryPath}/issues`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${issueKey}: ${issue.title}`.slice(0, 256),
        body: `Managed from Calsko issue ${issueKey}.\n\n<!-- ${marker} -->`,
      }),
    }))

  const link: GitHubIssueLink = {
    issue_id: issue.id,
    repo_id: repoId,
    github_issue_id: remote.id,
    github_issue_number: remote.number,
    url: remote.html_url,
  }
  const { error: saveError } = await admin.from('issue_github_links').insert({
    ...link,
    workspace_id: issue.workspace_id,
  })
  if (saveError) {
    console.error('[github] saving GitHub issue link failed', saveError)
    throw new HttpError(500, 'server_error')
  }
  return link
}

async function syncIssueHierarchy(
  admin: SupabaseClient,
  asUser: SupabaseClient,
  config: AppConfig,
  issueId: string,
) {
  const issue = await readCalskoIssue(asUser, issueId)
  const repoId = issue.repo_id
  if (!repoId) throw new HttpError(409, 'no_repo')

  let parent: CalskoIssue | null = null
  if (issue.parent_id) {
    parent = await readCalskoIssue(asUser, issue.parent_id)
    if (parent.workspace_id !== issue.workspace_id) throw new HttpError(409, 'repo_mismatch')
    if (parent.repo_id !== repoId) throw new HttpError(409, 'repo_mismatch')
  }

  const { data: links, error: linksError } = await asUser
    .from('workspace_repos')
    .select('repo_id, repos!workspace_repos_repo_fkey(id, owner, name, github_repo_id, installation_id)')
    .eq('workspace_id', issue.workspace_id)
  if (linksError) {
    console.error('[github] reading issue repositories failed', linksError)
    throw new HttpError(500, 'server_error')
  }
  const repoLink = ((links ?? []) as unknown as IssueRepoLink[]).find((link) => link.repo_id === repoId)
  if (!repoLink?.repos) throw new HttpError(404, 'repo_not_found')

  const { token, fullName } = await connectedRepo(config, repoLink.repos)
  const childLink = await ensureGitHubIssue(admin, issue, repoId, repoLink.repos, token, fullName)
  const parentLink = parent
    ? await ensureGitHubIssue(admin, parent, repoId, repoLink.repos, token, fullName)
    : null
  const [owner, name] = fullName.split('/')
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const remoteParent = await githubIssueParent(
    `${repositoryPath}/issues/${childLink.github_issue_number}/parent`,
    token,
  )

  if (parentLink && remoteParent?.id !== parentLink.github_issue_id) {
    await githubIssueRequest(`${repositoryPath}/issues/${parentLink.github_issue_number}/sub_issues`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_issue_id: childLink.github_issue_id, replace_parent: true }),
    })
  } else if (!parentLink && remoteParent) {
    await githubIssueRequest(`${repositoryPath}/issues/${remoteParent.number}/sub_issue`, token, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_issue_id: childLink.github_issue_id }),
    })
  }

  return { issue: { number: childLink.github_issue_number, url: childLink.url }, parent: parentLink?.github_issue_number ?? null }
}

async function listBranches(asUser: SupabaseClient, config: AppConfig, body: Record<string, unknown>) {
  const { repoId } = body
  if (!isUuid(repoId)) throw new HttpError(400, 'bad_request')
  const { data: repo } = await asUser.from('repos').select('github_repo_id, installation_id').eq('id', repoId).maybeSingle()
  if (!repo) throw new HttpError(404, 'not_found')
  const { token, fullName, defaultBranch } = await connectedRepo(config, repo)
  const branches: string[] = []
  for (let page = 1; page <= 3; page++) {
    const data = await github<{ name: string }[]>(`/repos/${fullName}/branches?per_page=100&page=${page}`, token)
    branches.push(...data.map((b) => b.name))
    if (data.length < 100) break
  }
  return { defaultBranch, branches }
}

// ------------------------------------------------------------------ server

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const config = appConfig()
  if (!config) return json({ error: 'not_configured' }, 503)

  const accessToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await caller.auth.getUser(accessToken)
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401)
  const userId = userData.user.id

  // Reads that decide access run as the caller, under RLS.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Writes that clients may not make (installations, GitHub ids, branches) go
  // through the service role, after the checks in each action.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    switch (body.action) {
      case 'start':
        return json(await start(asUser, config, body))
      case 'connect':
        return json(await connect(admin, config, userId, body))
      case 'repos':
        return json(await listRepos(admin, config, userId, body))
      case 'add_repo':
        return json(await addRepo(admin, config, userId, body))
      case 'create_branch':
        return json(await createBranch(admin, asUser, config, userId, body))
      case 'sync_issue_hierarchy': {
        const { issueId } = body
        if (!isUuid(issueId)) throw new HttpError(400, 'bad_request')
        return json(await syncIssueHierarchy(admin, asUser, config, issueId))
      }
      case 'branches':
        return json(await listBranches(asUser, config, body))
      default:
        return json({ error: 'bad_request' }, 400)
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status)
    console.error('[github] unexpected error', error)
    return json({ error: 'server_error' }, 500)
  }
})
