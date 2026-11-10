import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuCheckboxItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/hooks'
import { errorMessage } from '@/lib/errors'
import { emailSettingsKey, emailSettingsQuery, saveEmailSettings, type EmailSettings } from '../api'
import { useEmailOptions } from '../hooks'

/**
 * The profile menu's Email submenu: which emails you get, for the emails the group's feature flags have on.
 * Mounted only while the submenu is open, so the settings are read then and never on page load. Toggles
 * save at once and roll back on failure.
 */
export function EmailMenu() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const settings = useQuery(emailSettingsQuery(user.id))
  const options = useEmailOptions()

  const save = useMutation({
    mutationFn: saveEmailSettings,
    onMutate: async (change) => {
      const key = emailSettingsKey(user.id)
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<EmailSettings>(key)
      if (before) queryClient.setQueryData<EmailSettings>(key, { ...before, ...change })
      return { before }
    },
    onError: (error, _change, context) => {
      if (context?.before) queryClient.setQueryData(emailSettingsKey(user.id), context.before)
      toast.error(errorMessage(error))
    },
  })

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Email me about</DropdownMenuLabel>
      {settings.isPending ? (
        <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Loading…
        </p>
      ) : settings.isError ? (
        <p className="px-2 py-1.5 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        options.map(({ key, label }) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={settings.data[key]}
            // Keep the menu open, so both can be switched in one go.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => save.mutate({ [key]: checked === true })}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))
      )}
      <p className="max-w-56 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
        Group invites always come by email.
      </p>
    </>
  )
}
