export type FilesSort = { by: 'updated' | 'name'; dir: 'asc' | 'desc' }

export type FilesLocationState = {
  filesReturnTo: string
  filesSearch?: string
  filesSort?: FilesSort
}

export function readFilesLocationState(state: unknown, listPath: string): FilesLocationState | null {
  if (!state || typeof state !== 'object') return null
  const value = state as Record<string, unknown>
  const filesReturnTo = value.filesReturnTo
  if (typeof filesReturnTo !== 'string' || (filesReturnTo !== listPath && !filesReturnTo.startsWith(`${listPath}?`))) return null
  const filesSort = value.filesSort
  const validSort =
    filesSort !== null &&
    typeof filesSort === 'object' &&
    ((filesSort as Record<string, unknown>).by === 'updated' || (filesSort as Record<string, unknown>).by === 'name') &&
    ((filesSort as Record<string, unknown>).dir === 'asc' || (filesSort as Record<string, unknown>).dir === 'desc')

  return {
    filesReturnTo,
    ...(typeof value.filesSearch === 'string' ? { filesSearch: value.filesSearch } : {}),
    ...(validSort ? { filesSort: filesSort as FilesSort } : {}),
  }
}
