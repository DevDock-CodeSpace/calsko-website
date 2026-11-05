// github-webhook: receives the Calsko GitHub App's webhooks.
//
// GitHub POSTs events here (no Supabase login; the gateway JWT check is off).
// Every request must carry a valid X-Hub-Signature-256 made with
// GITHUB_WEBHOOK_SECRET, and each X-GitHub-Delivery is handled once.
//
//   pull_request   A PR in a connected repo comes from a branch Calsko made
//                  for an issue (issue_branches), or mentions CAP-12 in its
//                  branch or title, or "fixes CAP-12" in its description → for each such
//                  issue in a project linked to that repo, record the PR and
//                  move the issue (public.github_apply_pull_request). "Done"
//                  = merged into one of that project's done branches
//                  (workspace_repos.done_branches; none = the default branch).
//                  A merged PR also carries along the PRs merged into its head
//                  branch earlier (feature → dev, then dev → main): those are
//                  tracked on to the new branch, and their issues become Done
//                  when it is a done branch (public.github_promote_merged).
//   installation   deleted → the group(s) lose that connection.
//   installation_repositories
//                  repos added/removed from the App on GitHub → mark them
//                  connected / not connected.
//
// Always answers 2xx for events it doesn't use, so GitHub doesn't retry them.
//
// Secret (set with `supabase secrets set`): GITHUB_WEBHOOK_SECRET, the same
// value as the App's webhook secret on GitHub.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { startErrorReporting } from '../_shared/report-errors.ts'

startErrorReporting('github-webhook')

type Repo = { id: number; default_branch?: string }
type PullRequest = {
  id: number
  number: number
  title: string
  body: string | null
  html_url: string
  state: 'open' | 'closed'
  draft?: boolean
  merged?: boolean
  head: { ref: string; repo: { id: number } | null }
  base: { ref: string; repo: Repo }
  user: { login: string } | null
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function validSignature(secret: string, body: Uint8Array, header: string | null) {
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.slice('sha256='.length)
  if (given.length !== expected.length) return false
  // Constant-time comparison.
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

/** CAP-12 in the branch (cap-12-add-login) or title; in the body only after fixes/closes/resolves. */
export function mentionedIssues(pr: Pick<PullRequest, 'title' | 'body' | 'head'>): { key: string; number: number }[] {
  const found = new Map<string, { key: string; number: number }>()
  const add = (key: string, n: string) => {
    const number = Number(n)
    if (Number.isSafeInteger(number) && number > 0) found.set(`${key.toUpperCase()}-${number}`, { key: key.toUpperCase(), number })
  }
  const ID = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})(?![0-9])/g
  for (const text of [pr.head.ref, pr.title]) for (const m of text.matchAll(ID)) add(m[1], m[2])
  const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})(?![0-9])/gi
  for (const m of (pr.body ?? '').matchAll(CLOSING)) add(m[1], m[2])
  return [...found.values()]
}

function prState(pr: PullRequest): 'draft' | 'open' | 'merged' | 'closed' {
  if (pr.state === 'closed') return pr.merged ? 'merged' : 'closed'
  return pr.draft ? 'draft' : 'open'
}

const PR_ACTIONS = new Set(['opened', 'reopened', 'ready_for_review', 'converted_to_draft', 'closed', 'edited'])

async function onPullRequest(admin: SupabaseClient, payload: Record<string, unknown>) {
  const action = payload.action as string
  const pr = payload.pull_request as PullRequest | undefined
  const installationId = (payload.installation as { id?: number } | undefined)?.id
  if (!PR_ACTIONS.has(action) || !pr || !installationId) return { ignored: action }

  const mentions = mentionedIssues(pr)

  // The repo in each group that's connected through *this* installation.
  const { data: repos, error } = await admin
    .from('repos')
    .select('id, workspace_repos(workspace_id, done_branches, workspaces(id, issue_key))')
    .eq('github_repo_id', pr.base.repo.id)
    .eq('installation_id', installationId)
  if (error) throw error

  const state = prState(pr)
  const defaultBranch = pr.base.repo.default_branch ?? 'main'
  const moved: string[] = []

  for (const repo of repos ?? []) {
    // Branches Calsko created: they keep matching even after a project
    // renames its issue key (wa-2-… on an issue that's now WEB-2).
    const { data: stored, error: storedError } = await admin
      .from('issue_branches')
      .select('issue_id, workspace_id')
      .eq('repo_id', repo.id)
      .eq('name', pr.head.ref)
    if (storedError) throw storedError

    type Link = { workspace_id: string; done_branches: string[]; workspaces: { issue_key: string } | null }
    for (const link of repo.workspace_repos as unknown as Link[]) {
      const key = link.workspaces?.issue_key
      const doneBranches = link.done_branches.length > 0 ? link.done_branches : [defaultBranch]
      const mergedIntoDone = state === 'merged' && doneBranches.includes(pr.base.ref)

      // This PR's head branch (same repo, not a fork) just got merged: the work
      // merged into it earlier moves on with it. A done branch merged back
      // (main → dev) carries nothing: that work is already finished.
      if (action === 'closed' && state === 'merged' && pr.head.repo?.id === pr.base.repo.id && !doneBranches.includes(pr.head.ref)) {
        const { data: released, error: promoteError } = await admin.rpc('github_promote_merged', {
          p_repo_id: repo.id,
          p_workspace_id: link.workspace_id,
          p_from_ref: pr.head.ref,
          p_to_ref: pr.base.ref,
          p_into_done: mergedIntoDone,
        })
        if (promoteError) throw promoteError
        for (const number of (released as number[] | null) ?? []) moved.push(`${key ?? '?'}-${number} → done`)
      }

      const numbers = mentions.filter((m) => m.key === key).map((m) => m.number)
      const storedIds = (stored ?? []).filter((b) => b.workspace_id === link.workspace_id).map((b) => b.issue_id)
      if (!key || (numbers.length === 0 && storedIds.length === 0)) continue
      // Mentioned by number, or created with this branch.
      const filters = [
        ...(numbers.length ? [`number.in.(${numbers.join(',')})`] : []),
        ...(storedIds.length ? [`id.in.(${storedIds.join(',')})`] : []),
      ]
      const { data: issues, error: issuesError } = await admin
        .from('issues')
        .select('id, number')
        .eq('workspace_id', link.workspace_id)
        .or(filters.join(','))
      if (issuesError) throw issuesError
      for (const issue of issues ?? []) {
        const { data: status, error: applyError } = await admin.rpc('github_apply_pull_request', {
          p_issue_id: issue.id,
          p_repo_id: repo.id,
          p_github_pr_id: pr.id,
          p_number: pr.number,
          p_title: pr.title,
          p_url: pr.html_url,
          p_state: state,
          p_head_ref: pr.head.ref,
          p_base_ref: pr.base.ref,
          p_author_login: pr.user?.login ?? null,
          p_merged_into_done: mergedIntoDone,
        })
        if (applyError) throw applyError
        moved.push(`${key}-${issue.number}${status ? ` → ${status}` : ''}`)
      }
    }
  }
  return { state, issues: moved }
}

