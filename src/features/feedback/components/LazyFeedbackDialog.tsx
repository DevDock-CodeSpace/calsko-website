import { lazy, Suspense } from 'react'
import { useCurrentTeam } from '@/features/teams/hooks'
import { loadFeedbackDialog } from './feedbackDialogLoader'

const FeedbackDialog = lazy(() => loadFeedbackDialog().then((m) => ({ default: m.FeedbackDialog })))

/**
 * The Feedback form, opened from the profile menu (`UserMenu`): tell the Calsko team about a problem or an idea.
 * Mount it only once it's wanted; it renders outside the menu so closing the menu doesn't close it. No request until sent.
 */
export function LazyFeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { team } = useCurrentTeam()
  return (
    <Suspense fallback={null}>
      <FeedbackDialog open={open} onOpenChange={onOpenChange} teamId={team.id} />
    </Suspense>
  )
}
