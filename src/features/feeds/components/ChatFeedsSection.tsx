import { useMutation, useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { Bug, LoaderCircle, MoreHorizontal, Plus, Webhook } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LogoMark } from '@/components/Logo'
import { SettingsSection } from '@/components/SettingsSection'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { teamConversationsQuery, type Conversation } from '@/features/messaging/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { teamWorkspacesQuery } from '@/features/workspaces/api'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CHAT_EVENTS,
  chatFeedsQuery,
  createChatWebhook,
  deleteChatFeed,
  enableChatFeed,
  feedKeys,
  rotateChatWebhookToken,
  updateChatFeed,
  type ChatEvent,
  type ChatFeed,
} from '../api'
import { feedTargets, NEW_ACTIVITY, SAME_AS_FEED } from '../targets'
import { TargetPicker } from './TargetPicker'
import { WebhookSetup } from './WebhookSetup'

/**
 * Group settings → Chat feeds (groups with the chat_feeds flag; owners and admins): which channel gets
 * Calsko's events and error tracking's daily summary, and the webhooks outside tools post alerts to.
 */
export function ChatFeedsSection() {
  const { team, features } = useCurrentTeam()
  const [{ data: feeds }, { data: conversations }] = useSuspenseQueries({
    queries: [chatFeedsQuery(team.id), teamConversationsQuery(team.id)],
  })
  // Channels (the whole group) and the private conversations you're in (chosen people).
  const channels = feedTargets(conversations)
  const events = feeds.find((f) => f.kind === 'events')
  const errors = feeds.find((f) => f.kind === 'errors')
  const webhooks = feeds.filter((f) => f.kind === 'webhook')
  const [adding, setAdding] = useState(false)

  return (
    <SettingsSection
      title="Chat feeds"
      description="Calsko posts what happens in the group, and outside tools (AWS, Azure, anything that can send a webhook) post their alerts. Each goes to a channel (the whole group sees it) or a private conversation (only its people). Critical alerts notify everyone who can read them."
    >
      <div className="space-y-4">
        <ul className="divide-y rounded-md border">
          <BuiltInRow
            kind="events"
            feed={events}
            channels={channels}
            icon={<LogoMark className="h-4" />}
            title="Calsko events"
            detail="Issues created or closed, meetings, plans, people joining."
          />
          {features.includes('error_tracking') && (
            <BuiltInRow
              kind="errors"
              feed={errors}
              channels={channels}
              icon={<Bug className="size-4" />}
              title="Error tracking summary"
              detail="After each daily run: how many errors were seen and which issues were written."
            />
          )}
          {webhooks.map((feed) => (
            <WebhookRow key={feed.id} feed={feed} channels={channels} />
          ))}
        </ul>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus /> Add a webhook
        </Button>
      </div>
      {adding && <AddWebhookDialog channels={channels} onClose={() => setAdding(false)} />}
    </SettingsSection>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  const { team } = useCurrentTeam()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: feedKeys.team(team.id) }),
      // Switching a feed on may have made #activity.
      queryClient.invalidateQueries({ queryKey: teamConversationsQuery(team.id).queryKey }),
    ])
}

function Row({ icon, title, detail, muted, children }: { icon: ReactNode; title: ReactNode; detail: ReactNode; muted?: boolean; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <span className={cn('flex size-4 shrink-0 items-center justify-center', muted && 'text-muted-foreground opacity-60')}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', muted && 'text-muted-foreground')}>{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </li>
  )
}