async function onInstallation(admin: SupabaseClient, payload: Record<string, unknown>) {
  const id = (payload.installation as { id?: number } | undefined)?.id
  if (payload.action !== 'deleted' || !id) return { ignored: payload.action }
  // Repos keep existing and are marked not connected (FK sets installation_id null).
  const { error } = await admin.from('github_installations').delete().eq('installation_id', id)
  if (error) throw error
  return { disconnected: id }
}

/** An ilike pattern matching exactly this text, ignoring case ("_" is common in repo names). */
const likeExact = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

async function onInstallationRepositories(admin: SupabaseClient, payload: Record<string, unknown>) {
  const id = (payload.installation as { id?: number } | undefined)?.id
  if (!id) return { ignored: true }
  const repos = (key: string) => (payload[key] as { id: number; full_name?: string }[] | undefined) ?? []
  const ids = (key: string) => repos(key).map((r) => r.id)
  const removed = ids('repositories_removed')
  const added = ids('repositories_added')
  if (removed.length) {
    const { error } = await admin.from('repos').update({ installation_id: null }).eq('installation_id', id).in('github_repo_id', removed)
    if (error) throw error
  }
  if (added.length) {
    // Only in groups connected to this installation (the FK requires it too).
    const { data: teams, error } = await admin.from('github_installations').select('team_id').eq('installation_id', id)
    if (error) throw error
    for (const { team_id } of teams ?? []) {
      const { error: updateError } = await admin
        .from('repos')
        .update({ installation_id: id })
        .eq('team_id', team_id)
        .in('github_repo_id', added)
      if (updateError) throw updateError
      // Repos typed in by name before GitHub could see them get their GitHub id now.
      for (const repo of repos('repositories_added')) {
        const [owner, name] = (repo.full_name ?? '').split('/')
        if (!owner || !name) continue
        const { error: nameError } = await admin
          .from('repos')
          .update({ github_repo_id: repo.id, installation_id: id })
          .eq('team_id', team_id)
          .is('github_repo_id', null)
          .ilike('owner', likeExact(owner))
          .ilike('name', likeExact(name))
        if (nameError) throw nameError
      }
    }
  }
  return { added: added.length, removed: removed.length }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  const secret = Deno.env.get('GITHUB_WEBHOOK_SECRET')
  if (!secret) return reply({ error: 'not_configured' }, 503)

  const body = new Uint8Array(await req.arrayBuffer())
  if (!(await validSignature(secret, body, req.headers.get('X-Hub-Signature-256')))) {
    return reply({ error: 'bad_signature' }, 401)
  }

  const event = req.headers.get('X-GitHub-Event') ?? ''
  const delivery = req.headers.get('X-GitHub-Delivery') ?? ''
  if (event === 'ping') return reply({ ok: true })

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return reply({ error: 'bad_request' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Handle each delivery once (GitHub retries on errors and timeouts).
  if (delivery) {
    const { error } = await admin.from('github_webhook_deliveries').insert({ delivery_id: delivery, event })
    if (error?.code === '23505') return reply({ duplicate: true })
    if (error) console.error('[github-webhook] recording delivery failed', error)
  }

  try {
    let result: unknown = { ignored: event }
    if (event === 'pull_request') result = await onPullRequest(admin, payload)
    else if (event === 'installation') result = await onInstallation(admin, payload)
    else if (event === 'installation_repositories') result = await onInstallationRepositories(admin, payload)
    console.log(`[github-webhook] ${event}.${payload.action ?? ''}`, JSON.stringify(result))
    return reply(result)
  } catch (error) {
    console.error(`[github-webhook] ${event} failed`, error)
    // Let GitHub's retry (or a manual redelivery) try again.
    if (delivery) await admin.from('github_webhook_deliveries').delete().eq('delivery_id', delivery)
    return reply({ error: 'server_error' }, 500)
  } finally {
    // Keep the dedupe table small.
    if (Math.random() < 0.05) {
      await admin.from('github_webhook_deliveries').delete().lt('received_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    }
  }
})
