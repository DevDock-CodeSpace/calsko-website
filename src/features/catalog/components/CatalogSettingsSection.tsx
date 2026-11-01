import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { SettingsSection } from '@/components/SettingsSection'
import { Button } from '@/components/ui/button'
import { setTeachersSetPrices } from '@/features/teams/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { teamRoleName } from '@/features/teams/permissions'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

/** Group settings → Course catalog: who prices and publishes courses, and the catalog's public link. */
export function CatalogSettingsSection() {
  const { team, can } = useCurrentTeam()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const teachers = `${teamRoleName('teacher', team.type)}s`
  const url = `/learn/${team.slug}`

  const save = useMutation({
    mutationFn: (value: boolean) => setTeachersSetPrices(team.id, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <SettingsSection
      title="Course catalog"
      description="Published courses are listed on the group’s public page, with their price. Anyone can open it without signing in."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="outline">
            <Link to={url} target="_blank">
              <ExternalLink /> Open the catalog
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.origin + url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                toast.error('Couldn’t copy the link.')
              }
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>

        <div>
          <p className="text-sm font-medium">Who prices and publishes courses</p>
          <div role="radiogroup" aria-label="Who prices and publishes courses" className="mt-2 grid max-w-xl gap-2 sm:grid-cols-2">
            {(
              [
                { value: true, title: `${teachers} and admins`, text: `Each course’s ${teachers.toLowerCase()} set its price and publish it.` },
                { value: false, title: 'Only owners and admins', text: `${teachers} build courses; owners and admins price and publish them.` },
              ] as const
            ).map((option) => (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={team.teachers_set_prices === option.value}
                disabled={!can.isAdmin || save.isPending}
                onClick={() => team.teachers_set_prices !== option.value && save.mutate(option.value)}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors enabled:hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-70',
                  team.teachers_set_prices === option.value && 'border-brand bg-brand/5',
                )}
              >
                <span className="text-sm font-medium">{option.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
