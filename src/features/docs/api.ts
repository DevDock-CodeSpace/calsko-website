import { queryOptions } from '@tanstack/react-query'
import type { PersonProfile } from '@/features/teams/api'
import type { WorkspaceType } from '@/features/workspaces/api'
import { DataError, requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Json, TablesInsert } from '@/types/database.types'
import type { FileAccess } from './sharing'
import { logError } from '@/lib/error-tracking'

// Documents: workspace_id null = team-wide, otherwise assigned to that workspace.
// RLS decides who sees what; these queries just ask for "everything I can see".

export type DocSummary = {
  id: string
  team_id: string
  workspace_id: string | null
  /** null = top level of its scope. */
  folder_id: string | null
  title: string
  created_at: string
  updated_at: string
  author: PersonProfile
  /** null for team-wide docs. */
  workspace: { id: string; title: string; type: WorkspaceType } | null
  /** 'restricted': only its owner, the people it's shared with, and group owners/admins (RLS). */
  access: FileAccess
  /** The owner (who made it); null if they've left. */
  created_by: string | null
  /** Set when it's in a lesson's folder: Files leaves it out for anyone who doesn't manage the course. */
  lesson_id: string | null
}
/** `body` is TipTap JSON (null = empty); `content` is its plain-text copy. */
export type Doc = DocSummary & {
  content: string
  body: Json | null
  /** The caller's level on it (public.access_level): 1 view, 2 edit (shared as an editor), 3 the usual role rules. */
  access_level: number
}

// Content is left out of lists; it can be large.
export const DOC_SUMMARY =
  'id, team_id, workspace_id, folder_id, title, created_at, updated_at, access, created_by, lesson_id, author:profiles!documents_created_by_fkey(display_name, avatar_url), workspace:workspaces!documents_workspace_team_fkey(id, title, type)'

/** A folder of docs and diagrams, group-wide (workspace_id null) or in one workspace; depth 1–3. */
export type DocFolder = {
  id: string
  team_id: string
  workspace_id: string | null
  parent_id: string | null
  name: string
  depth: number
  updated_at: string
  access: FileAccess
  created_by: string | null
  /** The plan this folder belongs to (inside the Plans folder), or null. */
  plan_id: string | null
  /** The group's "Plans" folder. Plan folders follow their plans: not renamed, moved or deleted by hand. */
  is_plans_root: boolean
  /** The lesson this folder belongs to (inside the workspace's Lessons folder), or null. */
  lesson_id: string | null
  /** The workspace's "Lessons" folder. Lesson folders follow their lessons, like plan folders. */
  is_lessons_root: boolean
}

/** Folders can nest this deep (enforced by the database). */
export const MAX_FOLDER_DEPTH = 3

const IMAGE_BUCKET = 'doc-images'

const writeErrors = { '42501': 'You don’t have permission to change docs here.' }

// ---------------------------------------------------------------- queries

/** Team → Docs: team-wide docs plus docs of every workspace the caller can see. */
export const teamDocsQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['documents', 'team', teamId],
    queryFn: async (): Promise<DocSummary[]> => {
      const { data, error } = await supabase
        .from('documents')
        .select(DOC_SUMMARY)
        .eq('team_id', teamId)
        .order('updated_at', { ascending: false })
      if (error) throw toDataError('load docs', error)
      return data
    },
  })

const FOLDER_COLUMNS = 'id, team_id, workspace_id, parent_id, name, depth, updated_at, access, created_by, plan_id, is_plans_root, lesson_id, is_lessons_root'

/** Folders of one scope: group-wide (workspaceId null) or one workspace's. */
export const foldersQuery = (teamId: string, workspaceId: string | null) =>
  queryOptions({
    queryKey: ['documents', 'folders', teamId, workspaceId ?? 'team'],
    queryFn: async (): Promise<DocFolder[]> => {
      let query = supabase.from('doc_folders').select(FOLDER_COLUMNS).eq('team_id', teamId)
      query = workspaceId ? query.eq('workspace_id', workspaceId) : query.is('workspace_id', null)
      const { data, error } = await query.order('name')
      if (error) throw toDataError('load folders', error)
      return data
    },
  })

