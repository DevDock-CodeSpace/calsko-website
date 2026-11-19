import { queryOptions } from '@tanstack/react-query'
import type { DocSummary } from '@/features/docs/api'
import type { FileAccess } from '@/features/docs/sharing'
import { requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database.types'

// Diagrams: same scope model and access rules as docs (workspace_id null =
// team-wide), and they live in the same folders (doc_folders). RLS decides who
// sees what; these queries ask for "everything I can see".

/** The same shape as a doc summary, so the doc browser, list and scope components render diagrams too. */
export type DiagramSummary = DocSummary
/** `data` is the editor JSON ({ nodes, edges }); parsed by the editor. */
export type Diagram = DiagramSummary & {
  data: Json
  /** The caller's level on it (public.access_level): 1 view, 2 edit (shared as an editor), 3 the usual role rules. */
  access_level: number
  /** Whether the caller is the lead/creator of its Plan, or a team owner/admin. */
  plan_whiteboard_editable: boolean
}

// `data` is left out of lists; it can be large.
const SUMMARY =
  'id, team_id, workspace_id, folder_id, title, created_at, updated_at, access, created_by, lesson_id, author:profiles!diagrams_created_by_fkey(display_name, avatar_url), workspace:workspaces!diagrams_workspace_team_fkey(id, title, type)'

const writeErrors = { '42501': 'You don’t have permission to change whiteboards here.' }

// ---------------------------------------------------------------- queries

/** Files: team-wide diagrams plus diagrams of every workspace the caller can see (lessons' too: Files leaves those out for students). */
export const teamDiagramsQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['diagrams', 'team', teamId],
    queryFn: async (): Promise<DiagramSummary[]> => {
      const { data, error } = await supabase
        .from('diagrams')
        .select(SUMMARY)
        .eq('team_id', teamId)
        .order('updated_at', { ascending: false })
      if (error) throw toDataError('load whiteboards', error)
      return data
    },
  })

/** null when the diagram doesn't exist or the caller can't read it. */
export const diagramQuery = (diagramId: string) =>
  queryOptions({
    queryKey: ['diagrams', diagramId],
    queryFn: async (): Promise<Diagram | null> => {
      const { data, error } = await supabase
        .from('diagrams')
        .select(`${SUMMARY}, data, access_level, plan_whiteboard_editable`)
        .eq('id', diagramId)
        .maybeSingle()
        // access_level is a computed column (public.access_level); the generated types can't see it.
        .overrideTypes<Diagram, { merge: false }>()
      if (error) throw toDataError('load the whiteboard', error)
      return data
    },
  })

// -------------------------------------------------------------- mutations

/** created_by is set by the database (auth.uid()); scope can't change later. */
export async function createDiagram(input: {
  teamId: string
  workspaceId: string | null
  title: string
  /** Create it inside this folder (same scope). */
  folderId?: string | null
  access?: FileAccess
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('diagrams')
    .insert({
      team_id: input.teamId,
      workspace_id: input.workspaceId,
      title: input.title.trim(),
      folder_id: input.folderId ?? null,
      access: input.access ?? 'place',
    })
    .select('id')
    .single()
  if (error) throw toDataError('create the whiteboard', error, writeErrors)
  return data
}

export async function updateDiagram(diagramId: string, input: { title: string; data: Json }) {
  const { data, error } = await supabase
    .from('diagrams')
    .update({ title: input.title.trim(), data: input.data })
    .eq('id', diagramId)
    .select('id, updated_at')
  if (error) throw toDataError('save the whiteboard', error, writeErrors)
  requireAffected(data, 'save whiteboard')
  // The time the database gave this save: it identifies our own echo (lib/realtime `ownSave`).
  return data[0]?.updated_at
}

export async function deleteDiagram(diagramId: string) {
  const { data, error } = await supabase.from('diagrams').delete().eq('id', diagramId).select('id')
  if (error) throw toDataError('delete the whiteboard', error, writeErrors)
  requireAffected(data, 'delete whiteboard')
}
