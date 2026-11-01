import type { TeamType } from '@/features/teams/api'
import type { Collection, WorkspaceAccess, WorkspaceType } from './api'

// Wording for the "who can see it" setting. A collection is a word for things, so where people are
// meant the collection's own name is used ("Everyone in Batch 2026").

export type AccessOption = { value: WorkspaceAccess; label: string; hint: string }

/** The choices for a workspace: "its collection" is offered only when it is in one. */
export function accessOptions(collection: Collection | undefined): AccessOption[] {
  return [
    { value: 'members', label: 'Only people I add', hint: 'Group owners and admins always see it.' },
    ...(collection
      ? [{ value: 'collection' as const, label: `Everyone in ${collection.name}`, hint: 'Including people added to it later.' }]
      : []),
    { value: 'group', label: 'Everyone in the group', hint: 'Including people who join later.' },
  ]
}

/** Short form for lists and headings. */
export function accessLabel(access: WorkspaceAccess, collection: Collection | undefined): string {
  if (access === 'group') return 'Everyone in the group'
  if (access === 'collection') return `Everyone in ${collection?.name ?? 'its collection'}`
  return 'Only people added'
}

/**
 * What a new workspace starts with: courses are enrolled-only (students enroll, are added, or use a
 * course code: the learning platform); others are open to their collection when created inside one,
 * otherwise only the people added.
 */
export function defaultAccess(_teamType: TeamType, type: WorkspaceType, collectionId: string | null): WorkspaceAccess {
  if (type === 'course') return 'members'
  return collectionId ? 'collection' : 'members'
}

/** How wide a setting is, to tell opening up from narrowing down. */
const reach: Record<WorkspaceAccess, number> = { members: 0, collection: 1, group: 2 }
export const narrows = (from: WorkspaceAccess, to: WorkspaceAccess) => reach[to] < reach[from]
