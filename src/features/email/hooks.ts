import type { FeatureFlag } from '@/features/flags/flags'
import { useCurrentTeam } from '@/features/teams/hooks'
import type { EmailSettings } from './api'

const OPTIONS: { key: keyof EmailSettings; label: string; flag: FeatureFlag }[] = [
  { key: 'reminders', label: 'Note reminders', flag: 'email_reminders' },
  { key: 'meetings', label: 'Meeting invites and changes', flag: 'email_meetings' },
  { key: 'chat', label: 'Unread chat messages', flag: 'email_chat' },
]

/** The switches this group's feature flags allow; none means the Email menu isn't shown at all. */
export function useEmailOptions() {
  const { features } = useCurrentTeam()
  return OPTIONS.filter((option) => features.includes(option.flag))
}
