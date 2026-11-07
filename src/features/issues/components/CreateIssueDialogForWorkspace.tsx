import { CreateIssueDialogForm, type CreateIssueDialogProps } from './CreateIssueDialog'
import { useIssueContextForWorkspace } from '../useIssueContextForWorkspace'
import type { HubProject } from '../hub/hooks'

export function CreateIssueDialogForWorkspace({
  project,
  ...props
}: CreateIssueDialogProps & { project: HubProject }) {
  const context = useIssueContextForWorkspace(project)
  return <CreateIssueDialogForm {...props} context={context} />
}
