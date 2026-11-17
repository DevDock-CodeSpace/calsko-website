import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CalendarProvider } from '@/features/auth/calendar-token'

/** Google or Outlook: which calendar sends the invites. */
export function CalendarChoice({
  value,
  onChange,
  disabled,
}: {
  value: CalendarProvider
  onChange: (value: CalendarProvider) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as CalendarProvider)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label="Calendar">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="google">Google Calendar</SelectItem>
        <SelectItem value="outlook">Outlook</SelectItem>
      </SelectContent>
    </Select>
  )
}
