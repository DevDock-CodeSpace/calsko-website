import { setErrorUser } from '@/lib/error-tracking'
import { supabase } from '@/lib/supabase'

/**
 * Calls `onChange` whenever the signed-in identity changes after startup:
 * sign-in, sign-out (including from another tab), or a session that expired
 * and couldn't be refreshed. Token refreshes for the same user are ignored.
 * `onChange` gets the new user's id, null when signed out.
 */
export function watchAuthIdentity(onChange: (userId: string | null) => void): () => void {
  let currentUserId: string | null | undefined // undefined = initial session not seen yet

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const nextUserId = session?.user.id ?? null
    if (currentUserId !== undefined && nextUserId !== currentUserId) {
      // Supabase warns against calling its APIs inside this callback (deadlock),
      // and onChange re-runs loaders that do. Defer to the next task.
      setTimeout(() => onChange(nextUserId), 0)
    }
    currentUserId = nextUserId
    setErrorUser(nextUserId)
  })

  return () => data.subscription.unsubscribe()
}
