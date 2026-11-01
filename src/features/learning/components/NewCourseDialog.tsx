import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCollectionView } from '@/features/collections/hooks'
import { useCurrentTeam } from '@/features/teams/hooks'
import { learningPath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { createCourse, type CourseEnrollment } from '../platformApi'

const ENROLLMENT: { id: CourseEnrollment; title: string; text: string }[] = [
  { id: 'open', title: 'Open', text: 'Anyone in the group can enroll from Learning.' },
  { id: 'invite', title: 'Invite only', text: 'You add students, or give them a course code.' },
]

/** A teacher's (or admin's) new course: they become its teacher; students enroll or come in with a code. */
export function NewCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { team, can } = useCurrentTeam()
  const { collection } = useCollectionView()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [enrollment, setEnrollment] = useState<CourseEnrollment>('invite')

  const create = useMutation({
    mutationFn: () =>
      createCourse({
        teamId: team.id,
        title,
        description,
        enrollment,
        // Admins file it under the collection in view; a teacher's course belongs to the whole group.
        collectionId: can.isAdmin ? (collection?.id ?? null) : null,
      }),
    onSuccess: async (id) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['workspaces'] }), queryClient.invalidateQueries({ queryKey: ['learning'] })])
      toast.success('Course created. Add its first module and lessons.')
      onOpenChange(false)
      navigate(learningPath(team.slug, id))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim()) create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>New course</DialogTitle>
            <DialogDescription>You’ll teach it. Add co-teachers, lessons and students once it’s made.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="course-title">Title</Label>
            <Input id="course-title" autoFocus required maxLength={120} value={title} placeholder="Web development basics" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="course-description">What students will learn</Label>
            <Textarea id="course-description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div role="radiogroup" aria-label="Enrollment" className="grid grid-cols-2 gap-2">
            {ENROLLMENT.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={enrollment === option.id}
                onClick={() => setEnrollment(option.id)}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none',
                  enrollment === option.id && 'border-brand bg-brand/5',
                )}
              >
                <span className="text-sm font-medium">{option.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.text}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending && <LoaderCircle className="animate-spin" />}
              Create course
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
