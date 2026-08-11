/**
 * File sizes, the way a person reads them.
 *
 * Its own module rather than part of the terminal formatting, because the
 * editor shows sizes too and the two must agree about the same file. Nothing
 * here may reach for anything Node-only: this is one of the modules the browser
 * compiles.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
