import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { LogoWordmark } from '@/components/Logo'
import { groupLogoUrl, type PublicGroup } from '@/features/catalog/api'

/** The public catalog's frame: the academy's name and logo, and a way into Calsko. */
export function PublicShell({ group, signedIn, children }: { group: PublicGroup; signedIn: boolean; children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to={`/learn/${group.slug}`} className="flex min-w-0 items-center gap-2.5 font-semibold">
            {group.logo_path ? (
              <img src={groupLogoUrl(group.logo_path)} alt="" className="size-7 rounded-md object-cover" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-md bg-brand text-sm text-white">{group.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="truncate">{group.name}</span>
          </Link>
          <span className="ml-auto" />
          <Link to={signedIn ? '/app' : '/login'} className="text-sm text-muted-foreground hover:text-foreground">
            {signedIn ? 'Open Calsko' : 'Sign in'}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <footer className="mx-auto flex max-w-5xl items-center gap-2 px-4 pb-10 text-xs text-muted-foreground">
        Courses on <LogoWordmark className="h-3.5 w-auto" /> ·{' '}
        <Link to="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
      </footer>
    </div>
  )
}
