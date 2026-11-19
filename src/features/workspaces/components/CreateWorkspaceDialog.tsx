import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentTeam } from '@/features/teams/hooks'
import { defaultModules, workspaceDefaultPath } from '@/features/teams/nav'
import { allowedWorkspaceTypes, defaultWorkspaceType, workspaceTypes } from '@/features/teams/permissions'
import { useCollectionView } from '@/features/collections/hooks'
import { CollectionSelect } from '@/features/collections/components/CollectionSelect'
import { defaultAccess } from '../access'
import { createWorkspace, teamCollectionsQuery, type WorkspaceAccess, type WorkspaceModule, type WorkspaceType } from '../api'
import { onOpenNewWorkspace, type NewWorkspaceRequest } from '../openCreate'
import { AccessSelect } from './AccessSelect'
import { ModulePicker } from './ModulePicker'
import { WorkspaceTypeSelect } from './WorkspaceTypeSelect'

/**
 * `trigger` lets the sidebar open it with its own menu item. The team type only
 * picks the default workspace type; any team can create any type.
 * With `listen` it has no trigger and opens on `openNewWorkspace()` instead (AppLayout mounts one), taking
 * that request's options: a fixed type, a tool that stays on, and where to go after creating.
 */
export function CreateWorkspaceDialog({ trigger, listen = false }: { trigger?: ReactNode; listen?: boolean }) {
  const { team } = useCurrentTeam()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<NewWorkspaceRequest>({})
  const { fixedType, requiredModule, createdPath } = request
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // A new one starts in the collection being looked at, with that collection's usual type (when the
  // group allows it).
  const view = useCollectionView()
  const wanted = defaultWorkspaceType[view.collection?.type ?? team.type]
  const startType = fixedType ?? (allowedWorkspaceTypes[team.type].includes(wanted) ? wanted : defaultWorkspaceType[team.type])
  const startCollection = view.collection?.id ?? null
  const [type, setType] = useState<WorkspaceType>(startType)
  const [modules, setModules] = useState<WorkspaceModule[]>(defaultModules[startType])
  // Type → default tools, until the user picks tools themselves.
  const [modulesEdited, setModulesEdited] = useState(false)
  // Collections come with the workspace list the shell already has, so this never waits.
  const collections = useSuspenseQuery(teamCollectionsQuery(team.id)).data
  const [collectionId, setCollectionId] = useState<string | null>(startCollection)
  // Who sees it follows the type and collection until the user chooses.
  const [chosenAccess, setChosenAccess] = useState<WorkspaceAccess | null>(null)
  const collection = collections.find((c) => c.id === collectionId)
  const suggested = defaultAccess(team.type, type, collectionId)
  const access = chosenAccess === 'collection' && !collection ? suggested : (chosenAccess ?? suggested)
  const noun = workspaceTypes[type].noun
  const changeType = (next: WorkspaceType) => {
    setType(next)
    if (!modulesEdited) setModules(defaultModules[next])
  }

  const create = useMutation({
    mutationFn: () => {
      const tools = requiredModule && !modules.includes(requiredModule) ? [...modules, requiredModule] : modules
      return createWorkspace(team.id, { title, description, type, modules: tools, access, collectionId })
    },
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      setOpen(false)
      const enabledTools = requiredModule && !modules.includes(requiredModule) ? [...modules, requiredModule] : modules
      navigate(createdPath ? createdPath(id) : workspaceDefaultPath(team.slug, { id, type, modules: enabledTools }))
    },
  })

  const reset = (type: WorkspaceType) => {
    setTitle('')
    setDescription('')
    setType(type)
    setModules(defaultModules[type])
    setModulesEdited(false)
    setCollectionId(startCollection)
    setChosenAccess(null)
  }

  useEffect(() => {
    if (!listen) return
    return onOpenNewWorkspace((next) => {
      setRequest(next)
      reset(next.fixedType ?? startType)
      create.reset()
      setOpen(true)
    })
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim()) create.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Start clean each time, from wherever the person is looking now.
        reset(startType)
        if (!next) {
          create.reset()
          if (listen) setRequest({})
        }
      }}
    >
      {!listen && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm">
              <Plus /> New
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New {noun}</DialogTitle>
            <DialogDescription>Group owners and admins always see it. You choose who else does.</DialogDescription>
          </DialogHeader>
          {!fixedType && (
            <div className="space-y-1.5">
              <Label htmlFor="ws-type">Type</Label>
              <WorkspaceTypeSelect id="ws-type" value={type} onChange={changeType} types={allowedWorkspaceTypes[team.type]} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ws-title">Title</Label>
            <Input
              id="ws-title"
              value={title}
              maxLength={200}
              placeholder={type === 'course' ? 'Software Engineering Fundamentals' : type === 'project' ? 'Capstone API' : 'Study group'}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-description">Description</Label>
            <Textarea
              id="ws-description"
              value={description}
              maxLength={5000}
              rows={3}
              placeholder={`What is this ${workspaceTypes[type].noun} for?`}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {collections.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="ws-collection">Collection</Label>
              <CollectionSelect id="ws-collection" value={collectionId} onChange={setCollectionId} collections={collections} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ws-access">Who can see it</Label>
            <AccessSelect id="ws-access" value={access} onChange={setChosenAccess} collection={collection} />
          </div>
          <div className="space-y-1.5">
            <Label>Tools</Label>
            <ModulePicker
              value={modules}
              onChange={(next) => {
                setModulesEdited(true)
                setModules(requiredModule && !next.includes(requiredModule) ? [...next, requiredModule] : next)
              }}
            />
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {create.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending && <LoaderCircle className="animate-spin" />}
              Create {noun}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
