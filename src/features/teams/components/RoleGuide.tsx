import { Check } from 'lucide-react'
import type { TeamRole, TeamType } from '../api'
import type { WorkspaceRole } from '@/features/workspaces/api'
import { cn } from '@/lib/utils'
import { defaultWorkspaceType, teamRoleName, workspaceTypes } from '../permissions'

// Plain-language summary of the roles. Keep it in step with the RLS policies
// (and permissions.ts); it's a guide for people, not the enforcement.

type Role = { title: string; who: string; can: string[] }

/** Who typically holds each role, by group type. */
const typical: Record<TeamType, Record<TeamRole | WorkspaceRole, string>> = {
  learning: {
    owner: 'Runs the academy or school',
    admin: 'Runs it with the owner',
    teacher: 'Creates and teaches their own courses',
    developer: 'Coordinates project meetings',
    member: 'Students',
    lead: 'Teaches or assists in this course',
  },
  development: {
    owner: 'Runs the group',
    admin: 'Team leads and managers',
    teacher: 'Runs trainings: onboarding, workshops, internal courses',
    developer: 'Coordinates project meetings',
    member: 'Developers and contributors',
    lead: 'Leads this project',
  },
  general: {
    owner: 'Runs the group',
    admin: 'Managers and team leads',
    teacher: 'Runs trainings and courses',
    developer: 'Coordinates project meetings',
    member: 'Everyone else',
    lead: 'Leads this course, project or space',
  },
}

/**
 * "Who can do what": group roles (owner, admin, member), then what a lead and
 * a member can do inside a course/project/workspace. Wording follows the
 * group's type; the viewer's own role is marked.
 */
export function RoleGuide({
  type,
  myRole,
  showWorkspaceDeveloper = false,
}: {
  type: TeamType
  myRole: TeamRole
  showWorkspaceDeveloper?: boolean
}) {
  const noun = workspaceTypes[defaultWorkspaceType[type]].noun // course / project / space
  const nouns = `${noun}s`
  const who = typical[type]
  const trainers = `${teamRoleName('teacher', type).toLowerCase()}s`

  const groupRoles: (Role & { id: TeamRole })[] = [
    {
      id: 'owner',
      title: 'Owner',
      who: who.owner,
      can: [
        'Everything an admin can do',
        `Make people admins, ${trainers} or members`,
        'Remove anyone from the group',
        'Delete the group',
      ],
    },
    {
      id: 'admin',
      title: 'Admin',
      who: who.admin,
      can: [
        `Invite people with invite codes, make members ${trainers}, and remove members and ${trainers}`,
        `Create, edit and delete ${nouns}, and choose who’s in each and who leads it`,
        `Decide who sees each ${noun}: only the people added, everyone in its collection, or the whole group`,
        'Create collections and choose their people',
        `See and manage every ${noun}, even ones they haven’t joined`,
        'Write group-wide whiteboards, delete group-wide docs and organize their folders, schedule group-wide meetings, and change group settings',
        'Add and remove the group’s GitHub repositories',
      ],
    },
    {
      id: 'teacher',
      title: teamRoleName('teacher', type),
      who: who.teacher,
      can: [
        `Create courses and lead them; add the group’s other ${trainers} and admins as co-leads`,
        'Bring students in with course codes (free, fee waived), add them directly, and choose whether a course is open or invite only',
        `Build the course in Learning and see their own students’ progress, never other ${trainers}’ courses`,
        `Otherwise works like a member`,
      ],
    },
    {
      id: 'member',
      title: 'Member',
      who: who.member,
      can: [
        `Sees the ${nouns} they’ve been added to, plus any that are open to the group or to a collection they’re in`,
        'Enrolls in open courses from Learning, or joins one with a course code',
        'Reads group-wide whiteboards, and creates and edits group-wide docs',
        `What they can do inside a ${noun} depends on their role there (below)`,
        'Can leave the group at any time',
      ],
    },
  ]

  const workspaceRoles: Role[] = [
    {
      title: 'Lead',
      who: who.lead,
      can: [
        `Change the ${noun}’s settings and tools, and add or remove its members`,
        'Write its whiteboards, delete its docs, and organize doc folders',
        'Schedule its meetings',
        'Delete issues, and manage labels and sprints',
        'Link the group’s repositories to it, and set their branches',
        'Move any issue to In Review or Done by hand (overriding GitHub)',
        ...(type === 'learning' ? ['Build the course in Learning and see the class’s progress'] : []),
        // A general group holds courses beside projects and spaces, so the course lines say so.
        ...(type === 'general' ? ['In a course: build it in Learning and see the class’s progress'] : []),
      ],
    },
    {
      title: 'Member',
      who: type === 'learning' ? 'Takes the course' : `Works in the ${noun}`,
      can: [
        `Anyone a ${noun} is open to works as a member, without being added by name`,
        'Creates and edits its docs, and reads its whiteboards',
        'Creates and updates issues (including their repository), and comments',
        'On issues in a connected repo, In Review and Done come from GitHub: open a PR, then merge it',
        ...(type === 'learning' ? ['Takes lessons and tracks their own progress'] : []),
        ...(type === 'general' ? ['In a course: takes lessons and tracks their own progress'] : []),
      ],
    },
  ]

  return (
    <section aria-labelledby="role-guide" className="mt-12">
      <h2 id="role-guide" className="text-sm font-semibold">
        Who can do what
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {type === 'learning'
          ? 'A common setup: the owner runs the academy, teachers create and teach their own courses, and students enroll course by course.'
          : `Roles in the group decide who manages it; each ${noun} also has leads and members.`}
      </p>

      <div className="mt-4 grid border-y md:grid-cols-2 md:divide-x xl:grid-cols-4">
        {groupRoles.map((role) => (
          <RoleColumn key={role.id} role={role} isYou={role.id === myRole} />
        ))}
      </div>

      <h3 className="mt-8 text-sm font-semibold">Inside a {noun}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Set per {noun} on its Members tab. Group owners and admins can do everything a lead can, in every {noun}.
      </p>
      <div className="mt-4 grid border-y md:grid-cols-2 md:divide-x">
        {workspaceRoles.map((role) => (
          <RoleColumn key={role.title} role={role} />
        ))}
      </div>

      {showWorkspaceDeveloper && (
        <>
          <h3 className="mt-8 text-sm font-semibold">Inside a Development Space</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Only Spaces in Development collections can have this role.
          </p>
          <div className="mt-4 grid border-y md:grid-cols-2 md:divide-x">
            <RoleColumn
              role={{
                title: 'Developer',
                who: 'Coordinates meetings in this Space',
                can: [
                  'All Member permissions',
                  'Schedule meetings in this Space when Meetings are enabled',
                  'Cannot edit or cancel meetings',
                ],
              }}
            />
          </div>
        </>
      )}
    </section>
  )
}

function RoleColumn({ role, isYou = false }: { role: Role; isYou?: boolean }) {
  return (
    <div className={cn('border-b px-4 py-4 last:border-b-0 md:border-b-0', isYou && 'bg-muted/40')}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className={cn(isYou && 'text-brand')}>{role.title}</span>
        {isYou && <span className="font-mono text-[11px] font-normal text-muted-foreground">you</span>}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{role.who}</p>
      <ul className="mt-3 space-y-1.5">
        {role.can.map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
