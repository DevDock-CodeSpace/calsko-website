import {
  Box,
  Code2,
  FolderGit2,
  GraduationCap,
  Shapes,
  type LucideIcon,
} from 'lucide-react'
import type { WorkspaceRole, WorkspaceType } from '@/features/workspaces/api'
import type { TeamRole, TeamType } from './api'

// What the UI should offer. These mirror the RLS policies but are UX only:
// the database is the authority, and every call is checked there again.

export function teamPermissions(role: TeamRole) {
  const isOwner = role === 'owner'
  const isAdmin = isOwner || role === 'admin'
  const isTeacher = role === 'teacher'
  return {
    isOwner,
    isAdmin,
    isTeacher,
    canManageWorkspaces: isAdmin,
    /** Teachers create their own courses (create_course) and become their teacher. */
    canCreateCourses: isAdmin || isTeacher,
    canInvite: isAdmin,
    canEditTeam: isAdmin,
    canDelete: isOwner,
    canChangeRoles: isOwner,
    /** Admins switch people between member and teacher; only the owner makes admins. */
    canSetTeachers: isAdmin,
    canLeave: !isOwner,
    /** Owner removes anyone else; admin removes members, teachers and developers. */
    canRemove: (target: TeamRole) =>
      target !== 'owner' &&
      (isOwner || (role === 'admin' && (target === 'member' || target === 'teacher' || target === 'developer'))),
  }
}

export function workspacePermissions(teamRole: TeamRole, workspaceRole: WorkspaceRole | undefined) {
  const isTeamAdmin = teamRole === 'owner' || teamRole === 'admin'
  const isLead = workspaceRole === 'lead'
  return {
    canEdit: isTeamAdmin || isLead,
    canDelete: isTeamAdmin,
    /** Opening a workspace admits everyone who joins later, so leads can't (set_workspace_access). */
    canChangeAccess: isTeamAdmin,
    canAddMembers: isTeamAdmin || isLead,
    /** Only team owners/admins can make someone a lead. */
    canAssignLeads: isTeamAdmin,
    /** Developers have member-level access, so leads may remove them like members. */
    canRemove: (target: WorkspaceRole) => isTeamAdmin || (isLead && (target === 'member' || target === 'developer')),
  }
}

export const teamRoleLabel: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  teacher: 'Teacher',
  developer: 'Developer',
  member: 'Member',
}

/**
 * A group role's name as people in that group say it: the teacher role is a **Trainer** outside
 * learning groups (a senior engineer running onboarding isn't a teacher). Display only; the role is
 * 'teacher' everywhere in code and the database.
 */
export function teamRoleName(role: TeamRole, teamType: TeamType): string {
  return role === 'teacher' && teamType !== 'learning' ? 'Trainer' : teamRoleLabel[role]
}
export const workspaceRoleLabel: Record<WorkspaceRole, string> = { lead: 'Lead', developer: 'Developer', member: 'Member' }

export const teamTypes: Record<TeamType, { label: string; hint: string; icon: LucideIcon }> = {
  learning: { label: 'Learning', hint: 'Courses, cohorts, study groups', icon: GraduationCap },
  development: { label: 'Development', hint: 'Projects and code', icon: Code2 },
  general: { label: 'General', hint: 'Courses and projects together, for an organization', icon: Shapes },
}

export const workspaceTypes: Record<
  WorkspaceType,
  /** `noun` is what one is called in copy ("New course"), `plural` heads its sidebar section. */
  { label: string; noun: string; plural: string; hint: string; icon: LucideIcon }
> = {
  course: { label: 'Course', noun: 'course', plural: 'Courses', hint: 'Lessons, meetings, docs', icon: GraduationCap },
  project: { label: 'Project', noun: 'project', plural: 'Projects', hint: 'Code, docs, and planning', icon: FolderGit2 },
  // The 'general' type is called a "space" in the UI (study groups, clubs, anything else).
  general: { label: 'Space', noun: 'space', plural: 'Spaces', hint: 'Study groups, discussions, anything else', icon: Box },
}

/**
 * What a group can contain, by group type (mirrors private.check_workspace_type):
 * development groups have no courses.
 */
export const allowedWorkspaceTypes: Record<TeamType, WorkspaceType[]> = {
  learning: ['course', 'project', 'general'],
  development: ['project', 'general'],
  general: ['course', 'project', 'general'],
}

/**
 * Sidebar section order: the team type's own workspace type first, then the
 * rest (only types the group can contain).
 */
export function workspaceTypeOrder(teamType: TeamType): WorkspaceType[] {
  const first = defaultWorkspaceType[teamType]
  return [first, ...allowedWorkspaceTypes[teamType].filter((t) => t !== first)]
}

/**
 * Section order inside a collection: its type's own workspace type first, then the others. A
 * collection's type is a label, not a rule, so no type is left out.
 */
export function collectionTypeOrder(collectionType: TeamType): WorkspaceType[] {
  const first = defaultWorkspaceType[collectionType]
  return [first, ...(['course', 'project', 'general'] as const).filter((t) => t !== first)]
}

/** Sensible default workspace type for a team of this type. */
export const defaultWorkspaceType: Record<TeamType, WorkspaceType> = {
  learning: 'course',
  development: 'project',
  general: 'general',
}
