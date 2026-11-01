import { preloadable } from '@/lib/preloadable'

/** "Who can do what" at the bottom of the group's Members page: long text, so not in the first load. */
export const roleGuide = preloadable(async () => ({ default: (await import('./components/RoleGuide')).RoleGuide }))
