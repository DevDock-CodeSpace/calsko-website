import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBothPrices } from '@/features/catalog/price'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { errorMessage } from '@/lib/errors'
import { setCourseListing } from '../platformApi'

const coursePageUrl = (slug: string, courseId: string) => `/learn/${slug}/${courseId}`

/** "999" → 999, "" → null (free); undefined when it isn't a price. */
function parseRupees(text: string): number | null | undefined {
  const t = text.trim().replace(/[₹,\s]/g, '')
  if (t === '' || t === '0') return null
  return /^\d{1,8}$/.test(t) ? Number(t) : undefined
}
/** "15", "14.99", "$15" → cents; "" → null (free). */
function parseDollars(text: string): number | null | undefined {
  const t = text.trim().replace(/[$,\s]/g, '')
  if (t === '' || t === '0') return null
  return /^\d{1,6}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : undefined
}

/**
 * A course's public listing: draft or published in the group's catalog, and its price. Its teachers set it
 * (unless the group keeps pricing to its owners and admins); publishing needs a description and a lesson.
 */
export function CourseListing() {
  const { team, can } = useCurrentTeam()
  const { workspace } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [rupees, setRupees] = useState(workspace.price_inr?.toString() ?? '')
  const [dollars, setDollars] = useState(workspace.price_usd_cents != null ? (workspace.price_usd_cents / 100).toFixed(2).replace(/\.00$/, '') : '')
  const [copied, setCopied] = useState(false)
  const mayEdit = can.isAdmin || team.teachers_set_prices
  const url = coursePageUrl(team.slug, workspace.id)

  const save = useMutation({
    mutationFn: (published: boolean) => {
      const priceInr = parseRupees(rupees)
      const priceUsdCents = parseDollars(dollars)
      if (priceInr === undefined || priceUsdCents === undefined) throw new Error('Prices are whole rupees (999) and dollars with up to two decimals (14.99).')
      return setCourseListing(workspace.id, { published, priceInr, priceUsdCents })
    },
    onSuccess: async (_, published) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['workspaces'] }), queryClient.invalidateQueries({ queryKey: ['learning'] })])
      toast.success(published === workspace.published ? 'Listing saved' : published ? 'Published in the catalog' : 'Back to draft: hidden from the catalog')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(workspace.published)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy the link.')
    }
  }

  return (
    <section aria-labelledby="course-listing">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="course-listing" className="text-sm font-semibold">
          Public listing
        </h2>
        <span className={workspace.published ? 'rounded bg-brand/10 px-1.5 text-[11px] text-brand' : 'rounded border px-1.5 text-[11px] text-muted-foreground'}>
          {workspace.published ? 'Published' : 'Draft'}
        </span>
        <span className="text-xs text-muted-foreground">{formatBothPrices(workspace)}</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Published courses are in {team.name}’s public catalog with their description, outline (lesson titles only) and teachers. Free ones can be joined
        from there; paid ones with a course code until checkout opens.
      </p>

      {mayEdit ? (
        <form onSubmit={submit} className="mt-3 flex max-w-2xl flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Price in India (₹)</span>
            <Input inputMode="numeric" value={rupees} placeholder="Free" onChange={(e) => setRupees(e.target.value)} className="w-28 font-mono" />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Price elsewhere ($)</span>
            <Input inputMode="decimal" value={dollars} placeholder="Free" onChange={(e) => setDollars(e.target.value)} className="w-28 font-mono" />
          </label>
          <Button type="submit" size="sm" variant="outline" className="h-9" disabled={save.isPending}>
            Save price
          </Button>
          <Button type="button" size="sm" className="h-9" disabled={save.isPending} onClick={() => save.mutate(!workspace.published)}>
            {save.isPending && <LoaderCircle className="animate-spin" />}
            {workspace.published ? 'Unpublish' : 'Publish'}
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">In this group, the owners and admins price and publish courses.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Button asChild size="sm" variant="ghost">
          <Link to={url} target="_blank">
            <ExternalLink /> {workspace.published ? 'Open its page' : 'Preview its page'}
          </Link>
        </Button>
        {workspace.published && (
          <Button size="sm" variant="ghost" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
          </Button>
        )}
      </div>
    </section>
  )
}