function BuiltInRow({
  kind,
  feed,
  channels,
  icon,
  title,
  detail,
}: {
  kind: 'events' | 'errors'
  feed: ChatFeed | undefined
  channels: Conversation[]
  icon: ReactNode
  title: string
  detail: string
}) {
  const { team } = useCurrentTeam()
  const refresh = useRefresh()
  const [choosing, setChoosing] = useState(false)
  const [now] = useState(Date.now)
  const on = feed?.enabled ?? false

  const enable = useMutation({
    mutationFn: (channel?: string) => enableChatFeed(team.id, kind, channel),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof updateChatFeed>[1]) => updateChatFeed(feed!.id, patch),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const moveTo = (value: string) => {
    if (value === NEW_ACTIVITY) enable.mutate(undefined)
    else if (!feed) enable.mutate(value)
    else update.mutate({ conversation_id: value })
  }

  return (
    <Row icon={icon} title={title} detail={on && feed?.last_posted_at ? `${detail} Last posted ${timeAgo(feed.last_posted_at, now)}.` : detail} muted={!on}>
      {on && feed ? (
        <>
          <TargetPicker label={`Where ${title} posts`} value={feed.conversation_id} targets={channels} onChange={moveTo} disabled={update.isPending || enable.isPending} allowNewActivity />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={`More for ${title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setChoosing(true)}>{kind === 'events' ? 'Choose events and projects…' : 'Choose projects…'}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => update.mutate({ enabled: false })}>Switch off</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : (
        <Button size="sm" variant="outline" disabled={enable.isPending || update.isPending} onClick={() => (feed ? update.mutate({ enabled: true }) : enable.mutate(undefined))}>
          {(enable.isPending || update.isPending) && <LoaderCircle className="animate-spin" />}
          Switch on
        </Button>
      )}
      {choosing && feed && <FeedOptionsDialog feed={feed} targets={channels} onClose={() => setChoosing(false)} />}
    </Row>
  )
}

function FeedOptionsDialog({ feed, targets, onClose }: { feed: ChatFeed; targets: Conversation[]; onClose: () => void }) {
  const { team } = useCurrentTeam()
  const refresh = useRefresh()
  const { data: workspaces } = useSuspenseQuery(teamWorkspacesQuery(team.id))
  // Projects with issues (error sources live in those too), open to everyone first.
  const projects = workspaces
    .filter((w) => w.modules.includes('issues'))
    .sort((a, b) => Number(b.access === 'group') - Number(a.access === 'group') || a.title.localeCompare(b.title))
  const [events, setEvents] = useState<ChatEvent[]>(feed.events)
  const [ticked, setTicked] = useState<string[]>(feed.projects)
  // Per event: somewhere else than the feed's own target (missing = same as the feed).
  const [eventTargets, setEventTargets] = useState<Record<string, string>>(feed.event_targets)
  const save = useMutation({
    mutationFn: () =>
      updateChatFeed(feed.id, {
        projects: ticked,
        ...(feed.kind === 'events'
          ? {
              events: CHAT_EVENTS.map((e) => e.key).filter((key) => events.includes(key)),
              event_targets: Object.fromEntries(Object.entries(eventTargets).filter(([key, id]) => events.includes(key as ChatEvent) && id !== feed.conversation_id)),
            }
          : {}),
      }),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{feed.kind === 'events' ? 'Calsko events' : 'Error tracking summary'}</DialogTitle>
          <DialogDescription>
            {feed.kind === 'events' ? 'What Calsko posts, and about which projects.' : 'Which projects’ error summaries are posted.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {feed.kind === 'events' && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">Events, and where each goes</legend>
              {CHAT_EVENTS.map((event) => (
                <div key={event.key} className="flex items-center gap-2.5">
                  <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
                    <input type="checkbox" className="size-4 accent-brand" checked={events.includes(event.key)} onChange={(e) => setEvents((now) => toggle(now, event.key, e.target.checked))} />
                    <span className="truncate">{event.label}</span>
                  </label>
                  <TargetPicker
                    label={`Where “${event.label}” goes`}
                    value={eventTargets[event.key] ?? SAME_AS_FEED}
                    targets={targets}
                    allowSame
                    disabled={!events.includes(event.key)}
                    onChange={(value) =>
                      setEventTargets((now) => {
                        const next = { ...now }
                        if (value === SAME_AS_FEED) delete next[event.key]
                        else next[event.key] = value
                        return next
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Projects</legend>
            <p className="text-xs text-muted-foreground">
              Projects everyone in the group can see always post. A private conversation also gets a project’s news when all its people can see the project. Tick others only if everyone who reads the target may see their issue titles and meetings.
            </p>
            {projects.length === 0 && <p className="text-sm text-muted-foreground">No projects with issues yet.</p>}
            {projects.map((w) => {
              const open = w.access === 'group'
              return (
                <label key={w.id} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    disabled={open}
                    checked={open || ticked.includes(w.id)}
                    onChange={(e) => setTicked((now) => toggle(now, w.id, e.target.checked))}
                  />
                  <span className="min-w-0 flex-1 truncate">{w.title}</span>
                  <span className="text-xs text-muted-foreground">{open ? 'Everyone' : w.access === 'collection' ? 'Collection' : 'Members only'}</span>
                </label>
              )
            })}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <LoaderCircle className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WebhookRow({ feed, channels }: { feed: ChatFeed; channels: Conversation[] }) {
  const refresh = useRefresh()
  const [setup, setSetup] = useState<{ token: string | null } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [now] = useState(Date.now)
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof updateChatFeed>[1]) => updateChatFeed(feed.id, patch),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const rotate = useMutation({
    mutationFn: () => rotateChatWebhookToken(feed.id),
    onSuccess: (token) => setSetup({ token }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => deleteChatFeed(feed),
    onSuccess: async () => {
      setRemoving(false)
      await refresh()
      toast.success(`${feed.name} removed`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Row
      icon={<Webhook className="size-4" />}
      title={feed.name}
      detail={!feed.enabled ? 'Switched off: posts to it are refused.' : feed.last_posted_at ? `Webhook · last posted ${timeAgo(feed.last_posted_at, now)}` : 'Webhook · nothing posted yet'}
      muted={!feed.enabled}
    >
      <TargetPicker
        label={`Where ${feed.name} posts`}
        value={feed.conversation_id}
        targets={channels}
        onChange={(value) => update.mutate({ conversation_id: value })}
        disabled={update.isPending}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`More for ${feed.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setSetup({ token: null })}>How to connect…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => rotate.mutate()}>New URL…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => update.mutate({ enabled: !feed.enabled })}>{feed.enabled ? 'Switch off' : 'Switch on'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
            Remove…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {setup && (
        <SetupDialog
          title={setup.token ? 'New webhook URL' : feed.name}
          description={setup.token ? 'The old URL stopped working. Update it wherever alerts are sent from.' : 'Where tools send alerts, and how to set them up.'}
          feedId={feed.id}
          token={setup.token}
          onClose={() => setSetup(null)}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${feed.name}?`}
        description="Its URL stops working at once. Messages it already posted stay in the channel."
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Row>
  )
}

function SetupDialog({ title, description, feedId, token, onClose }: { title: string; description: string; feedId: string; token: string | null; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <WebhookSetup feedId={feedId} token={token} />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddWebhookDialog({ channels, onClose }: { channels: Conversation[]; onClose: () => void }) {
  const { team } = useCurrentTeam()
  const refresh = useRefresh()
  const activity = channels.find((c) => c.name?.toLowerCase() === 'activity')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<string>(activity?.id ?? NEW_ACTIVITY)
  const [made, setMade] = useState<{ id: string; token: string } | null>(null)
  const create = useMutation({
    mutationFn: () => createChatWebhook(team.id, name, channel === NEW_ACTIVITY ? undefined : channel),
    onSuccess: async (result) => {
      setMade(result)
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) create.mutate()
  }

  if (made) {
    return <SetupDialog title={`${name.trim()} is ready`} description="Send alerts to this URL from the tools below." feedId={made.id} token={made.token} onClose={onClose} />
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add a webhook</DialogTitle>
            <DialogDescription>A URL that AWS, Azure, tools that post to Slack, or your own scripts send alerts to. They appear in the channel you choose.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-name">Name</Label>
              <Input id="webhook-name" autoFocus maxLength={80} placeholder="AWS alarms" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">Shown as who posted the message.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Posts to</Label>
              <TargetPicker label="Where it posts" value={channel} targets={channels} onChange={setChannel} allowNewActivity className="w-full" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending && <LoaderCircle className="animate-spin" />}
              Add webhook
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
