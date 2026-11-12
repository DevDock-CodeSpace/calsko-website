import { FunctionsHttpError } from '@supabase/supabase-js'
import { queryOptions } from '@tanstack/react-query'
import { DataError, requireAffected, toDataError } from '@/lib/errors'
import { SETTLED_STALE_MS } from '@/lib/query-client'
import { supabase } from '@/lib/supabase'
import type { Database, Tables } from '@/types/database.types'
import { logError } from '@/lib/error-tracking'

export type TeamRole = Database['public']['Enums']['team_role'] | 'developer'
export type TeamType = Database['public']['Enums']['team_type']
export type Team = Pick<Tables<'teams'>, 'id' | 'name' | 'slug' | 'type' | 'logo_path' | 'teachers_set_prices'>
/** `features`: the keys of the feature flags switched on for the group (features/flags). */
export type TeamMembership = { role: TeamRole; joinedAt: string; team: Team; features: readonly string[] }
export type Invite = Pick<
  Tables<'team_invites'>,
  'id' | 'code' | 'created_at' | 'expires_at' | 'max_uses' | 'use_count'
>
export type PersonProfile = { display_name: string | null; avatar_url: string | null } | null
export type TeamMember = { user_id: string; role: TeamRole; joined_at: string; profile: PersonProfile }

type MembershipRow = { role: TeamRole; joined_at: string; team: Team & { enabled_features: string[] | null } }

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ---------------------------------------------------------------- queries

/** Teams the user belongs to, with their role in each. Empty → onboarding. */
export const myTeamsQuery = (userId: string) =>
  queryOptions({
    queryKey: ['teams', 'mine', userId],
    staleTime: SETTLED_STALE_MS,
    queryFn: async (): Promise<TeamMembership[]> => {
      const { data, error } = await supabase
        .from('team_members')
        // enabled_features is a computed column (public.enabled_features): the group's flags ride along
        // with the groups, so they cost no request of their own. The generated types can't see it.
        .select('role, joined_at, team:teams(id, name, slug, type, logo_path, teachers_set_prices, enabled_features)')
        .eq('user_id', userId)
        .order('joined_at')
        .overrideTypes<MembershipRow[], { merge: false }>()
      if (error) throw toDataError('load your groups', error)
      return data.map(({ role, joined_at, team: { enabled_features, ...team } }) => ({
        role,
        joinedAt: joined_at,
        team,
        features: enabled_features ?? [],
      }))
    },
  })

export const teamMembersQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['teams', teamId, 'members'],
    staleTime: SETTLED_STALE_MS,
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from('team_members')
        .select('user_id, role, joined_at, profile:profiles(display_name, avatar_url)')
        .eq('team_id', teamId)
        .order('joined_at')
      if (error) throw toDataError('load group members', error)
      return data
    },
  })

export const invitesQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['teams', teamId, 'invites'],
    queryFn: async (): Promise<Invite[]> => {
      const { data, error } = await supabase
        .from('team_invites')
        .select('id, code, created_at, expires_at, max_uses, use_count')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })
      if (error) throw toDataError('load invites', error)
      return data
    },
  })

// -------------------------------------------------------------- mutations

export async function createTeam(input: { name: string; slug: string; type: TeamType }): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .insert({ name: input.name.trim(), slug: input.slug, type: input.type })
    .select('id, name, slug, type, logo_path, teachers_set_prices')
    .single()
  if (error) {
    throw toDataError('create the group', error, {
      '23505': 'That group URL is already taken. Try another.',
      '23514': 'Use 3–48 lowercase letters, numbers, and single dashes for the URL.',
    })
  }
  return data
}

/**
 * Joins with any code a person is given: a group invite joins the group; a course code joins the group
 * and enrolls in that one course (join_with_code). Already in → same result, no error.
 */
export async function joinTeam(inviteCode: string): Promise<{ teamId: string; courseId: string | null }> {
  const { data, error } = await supabase.rpc('join_with_code', { p_code: inviteCode })
  if (error) {
    throw toDataError('join the group', error, {
      P0001: 'That code is invalid, expired, already used, or has no uses left.',
    })
  }
  const result = data as { team_id: string; workspace_id: string | null }
  return { teamId: result.team_id, courseId: result.workspace_id }
}

/** Whether teachers price and publish their own courses (else only owners and admins). */
export async function setTeachersSetPrices(teamId: string, value: boolean) {
  const { data, error } = await supabase.from('teams').update({ teachers_set_prices: value }).eq('id', teamId).select('id')
  if (error) throw toDataError('save the setting', error)
  requireAffected(data, 'set teachers_set_prices')
}

