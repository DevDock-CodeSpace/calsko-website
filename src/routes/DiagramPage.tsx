import { useSuspenseQuery } from '@tanstack/react-query'
import { Suspense } from 'react'
import { useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { diagramQuery } from '@/features/diagrams/api'
import { useCanWriteDiagrams } from '@/features/diagrams/hooks'
import { diagramView } from '@/features/diagrams/screens'

// The editor (React Flow) is only downloaded when a diagram is opened.
const DiagramView = diagramView.Component

/**
 * One diagram, at /t/:teamSlug/diagrams/:diagramId (team view) or
 * …/w/:workspaceId/diagrams/:diagramId. diagramLoader has already checked it
 * exists, belongs to this team, and (in a workspace) to that workspace.
 */
export function DiagramPage() {
  const { diagramId = '' } = useParams()
  const diagram = useSuspenseQuery(diagramQuery(diagramId)).data
  // The role rules, narrowed by how it's shared (a viewer of a restricted whiteboard only looks).
  const level = diagram?.access_level ?? 0
  const canWriteByScope = useCanWriteDiagrams()(diagram?.workspace_id ?? null)
  const canWrite =
    diagram?.plan_whiteboard_editable ||
    (canWriteByScope && level === 3) ||
    level === 2
  const canDelete = canWriteByScope && level === 3

  if (!diagram) {
    return <p className="py-16 text-center text-sm text-muted-foreground">This whiteboard doesn’t exist anymore.</p>
  }
  return (
    <Suspense fallback={<DiagramSkeleton />}>
      <DiagramView key={diagram.id} diagram={diagram} canWrite={canWrite} canDelete={canDelete} />
    </Suspense>
  )
}

function DiagramSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-1/3" />
      <Skeleton className="h-[60vh] w-full" />
    </div>
  )
}
