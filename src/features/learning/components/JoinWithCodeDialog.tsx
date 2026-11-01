import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/hooks'
import { joinTeam, myTeamsQuery } from '@/features/teams/api'
import { learningPath, teamPath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'

/** A course code (or a group invite) from inside the app: enrolls, then opens the course. */
export function JoinWithCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [code, setCode] = useState('')

  const join = useMutation({
    mutationFn: () => joinTeam(code),
    onSuccess: async ({ teamId, courseId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teams'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['learning'] }),
      ])
      const slug = (await queryClient.fetchQuery(myTeamsQuery(user.id))).find((m) => m.team.id === teamId)?.team.slug
      onOpenChange(false)
      toast.success(courseId ? 'You’re enrolled' : 'You joined the group')
      if (slug) navigate(courseId ? learningPath(slug, courseId) : teamPath(slug))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) join.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Use a course code</DialogTitle>
            <DialogDescription>Enter the code you were given (by your teacher or trainer, or with your purchase).</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Course code"
            autoFocus
            value={code}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="h-11 font-mono text-base tracking-[0.2em] uppercase"
            onChange={(e) => setCode(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!code.trim() || join.isPending}>
              {join.isPending && <LoaderCircle className="animate-spin" />}
              Enroll
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