export async function updateTeam(teamId: string, input: { name: string; type: TeamType }) {
  const { data, error } = await supabase
    .from('teams')
    .update({ name: input.name.trim(), type: input.type })
    .eq('id', teamId)
    .select('id')
  if (error) {
    throw toDataError('save the group', error, {
      '23514': 'This group has courses. Change them to projects or spaces before making it a development group.',
    })
  }
  requireAffected(data, 'update group')
}

export async function deleteTeam(teamId: string) {
  const { data, error } = await supabase.from('teams').delete().eq('id', teamId).select('id')
  if (error) throw toDataError('delete the group', error)
  requireAffected(data, 'delete group')
}

// ---------------------------------------------------------------- branding

const TEAM_LOGO_BUCKET = 'team-logos'
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Public URL for a group logo path, built client-side (no request). */
export function teamLogoUrl(path: string): string {
  return supabase.storage.from(TEAM_LOGO_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Uploads a new logo, points the team at it, and deletes the old file. Owners/admins only (RLS). */
export async function uploadTeamLogo(teamId: string, currentPath: string | null, file: File): Promise<string> {
  if (!LOGO_TYPES.includes(file.type)) throw new DataError('Use a PNG, JPG or WebP image.')
  if (file.size > LOGO_MAX_BYTES) throw new DataError('The logo can be at most 2 MB.')
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${teamId}/${crypto.randomUUID()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from(TEAM_LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw toDataError('upload the logo', { message: uploadError.message })
  const { data, error } = await supabase.from('teams').update({ logo_path: path }).eq('id', teamId).select('id')
  if (error) {
    // The row update was rejected (not an admin): don't leave an orphan file.
    await supabase.storage.from(TEAM_LOGO_BUCKET).remove([path])
    throw toDataError('save the logo', error)
  }
  requireAffected(data, 'save logo')
  if (currentPath) await supabase.storage.from(TEAM_LOGO_BUCKET).remove([currentPath])
  return path
}

/** Clears the logo and deletes its file. */
export async function removeTeamLogo(teamId: string, currentPath: string) {
  const { data, error } = await supabase.from('teams').update({ logo_path: null }).eq('id', teamId).select('id')
  if (error) throw toDataError('remove the logo', error)
  requireAffected(data, 'remove logo')
  await supabase.storage.from(TEAM_LOGO_BUCKET).remove([currentPath])
}

export async function setTeamRole(teamId: string, userId: string, role: Exclude<TeamRole, 'owner' | 'developer'>) {
  const { data, error } = await supabase
    .from('team_members')
    // The generated Supabase enum types will include this migration's value after Dev type regeneration.
    .update({ role: role as Database['public']['Enums']['team_role'] })
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw toDataError('change the role', error)
  requireAffected(data, 'change group role')
}

/** Remove someone, or leave (userId = yourself). Also removes them from the team's workspaces. */
export async function removeTeamMember(teamId: string, userId: string) {
  const { data, error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw toDataError('remove the member', error)
  requireAffected(data, 'remove group member')
}

export async function createInvite(
  teamId: string,
  options: { expiresAt: string | null; maxUses: number | null },
): Promise<Invite> {
  const { data, error } = await supabase
    .from('team_invites')
    .insert({ team_id: teamId, expires_at: options.expiresAt, max_uses: options.maxUses })
    .select('id, code, created_at, expires_at, max_uses, use_count')
    .single()
  if (error) throw toDataError('create the invite', error)
  return data
}

export async function revokeInvite(inviteId: string) {
  const { data, error } = await supabase.from('team_invites').delete().eq('id', inviteId).select('id')
  if (error) throw toDataError('revoke the invite', error)
  requireAffected(data, 'revoke invite')
}

const inviteEmailErrors: Record<string, string> = {
  bad_email: 'One of those email addresses doesn’t look right.',
  bad_request: 'Enter between 1 and 20 email addresses.',
  forbidden: 'Only group owners and admins can send invites.',
  disabled: 'Invite emails are switched off for this group. Share an invite code instead.',
  not_configured: 'Email isn’t set up yet. Share an invite code instead.',
  send_failed: 'The emails couldn’t be sent. Please try again.',
}

/** Emails each address its own single-use invite code (7 days), through the `invite-email` Edge Function. */
export async function emailInvites(teamId: string, emails: string[]): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{ sent: number }>('invite-email', {
    body: { teamId, emails },
  })
  if (error || !data) {
    let code: string | undefined
    if (error instanceof FunctionsHttpError) {
      code = await (error.context as Response)
        .json()
        .then((body: { error?: string }) => body.error)
        .catch(() => undefined)
    }
    logError('[teams] invite-email failed', code ?? error)
    throw new DataError((code && inviteEmailErrors[code]) ?? 'The invites couldn’t be sent. Please try again.', code, {
      cause: error,
    })
  }
  return data.sent
}
