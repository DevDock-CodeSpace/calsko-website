import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft, CircleAlert, KeyRound, LoaderCircle, Plus, type LucideIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { LogoMark, LogoWordmark } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, useSignOut, useUserIdentity } from '@/features/auth/hooks'
import { createTeam, joinTeam, myTeamsQuery, SLUG_PATTERN, type TeamType } from '@/features/teams/api'
import { startPath } from '@/features/teams/landing'
import { learningPath } from '@/features/teams/nav'
import { teamTypes } from '@/features/teams/permissions'
import { slugify } from '@/features/teams/slug'
import { cn } from '@/lib/utils'

type Choice = 'join' | 'create'

/** Create a team (→ owner) or join one with an invite code (→ member): pick one, then one form. */
export function OnboardingPage() {
  const { user } = useAuth()
  const memberships = useSuspenseQuery(myTeamsQuery(user.id)).data
  const isFirstTeam = memberships.length === 0
  // Most people arrive with a code from their instructor or team; the one who starts a group picks it once.
  const [choice, setChoice] = useState<Choice>('join')

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-16 items-center justify-between gap-4 px-6">
        <span className="flex items-center gap-2.5">
          <LogoMark className="h-7" />
          <LogoWordmark className="h-5" />
        </span>
        <div className="flex items-center gap-3">
          <SignedInAs />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 justify-center px-6 pt-4 pb-12 sm:pt-8">
        <div className="w-full max-w-2xl animate-in duration-500 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
          {!isFirstTeam && (
            <Button variant="ghost" size="sm" asChild className="-ml-2.5 mb-3 text-muted-foreground">
              <Link to="/app">
                <ArrowLeft /> Back to your group
              </Link>
            </Button>
          )}

          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
            {isFirstTeam ? 'Welcome to Calsko' : 'Create or join a group'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isFirstTeam
              ? 'Everything in Calsko happens inside a group. Join yours, or start a new one.'
              : 'You can belong to several groups, with a different role in each.'}
          </p>

          <div role="radiogroup" aria-label="What would you like to do?" className="mt-6 grid gap-3 sm:grid-cols-2">
            <ChoiceOption
              selected={choice === 'join'}
              onSelect={() => setChoice('join')}
              icon={KeyRound}
              title="Join with an invite code"
              description="You have a code from your instructor or a group admin."
            />
            <ChoiceOption
              selected={choice === 'create'}
              onSelect={() => setChoice('create')}
              icon={Plus}
              title="Start a new group"
              description="For a class, cohort, project or organization. You’ll own it."
            />
          </div>

          <div key={choice} className="mt-6 border-t pt-6 animate-in duration-300 fade-in motion-reduce:animate-none">
            {choice === 'join' ? <JoinTeamForm /> : <CreateTeamForm />}
          </div>
        </div>
      </main>
    </div>
  )
}

function ChoiceOption({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md border',
          selected ? 'border-brand/40 bg-background text-brand' : 'bg-muted/50 text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function CreateTeamForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [type, setType] = useState<TeamType>('learning')
  const effectiveSlug = slugEdited ? slug : slugify(name)
  const slugValid = effectiveSlug.length >= 3 && effectiveSlug.length <= 48 && SLUG_PATTERN.test(effectiveSlug)

  const create = useMutation({
    mutationFn: () => createTeam({ name, slug: effectiveSlug, type }),
    onSuccess: async (team) => {
      await queryClient.invalidateQueries({ queryKey: ['teams'] })
      navigate(startPath(team.slug))
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() && slugValid) create.mutate()
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind of group?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(teamTypes) as TeamType[]).map((value) => {
            const { label, hint, icon: Icon } = teamTypes[value]
            const selected = type === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => setType(value)}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  selected ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className={cn('size-4', selected ? 'text-brand' : 'text-muted-foreground')} />
                  {label}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="team-name">Name</Label>
          <Input
            id="team-name"
            value={name}
            maxLength={100}
            placeholder="Evening Cohort"
            className="h-10"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-slug">Address</Label>
          <div className="flex h-10 items-center rounded-md border bg-muted/40 pl-3 font-mono text-sm focus-within:ring-2 focus-within:ring-ring/50">
            <span className="text-muted-foreground">/t/</span>
            <input
              id="team-slug"
              className="h-full min-w-0 flex-1 bg-transparent pr-3 outline-none"
              value={effectiveSlug}
              maxLength={48}
              placeholder="evening-cohort"
              aria-invalid={effectiveSlug !== '' && !slugValid}
              onChange={(e) => {
                setSlugEdited(true)
                setSlug(e.target.value.toLowerCase())
              }}
            />
          </div>
          {effectiveSlug !== '' && !slugValid ? (
            <p className="text-xs text-destructive">3–48 lowercase letters, numbers, and single dashes.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Filled in from the name. You can change it.</p>
          )}
        </div>
      </div>

      {create.isError && (
        <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {create.error.message}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" className="h-11 w-full" disabled={!name.trim() || !slugValid || create.isPending}>
          {create.isPending && <LoaderCircle className="animate-spin" />}
          Create group
        </Button>
      </div>
    </form>
  )
}

function JoinTeamForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  // An emailed invite links here with ?code=, so the person only has to press Join.
  const [searchParams] = useSearchParams()
  const [code, setCode] = useState(() => searchParams.get('code') ?? '')

  const join = useMutation({
    mutationFn: () => joinTeam(code),
    onSuccess: async ({ teamId, courseId }) => {
      await queryClient.invalidateQueries({ queryKey: ['teams'] })
      const memberships = await queryClient.fetchQuery(myTeamsQuery(user.id))
      const joined = memberships.find((m) => m.team.id === teamId)
      // A course code opens the course it enrolled in.
      navigate(joined ? (courseId ? learningPath(joined.team.slug, courseId) : startPath(joined.team.slug)) : '/app')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code.trim()) join.mutate()
  }

  return (
    <form onSubmit={submit}>
      <Label htmlFor="invite-code">Invite or course code</Label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <Input
          id="invite-code"
          value={code}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="h-11 flex-1 font-mono text-base tracking-[0.2em] uppercase"
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <Button type="submit" size="lg" className="h-11 sm:min-w-32" disabled={!code.trim() || join.isPending}>
          {join.isPending && <LoaderCircle className="animate-spin" />}
          Join
        </Button>
      </div>
      {join.isError ? (
        <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {join.error.message}
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A group invite code adds you to the group. A course code adds you to the group and enrolls you in that
          course.
        </p>
      )}
    </form>
  )
}

/** No sidebar here, so offer a way out for someone who signed in with the wrong account. */
function SignedInAs() {
  const { email, name } = useUserIdentity()
  const signOut = useSignOut()
  return (
    <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden truncate sm:inline">{email ?? name}</span>
      <span aria-hidden className="hidden text-border sm:inline">|</span>
      <button
        type="button"
        className="shrink-0 hover:text-foreground"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Sign out
      </button>
    </p>
  )
}
