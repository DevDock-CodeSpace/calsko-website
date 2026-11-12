import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LogoMark } from '@/components/Logo'
import { PageHeader } from '@/components/PageHeader'
import { DangerRow, SettingsSection } from '@/components/SettingsSection'
import { CatalogSettingsSection } from '@/features/catalog/components/CatalogSettingsSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/hooks'
import { TeamReposSection } from '@/features/repos/components/TeamReposSection'
import { ChatFeedsSection } from '@/features/feeds/components/ChatFeedsSection'
import {
  deleteTeam,
  removeTeamLogo,
  removeTeamMember,
  teamLogoUrl,
  updateTeam,
  uploadTeamLogo,
  type TeamType,
} from '@/features/teams/api'
import { CollectionsSection } from '@/features/collections/components/CollectionsSection'
import { useCurrentTeam, useExitTeam } from '@/features/teams/hooks'
import { defaultWorkspaceType, teamRoleName, teamTypes, workspaceTypes } from '@/features/teams/permissions'
import { errorMessage } from '@/lib/errors'

export function TeamSettingsPage() {
  const { team, role, can, features } = useCurrentTeam()

  return (
    <>
      <PageHeader title="Group settings" description={`${team.name} · your role: ${teamRoleName(role, team.type)}`} />
      <div>
        <GeneralSection key={team.id} />
        <BrandingSection />
        {team.type !== 'development' && <CatalogSettingsSection />}
        {can.canManageWorkspaces && <CollectionsSection />}
        <TeamReposSection />
        {can.isAdmin && features.includes('chat_feeds') && <ChatFeedsSection />}
        {(can.canLeave || can.canDelete) && <DangerSection />}
      </div>
    </>
  )
}

function GeneralSection() {
  const { team, can } = useCurrentTeam()
  const queryClient = useQueryClient()
  const [name, setName] = useState(team.name)
  const [type, setType] = useState<TeamType>(team.type)
  const dirty = name.trim().length > 0 && (name.trim() !== team.name || type !== team.type)

  const save = useMutation({
    mutationFn: () => updateTeam(team.id, { name, type }),
    onSuccess: () => {
      toast.success('Saved')
      return queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (dirty) save.mutate()
  }

  return (
    <SettingsSection
      title="General"
      description={
        can.canEditTeam
          ? type === 'development'
            ? 'Development groups have projects and spaces (no courses), and an Issues page across all projects.'
            : type === 'learning'
              ? `Learning groups have courses, plus projects and spaces for student work. New items default to a ${workspaceTypes[defaultWorkspaceType[type]].noun}.`
              : 'General groups suit an organization that teaches and builds: courses, projects and spaces together, with an Issues page across all projects.'
          : 'Only owners and admins can change these.'
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="team-name">Name</Label>
          <Input
            id="team-name"
            value={name}
            maxLength={100}
            disabled={!can.canEditTeam}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as TeamType)} disabled={!can.canEditTeam}>
            <SelectTrigger id="team-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(teamTypes) as TeamType[]).map((value) => {
                const { label, hint, icon: Icon } = teamTypes[value]
                return (
                  <SelectItem key={value} value={value}>
                    <Icon className="text-muted-foreground" />
                    {label}
                    <span className="text-xs text-muted-foreground">· {hint}</span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>URL</Label>
          <p className="font-mono text-sm text-muted-foreground">/t/{team.slug}</p>
        </div>
        {can.canEditTeam && (
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
            {save.isPending && <LoaderCircle className="animate-spin" />}
            Save changes
          </Button>
        )}
      </form>
    </SettingsSection>
  )
}

function BrandingSection() {
  const { team, can } = useCurrentTeam()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['teams'] })

  const upload = useMutation({
    mutationFn: (file: File) => uploadTeamLogo(team.id, team.logo_path, file),
    onSuccess: () => {
      toast.success('Logo updated')
      return invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: () => removeTeamLogo(team.id, team.logo_path ?? ''),
    onSuccess: () => {
      toast.success('Logo removed')
      return invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) upload.mutate(file)
  }

  return (
    <SettingsSection
      title="Logo"
      description={
        can.canEditTeam
          ? 'Shown in the sidebar in place of the Calsko mark. A square PNG, JPG or WebP works best (max 2 MB).'
          : 'Only owners and admins can change the logo.'
      }
    >
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {team.logo_path ? (
            <img src={teamLogoUrl(team.logo_path)} alt="" className="size-full object-cover" />
          ) : (
            <LogoMark className="size-9 object-contain" />
          )}
        </div>
        {can.canEditTeam && (
          <div className="flex items-center gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={pick}
            />
            <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending && <LoaderCircle className="animate-spin" />}
              {team.logo_path ? 'Change' : 'Upload'}
            </Button>
            {team.logo_path && (
              <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

function DangerSection() {
  const { user } = useAuth()
  const { team, can } = useCurrentTeam()
  const exitTeam = useExitTeam()
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null)
  const [typed, setTyped] = useState('')

  const leave = useMutation({
    mutationFn: () => removeTeamMember(team.id, user.id),
    onSuccess: async () => {
      toast.success(`You left ${team.name}`)
      await exitTeam(team.id)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: () => deleteTeam(team.id),
    onSuccess: async () => {
      toast.success(`${team.name} was deleted`)
      await exitTeam(team.id)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <SettingsSection title="Danger zone" tone="danger" description="These can’t be undone from here.">
      {can.canLeave && (
        <DangerRow
          title="Leave group"
          description="You’ll lose access to this group and all of its spaces. You’ll need a new invite to come back."
          action={
            <Button variant="outline" size="sm" onClick={() => setConfirm('leave')}>
              Leave
            </Button>
          }
        />
      )}
      {can.canDelete && (
        <DangerRow
          title="Delete group"
          description="Permanently deletes the group, its spaces, memberships, and invite codes."
          action={
            <Button variant="destructive" size="sm" onClick={() => setConfirm('delete')}>
              Delete
            </Button>
          }
        />
      )}

      <ConfirmDialog
        open={confirm === 'leave'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Leave ${team.name}?`}
        description="You’ll need a new invite code to come back."
        confirmLabel="Leave"
        pending={leave.isPending}
        onConfirm={() => leave.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null)
            setTyped('')
          }
        }}
        title={`Delete ${team.name}?`}
        description="Everyone loses access immediately. Type the group name to confirm."
        confirmLabel="Delete forever"
        pending={remove.isPending}
        confirmDisabled={typed !== team.name}
        onConfirm={() => remove.mutate()}
      >
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={team.name} aria-label="Group name" />
      </ConfirmDialog>
    </SettingsSection>
  )
}
