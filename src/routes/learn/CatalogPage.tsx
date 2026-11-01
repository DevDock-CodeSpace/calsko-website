import { useSuspenseQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { Link, useLoaderData, useParams } from 'react-router'
import { publicCatalogQuery, type PublicPerson } from '@/features/catalog/api'
import type { catalogLoader } from '@/features/catalog/loaders'
import { formatPrice, visitorCurrency } from '@/features/catalog/price'
import { PublicShell } from './PublicShell'

/** /learn/:teamSlug: an academy's published courses, for anyone. */
export function CatalogPage() {
  const { teamSlug = '' } = useParams()
  const { userId } = useLoaderData<typeof catalogLoader>()
  const catalog = useSuspenseQuery(publicCatalogQuery(teamSlug)).data!
  const currency = visitorCurrency()
  return (
    <PublicShell group={catalog.group} signedIn={userId !== null}>
      <h1 className="text-3xl font-semibold tracking-tight">Courses</h1>
      <p className="mt-2 text-muted-foreground">
        {catalog.courses.length} {catalog.courses.length === 1 ? 'course' : 'courses'} from {catalog.group.name}.
      </p>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {catalog.courses.map((course) => (
          <li key={course.id}>
            <Link to={`/learn/${teamSlug}/${course.id}`} className="flex h-full flex-col gap-3 rounded-xl border p-5 transition-colors hover:border-foreground/30">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold leading-snug">{course.title}</h2>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-sm font-medium">{formatPrice(course, currency)}</span>
              </div>
              <Teachers people={course.teachers} />
              {course.description && <p className="line-clamp-3 text-sm text-muted-foreground">{course.description}</p>}
              <p className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <BookOpen className="size-3.5" /> {course.lessons} {course.lessons === 1 ? 'lesson' : 'lessons'}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </PublicShell>
  )
}

function Teachers({ people }: { people: PublicPerson[] }) {
  if (people.length === 0) return null
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex -space-x-1.5">
        {people.slice(0, 3).map((p, i) =>
          p.avatar_url ? (
            <img key={i} src={p.avatar_url} alt="" className="size-6 rounded-full object-cover ring-2 ring-background" />
          ) : (
            <span key={i} className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
              {(p.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
          ),
        )}
      </span>
      {people.map((p) => p.name ?? 'Teacher').join(', ')}
    </p>
  )
}
