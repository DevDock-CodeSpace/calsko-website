import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DangerRow, SettingsSection } from '@/components/SettingsSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { teamPath } from '@/features/teams/nav'
import { defaultModules, sortModules } from '@/features/teams/nav'
import {
  deleteWorkspace,
  setWorkspaceModules,
  updateWorkspace,
  workspaceQuery,
  type WorkspaceModule,
  type WorkspaceType,
} from '@/features/workspaces/api'
import { IssueSettingsSection } from '@/features/issues/components/IssueSettingsSection'
import { ImportSettingsSection } from '@/features/issues/import/components/ImportSettingsSection'
import { ErrorTrackingSection } from '@/features/errors/components/ErrorTrackingSection'
import { useFeature } from '@/features/flags/hooks'
import { allowedWorkspaceTypes } from '@/features/teams/permissions'
import { AccessSection } from '@/features/workspaces/components/AccessSection'
import { ModulePicker } from '@/features/workspaces/components/ModulePicker'
import { WorkspaceTypeSelect } from '@/features/workspaces/components/WorkspaceTypeSelect'
import { errorMessage } from '@/lib/errors'

export function WorkspaceSettingsPage() {
  const { workspace, can } = useCurrentWorkspace()
  const errorTracking = useFeature('error_tracking')

  if (!can.canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        Only the workspace lead and group owners/admins can change workspace settings.
      </p>
    )
  }

  return (
    <div>
      <DetailsSection key={workspace.updated_at} />
      {can.canChangeAccess && <AccessSection />}
      <ToolsSection key={workspace.modules.join()} />
      {workspace.modules.includes('issues') && <IssueSettingsSection key={workspace.issue_key} />}
      {workspace.modules.includes('issues') && <ImportSettingsSection />}
      {workspace.modules.includes('issues') && errorTracking && <ErrorTrackingSection />}
      {can.canDelete && <DangerSection />}
    </div>
  )
}

function DetailsSection() {
  const { team } = useCurrentTeam()
  const { workspace } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(workspace.title)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [type, setType] = useState<WorkspaceType>(workspace.type)
  const dirty =
    title.trim() !== workspace.title || description.trim() !== (workspace.description ?? '') || type !== workspace.type

  const save = useMutation({
    mutationFn: () => updateWorkspace(workspace.id, { title, description, type }),
    onSuccess: () => {
      toast.success('Saved')
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQuery(workspace.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', 'team', team.id] }),
        queryClient.invalidateQueries({ queryKey: ['issues', 'team'] }),
      ])
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (dirty && title.trim()) save.mutate()
  }

  return (
    <SettingsSection
      title="Details"
      description="Shown to everyone in the workspace. The type is a label; the tools below decide which tabs appear."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ws-type">Type</Label>
          <WorkspaceTypeSelect
            id="ws-type"
            value={type}
            onChange={setType}
            // Only types this group can contain (plus the current one, if it predates the rule).
            types={[...new Set([...allowedWorkspaceTypes[team.type], workspace.type])]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-title">Title</Label>
          <Input id="ws-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-description">Description</Label>
          <Textarea
            id="ws-description"
            value={description}
            maxLength={5000}
            rows={5}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={!dirty || !title.trim() || save.isPending}>
          {save.isPending && <LoaderCircle className="animate-spin" />}
          Save changes
        </Button>
      </form>
    </SettingsSection>
  )
}

function ToolsSection() {
  const { workspace } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [modules, setModules] = useState<WorkspaceModule[]>(workspace.modules)
  const dirty = sortModules(modules).join() !== sortModules(workspace.modules).join()
  const suggested = defaultModules[workspace.type]
  const isSuggested = sortModules(modules).join() === sortModules(suggested).join()

  const save = useMutation({
    mutationFn: () => setWorkspaceModules(workspace.id, modules),
    onSuccess: () => {
      toast.success('Tools updated')
      return queryClient.invalidateQueries({ queryKey: workspaceQuery(workspace.id).queryKey })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <SettingsSection
      title="Tools"
      description="Choose which tools appear as tabs in this workspace. Turning a tool off hides its tab; it doesn’t delete anything."
    >
      <div className="space-y-4">
        <ModulePicker value={modules} onChange={setModules} disabled={save.isPending} />
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <LoaderCircle className="animate-spin" />}
            Save tools
          </Button>
          {!isSuggested && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => setModules(suggested)}
            >
              Reset to {workspace.type} defaults
            </button>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}

function DangerSection() {
  const { team } = useCurrentTeam()
  const { workspace } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspace.id),
    onSuccess: async () => {
      toast.success(`${workspace.title} was deleted`)
      // Leave the page before dropping its data (see useExitTeam for why).
      await navigate(teamPath(team.slug), { replace: true })
      queryClient.removeQueries({ queryKey: ['workspaces', workspace.id] })
      await queryClient.invalidateQueries({ queryKey: ['workspaces', 'team', team.id] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <SettingsSection title="Danger zone" tone="danger" description="Irreversible actions.">
      <DangerRow
        title="Delete this workspace"
        description="Removes it, its docs, and everyone’s access to it. People stay in the group. Group-wide docs aren’t affected."
        action={
          <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${workspace.title}?`}
        description="This can’t be undone."
        confirmLabel="Delete workspace"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </SettingsSection>
  )
}
