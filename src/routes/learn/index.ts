// The public catalog's pages, in one lazy chunk: two separate ones made the bundler regroup the app's
// shared chunks (a heavier first load).
export { CatalogPage } from './CatalogPage'
export { PublicCoursePage } from './PublicCoursePage'
export { catalogLoader, publicCourseLoader } from '@/features/catalog/loaders'
