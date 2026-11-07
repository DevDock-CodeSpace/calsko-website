import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { HubProject } from '@/features/issues/hub/hooks'

export function PlanProjectPickerDialog({
  projects,
  open,
  onOpenChange,
  onSelect,
}: {
  projects: HubProject[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (projectId: string) => void
}) {
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a project</DialogTitle>
          <DialogDescription>Where should this plan issue be created?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="plan-issue-project">Project</Label>
          <select
            id="plan-issue-project"
            value={selectedProject?.id ?? ''}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => selectedProject && onSelect(selectedProject.id)} disabled={!selectedProject}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
