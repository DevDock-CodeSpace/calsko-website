import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouteLoaderData } from 'react-router'
import { APP_ROUTE_ID, type appLoader } from '@/layouts/app-loader'
import { getCurrentSession, profileQuery, signInWithPassword, signInWithProvider, signOut, type SignInProvider } from './api'
import { nextForUser } from './redirect'

/** The signed-in user. Only usable inside the authenticated app layout. */
export function useAuth() {
  const data = useRouteLoaderData<typeof appLoader>(APP_ROUTE_ID)
  if (!data) throw new Error('useAuth must be used inside the authenticated app layout.')
  return data
}

export function useCurrentProfile() {
  const { user } = useAuth()
  return useQuery(profileQuery(user.id))
}

/** Name/avatar to show for the current user: profile first, Google account metadata as fallback. */
export function useUserIdentity() {
  const { user } = useAuth()
  const profile = useCurrentProfile()
  const meta = user.user_metadata
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

  return {
    email: user.email ?? null,
    name:
      text(profile.data?.display_name) ??
      text(meta.full_name) ??
      text(meta.name) ??
      // GitHub accounts often have no name, only a username.
      text(meta.user_name) ??
      user.email ??
      'Signed in',
    avatarUrl: text(profile.data?.avatar_url) ?? text(meta.avatar_url) ?? text(meta.picture),
    profileUnavailable: profile.isError,
  }
}

/** Google, Microsoft or GitHub sign-in (the browser leaves for the provider on success). */
export function useSignInWithProvider(next: string) {
  return useMutation({ mutationFn: ({ provider, remember }: { provider: SignInProvider; remember: boolean }) => signInWithProvider(provider, next, remember) })
}

/** The admin account's sign-in (see signInWithPassword); goes to `next` once signed in. */
export function useSignInWithPassword(next: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (input: { email: string; password: string; remember: boolean }) => signInWithPassword(input.email, input.password, input.remember),
    onSuccess: async () => {
      queryClient.clear()
      const session = await getCurrentSession().catch(() => null)
      navigate(session ? await nextForUser(next, session.user.id) : next, { replace: true })
    },
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      // Leave the page, then drop what was fetched as this user (cleared first, the page's queries
      // refetch without a session and fail).
      await navigate('/login', { replace: true })
      queryClient.clear()
    },
  })
}