/** null when the doc doesn't exist or the caller can't read it. */
export const documentQuery = (docId: string) =>
  queryOptions({
    queryKey: ['documents', docId],
    queryFn: async (): Promise<Doc | null> => {
      const { data, error } = await supabase
        .from('documents')
        .select(`${DOC_SUMMARY}, content, body, access_level`)
        .eq('id', docId)
        .maybeSingle()
        // access_level is a computed column (public.access_level); the generated types can't see it.
        .overrideTypes<Doc, { merge: false }>()
      if (error) throw toDataError('load the doc', error)
      return data
    },
  })

// -------------------------------------------------------------- mutations

/** created_by is set by the database (auth.uid()); scope can't change later. */
export async function createDocument(input: {
  teamId: string
  workspaceId: string | null
  title: string
  /** Create it inside this folder (same scope). */
  folderId?: string | null
  access?: FileAccess
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      team_id: input.teamId,
      workspace_id: input.workspaceId,
      title: input.title.trim(),
      folder_id: input.folderId ?? null,
      access: input.access ?? 'place',
    })
    .select('id')
    .single()
  if (error) throw toDataError('create the doc', error, writeErrors)
  return data
}

/** Saves the title, the rich body, and its plain-text copy (written together). */
export async function updateDocument(
  docId: string,
  input: { title: string; body: Json; content: string },
  expectedUpdatedAt?: string,
) {
  let query = supabase
    .from('documents')
    .update({ title: input.title.trim(), body: input.body, content: input.content })
    .eq('id', docId)
  if (expectedUpdatedAt !== undefined) query = query.eq('updated_at', expectedUpdatedAt)
  const { data, error } = await query.select('id, updated_at')
  if (error) throw toDataError('save the doc', error, writeErrors)
  if (expectedUpdatedAt !== undefined && (!data || data.length === 0)) {
    throw new DataError('Someone else changed this Brief. Open it to see their changes.', '409')
  }
  requireAffected(data, 'save doc')
  // The time the database gave this save: it identifies our own echo (lib/realtime `ownSave`).
  return data[0]?.updated_at
}

/**
 * Deletes the doc's images first (Storage RLS only allows it while the doc
 * exists and the caller can edit it), then the doc itself.
 */
/** Removes a doc's images from Storage (its folder `<team>/<doc>/`), before the doc goes. */
export async function removeDocImages(teamId: string, docId: string) {
  const folder = `${teamId}/${docId}`
  const { data: files, error: listError } = await supabase.storage.from(IMAGE_BUCKET).list(folder, { limit: 1000 })
  if (listError) throw toDataError('delete the doc', { message: listError.message })
  if (files.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .remove(files.map((file) => `${folder}/${file.name}`))
    if (removeError) throw toDataError('delete the doc', { message: removeError.message })
  }
}

export async function deleteDocument(teamId: string, docId: string) {
  await removeDocImages(teamId, docId)
  const { data, error } = await supabase.from('documents').delete().eq('id', docId).select('id')
  if (error) throw toDataError('delete the doc', error, writeErrors)
  requireAffected(data, 'delete doc')
}

/**
 * Moves docs, diagrams and folders into a folder of their scope, or to the top level (null), in one
 * step: either everything moves or nothing does. Writers only; the database checks scope, depth and names.
 */
export async function moveFolderItems(input: { docIds: string[]; diagramIds: string[]; folderIds: string[]; targetId: string | null }) {
  const { error } = await supabase.rpc('move_folder_items', {
    p_doc_ids: input.docIds,
    p_diagram_ids: input.diagramIds,
    p_folder_ids: input.folderIds,
    // Generated types can't express a nullable argument.
    p_target: input.targetId as string,
  })
  if (error) {
    throw toDataError('move them', error, {
      '23514': 'That move isn’t allowed: items stay in their own place, folders nest 3 levels deep, and a folder can’t go inside itself.',
      '23505': 'There’s already a folder with that name in the destination.',
      '42501': 'You don’t have permission to move these.',
      '22023': 'Move fewer items at a time.',
    })
  }
}

