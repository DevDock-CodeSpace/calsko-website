import { Check, LogOut, Mail, MessageSquareText, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmailMenu } from '@/features/email/components/EmailMenu'
import { useEmailOptions } from '@/features/email/hooks'
import { LazyFeedbackDialog } from '@/features/feedback/components/LazyFeedbackDialog'
import { preloadFeedbackDialog } from '@/features/feedback/components/feedbackDialogLoader'
import { StatusDot, StatusMark } from '@/features/status/components/StatusDot'
import { CHOOSABLE, statusLabel, writeChosen } from '@/features/status/status'
import { useChosenStatus, useUserStatus } from '@/features/status/store'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { initials } from '@/lib/utils'
import { useAuth, useSignOut, useUserIdentity } from '../hooks'

/**
 * Signed-in user in the sidebar footer: avatar + name, which opens the account
 * menu upward, as wide as the button, with the email in its header, your status, then the rest.
 * Collapsed to icons, only the avatar shows.
 */
export function UserMenu() {
  const { name, email, avatarUrl, profileUnavailable } = useUserIdentity()
  const signOut = useSignOut()
  const { user } = useAuth()
  const chosen = useChosenStatus()
  const status = useUserStatus(user.id)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const emailOptions = useEmailOptions()
  const [feedbackWanted, setFeedbackWanted] = useState(false)

  const avatar = (
    <span className="relative inline-flex shrink-0">
      <Avatar className="size-5 rounded-full">
        {/* Google avatar URLs can reject requests that send a Referer. */}
        {avatarUrl && <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback className="rounded-full text-[10px]">{initials(name)}</AvatarFallback>
      </Avatar>
      <StatusDot userId={user.id} className="size-2" />
    </span>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex flex-wrap items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={name}
              // Compact: 32px tall; collapsed to icons, the avatar fills the 32px square.
              className="h-8 min-w-0 flex-1 gap-2 py-1 group-data-[collapsible=icon]:p-1.5! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {avatar}
              <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">{name}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={6}
            // As wide as the footer button (still readable when the sidebar is collapsed).
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-xl p-1.5"
          >
            <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
              {avatar}
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                {email && (
                  <span className="truncate text-xs text-muted-foreground" title={email}>
                    {email}
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            {profileUnavailable && (
              <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                Profile couldn’t be loaded. Showing your Google account details.
              </p>
            )}
            <DropdownMenuSeparator />
            {/* Your status (features/status): one line showing it, the choices beside it (like Teams). Picked here and
                remembered in this browser; In a call and Away are automatic. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <StatusMark status={status === 'offline' ? chosen : status} className="mx-[3px]" />
                {statusLabel[status === 'offline' ? chosen : status]}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-44">
                {CHOOSABLE.map((option) => (
                  <DropdownMenuItem key={option} onSelect={() => writeChosen(option)}>
                    <StatusMark status={option} className="mx-[3px]" />
                    {statusLabel[option]}
                    {chosen === option && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* Which emails you get (features/email); read only when this opens, shown while a flag allows one. */}
            {emailOptions.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Mail />
                  Email
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-56">
                  <EmailMenu />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onPointerEnter={preloadFeedbackDialog}
              onFocus={preloadFeedbackDialog}
              onSelect={() => {
                setFeedbackWanted(true)
                setFeedbackOpen(true)
              }}
            >
              <MessageSquareText />
              Send feedback
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/privacy">
                <ShieldCheck />
                Privacy policy
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}>
              <LogOut />
              {signOut.isPending ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {feedbackWanted && <LazyFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />}
        {signOut.isError && (
          <p role="alert" className="basis-full px-2 pt-1 text-xs text-destructive">
            {signOut.error.message}
          </p>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
