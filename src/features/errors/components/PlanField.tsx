import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { teamPlansQuery } from '@/features/plans/api'

export const NO_PLAN = '__none'
export const NEW_PLAN = '__new'

/**
 * Which plan a source's issues go into: none, one of the group's plans, or a new one named here
 * (made when the dialog is saved). The group's plans load when the dialog opens.
 */
export function PlanField({
  teamId,
  value,
  onChange,
  newName,
  onNewNameChange,
}: {
  teamId: string
  value: string
  onChange: (value: string) => void
  newName: string
  onNewNameChange: (name: string) => void
}) {
  const { data: plans = [], isPending } = useQuery(teamPlansQuery(teamId))
  const open = plans.filter((p) => (p.status !== 'done' && p.status !== 'canceled') || p.id === value)

  return (
    <div className="space-y-1.5">
      <Label htmlFor="error-source-plan">Add its issues to a plan</Label>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id="error-source-plan" className="w-full">
          <SelectValue placeholder={isPending ? 'Loading plans…' : undefined} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PLAN}>Don’t add to a plan</SelectItem>
          <SelectItem value={NEW_PLAN}>New plan…</SelectItem>
          {open.length > 0 && <SelectSeparator />}
          {open.map((plan) => (
            <SelectItem key={plan.id} value={plan.id}>
              {plan.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === NEW_PLAN && (
        <Input
          aria-label="New plan name"
          autoFocus
          value={newName}
          maxLength={120}
          placeholder="PostHog errors"
          onChange={(e) => onNewNameChange(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Either way each issue is labelled <span className="font-medium">Error</span> and with where it came from (for example{' '}
        <span className="font-mono">posthog-errors</span>).
      </p>
    </div>
  )
}