const folderErrors = {
  ...writeErrors,
  '23505': 'There’s already a folder with that name here.',
  '23514': 'Folders can only be nested 3 levels deep.',
}

/** depth, created_by and updated_at are set by the database. */
export async function createFolder(input: {
  teamId: string
  workspaceId: string | null
  parentId: string | null
  name: string
  access?: FileAccess
}): Promise<DocFolder> {
  const row = { team_id: input.teamId, workspace_id: input.workspaceId, parent_id: input.parentId, name: input.name.trim(), access: input.access ?? 'place' }
  // Generated types can't see the trigger that sets `depth`.
  const { data, error } = await supabase
    .from('doc_folders')
    .insert(row as TablesInsert<'doc_folders'>)
    .select(FOLDER_COLUMNS)
    .single()
  if (error) throw toDataError('create the folder', error, folderErrors)
  return data
}

export async function renameFolder(folderId: string, name: string) {
  const { data, error } = await supabase.from('doc_folders').update({ name: name.trim() }).eq('id', folderId).select('id')
  if (error) throw toDataError('rename the folder', error, folderErrors)
  requireAffected(data, 'rename folder')
}

/**
 * Deletes a folder and everything in it: each doc inside is deleted properly
 * first (its Storage images too), then the diagrams inside (one request), then
 * the folder, whose subfolders cascade.
 */
export async function deleteFolder(teamId: string, folderId: string, inside: { docIds: string[]; diagramIds: string[] }) {
  for (const docId of inside.docIds) await deleteDocument(teamId, docId)
  if (inside.diagramIds.length > 0) {
    const { error } = await supabase.from('diagrams').delete().in('id', inside.diagramIds)
    if (error) throw toDataError('delete the folder', error, writeErrors)
  }
  const { data, error } = await supabase.from('doc_folders').delete().eq('id', folderId).select('id')
  if (error) throw toDataError('delete the folder', error, writeErrors)
  requireAffected(data, 'delete folder')
}

// ----------------------------------------------------------------- images
// Private bucket; object path <team_id>/<document_id>/<file>. Storage RLS
// mirrors the doc: readers can view, editors can upload/delete. Issue
// descriptions keep theirs under issues/<workspace_id>/ (features/issues/images.ts).

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** Why this file can't be added as an image, or null when it can. */
export function imageProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Only PNG, JPEG, GIF or WebP images can be added.'
  if (file.size > IMAGE_MAX_BYTES) return 'Images can be at most 10 MB.'
  return null
}

/**
 * Uploads an image into a folder of the image bucket and returns its storage
 * path. Storage RLS decides who may write where (docs: <team>/<doc>; issue
 * descriptions: issues/<workspace>).
 */
export async function uploadImageTo(folder: string, file: File): Promise<string> {
  const problem = imageProblem(file)
  if (problem) throw new DataError(problem)
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw toDataError('upload the image', { message: error.message })
  return path
}

/** Uploads an image for a doc and returns its storage path (stored in the doc, not a URL). */
export function uploadDocImage(teamId: string, docId: string, file: File): Promise<string> {
  return uploadImageTo(`${teamId}/${docId}`, file)
}

/** Removes uploaded images. Best effort: a leftover file is harmless, so failures are only logged. */
export async function removeImages(paths: string[]) {
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(paths)
  if (error) logError('[data] Failed to remove images', error)
}

const SIGNED_URL_SECONDS = 60 * 60

/** Short-lived URL for a private doc image; refreshed before it expires. */
export const docImageUrlQuery = (path: string) =>
  queryOptions({
    queryKey: ['documents', 'image', path],
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
      if (error) throw toDataError('load the image', { message: error.message })
      return data.signedUrl
    },
    staleTime: (SIGNED_URL_SECONDS - 10 * 60) * 1000,
  })
