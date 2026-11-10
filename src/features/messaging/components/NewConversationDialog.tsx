import { useMutation } from '@tanstack/react-query'
import { Check, LoaderCircle, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/hooks'
import type { TeamMember } from '@/features/teams/api'
import { errorMessage } from '@/lib/errors'
import { createChannel, createDirectConversation, createGroupConversation, findExistingGroup, type ConversationKind } from '../api'

export function NewConversationDialog({ teamId, people, canCreateChannel, onCreated, open: openProp, onOpenChange }: { teamId: string; people: TeamMember[]; canCreateChannel: boolean; onCreated: (id: string) => void; /** Optional: opened from outside too (Chat's first-time instructions). */ open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { user } = useAuth()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const setOpen = (next: boolean) => {
    setOwnOpen(next)
    onOpenChange?.(next)
  }
  const [kind, setKind] = useState<ConversationKind>('dm')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [peopleSearch, setPeopleSearch] = useState('')
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [existingGroupId, setExistingGroupId] = useState<string | null>(null)
  const [checkingGroup, setCheckingGroup] = useState(false)
  const create = useMutation({
    mutationFn: async () => {
      if (kind === 'channel') return createChannel(teamId, name, description)
      if (kind === 'group') return createGroupConversation(teamId, name, [user.id, ...selected.filter((id) => id !== user.id)])
      const target = selected[0]
      if (!target) throw new Error('Choose a group member.')
      return createDirectConversation(teamId, target)
    },
    onSuccess: (id) => { onCreated(id); setOpen(false); setName(''); setDescription(''); setSelected([]) },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const candidates = people.filter((person) => person.user_id !== user.id)
  const matchingCandidates = candidates.filter((person) => (person.profile?.display_name ?? 'Unnamed member').toLowerCase().includes(peopleSearch.trim().toLowerCase()))
  const selectedPeople = candidates.filter((person) => selected.includes(person.user_id))
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const startCreate = async () => {
    if (kind !== 'group') {
      create.mutate()
      return
    }
    setCheckingGroup(true)
    try {
      const existing = await findExistingGroup(teamId, [user.id, ...selected])
      if (existing) setExistingGroupId(existing)
      else create.mutate()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setCheckingGroup(false)
    }
  }
  const finishWithExisting = () => {
    if (!existingGroupId) return
    onCreated(existingGroupId)
    setExistingGroupId(null)
    setOpen(false)
    setSelected([])
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon-sm" aria-label="New conversation" title="New conversation"><Plus /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New conversation</DialogTitle><DialogDescription>Private messages are visible only to their participants.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {(['dm', 'group', ...(canCreateChannel ? ['channel' as const] : [])] as ConversationKind[]).map((option) => <Button key={option} type="button" size="sm" variant={kind === option ? 'secondary' : 'ghost'} onClick={() => { setKind(option); setSelected([]) }}>{option === 'dm' ? 'Direct' : option === 'group' ? 'Group' : 'Channel'}</Button>)}
          </div>
          {kind !== 'dm' && <><Label htmlFor="conversation-name">{kind === 'channel' ? 'Channel name' : 'Group name'}</Label><Input id="conversation-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={kind === 'channel' ? 'announcements' : 'Study partners'} required /></>}
          {kind === 'channel' && <><Label htmlFor="conversation-description">Description</Label><Textarea id="conversation-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={2} /></>}
          <div className="space-y-2">
            <Label>{kind === 'dm' ? 'Person' : 'Participants'}</Label>
            <Popover open={peoplePickerOpen} onOpenChange={(next) => {
              setPeoplePickerOpen(next)
              if (!next) setPeopleSearch('')
            }}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" aria-label={kind === 'dm' ? 'Choose a person' : 'Choose participants'} className="w-full justify-between font-normal">
                  <span className="truncate text-left">
                    {kind === 'dm'
                      ? selectedPeople[0]?.profile?.display_name ?? (selected.length ? 'Unnamed member' : 'Choose a person')
                      : selectedPeople.length
                        ? `${selectedPeople.length} people selected`
                        : 'Choose participants'}
                  </span>
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] gap-0 p-0">
                <div className="relative border-b">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    aria-label="Search people"
                    placeholder="Search people"
                    value={peopleSearch}
                    onChange={(event) => setPeopleSearch(event.target.value)}
                    className="h-9 rounded-none border-0 pl-8 shadow-none focus-visible:ring-0"
                  />
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto p-2">
                  {matchingCandidates.map((person) => {
                    const isSelected = selected.includes(person.user_id)
                    return (
                      <button
                        key={person.user_id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          if (kind === 'dm') {
                            setSelected([person.user_id])
                            setPeoplePickerOpen(false)
                            setPeopleSearch('')
                          } else {
                            toggle(person.user_id)
                          }
                        }}
                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                          isSelected
                            ? 'border-brand/50 bg-brand/5 text-foreground'
                            : 'border-border bg-background hover:bg-muted'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{person.profile?.display_name ?? 'Unnamed member'}</span>
                        <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
                          isSelected ? 'border-brand bg-brand text-brand-foreground' : 'border-input'
                        }`}>
                          {isSelected && <Check className="size-3.5" aria-hidden="true" />}
                        </span>
                      </button>
                    )
                  })}
                  {matchingCandidates.length === 0 && (
                    <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                      {candidates.length === 0 ? 'No other group members are available.' : 'No people match your search.'}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <DialogFooter><Button onClick={startCreate} disabled={create.isPending || checkingGroup || (kind === 'dm' ? selected.length !== 1 : !name.trim() || (kind === 'group' && selected.length === 0))}>{(create.isPending || checkingGroup) && <LoaderCircle className="animate-spin" />}Create</Button></DialogFooter>
      </DialogContent>
      <Dialog open={existingGroupId !== null} onOpenChange={(next) => { if (!next) setExistingGroupId(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>This group already exists</DialogTitle><DialogDescription>A group with the same participants is already in this group. Use it to keep one shared history, or create a new group with a different name.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setExistingGroupId(null)}>Create a new group</Button><Button onClick={finishWithExisting}>Use existing group</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
