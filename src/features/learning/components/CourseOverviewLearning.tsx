import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useCurrentTeam } from '@/features/teams/hooks'
import { teamRoleName } from '@/features/teams/permissions'
import { learningPath, learningProgressPath, lessonPath, workspacePath } from '@/features/teams/nav'
import { useLearning } from '../hooks'

/**
 * The course Overview's Learning box. Students: their progress and the next lesson. Teachers: the course
 * at a glance and the way to the class and its codes. Reads the same queries as the Learning tab.
 */
export function CourseOverviewLearning() {
  const { team } = useCurrentTeam()
  const { workspace, ordered, done, next, canManage } = useLearning()
  const total = ordered.length
  const percent = total > 0 ? Math.round((done.size / total) * 100) : 0

  if (canManage) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          {total === 0 ? 'No lessons yet. Build the course in Learning.' : `${total} ${total === 1 ? 'lesson' : 'lessons'} in the course.`}
        </p>
        <div className="flex flex-wrap gap-1">
          <Button asChild size="sm" variant="outline">
            <Link to={learningPath(team.slug, workspace.id)}>Edit lessons</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={learningProgressPath(team.slug, workspace.id)}>Class progress</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={`${workspacePath(team.slug, workspace.id)}/members`}>Students & codes</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (total === 0)
    return <p className="text-sm text-muted-foreground">Your {teamRoleName('teacher', team.type).toLowerCase()} hasn’t added lessons yet.</p>

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">
            {done.size}/{total}
          </span>{' '}
          lessons done
        </p>
        {next ? (
          <Button asChild size="sm">
            <Link to={lessonPath(team.slug, workspace.id, next.id)}>
              {done.size === 0 ? 'Start' : 'Continue'}: <span className="max-w-56 truncate">{next.title}</span> <ArrowRight />
            </Link>
          </Button>
        ) : (
          <p className="text-sm font-medium">Finished. Well done!</p>
        )}
      </div>
    </div>
  )
}
