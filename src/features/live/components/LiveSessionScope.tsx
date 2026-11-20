import { MessageCircle } from 'lucide-react'
import { DocScope } from '@/features/docs/components/DocScope'
import type { LiveSession } from '../api'

/** Whether a meeting is for a workspace/group or only a Chat. */
export function LiveSessionScope({ session }: { session: Pick<LiveSession, 'workspace' | 'conversation_id'> }) {
  if (session.conversation_id) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageCircle className="size-3.5 shrink-0" />
        Private Chat
      </span>
    )
  }
  return <DocScope doc={session} />
}
