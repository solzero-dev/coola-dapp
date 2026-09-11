/** Resolve an API endpoint for both standalone service origins and Astro's mounted /api routes. */
export function apiUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl)
  if (base.pathname.startsWith('/api/')) {
    const prefix = base.pathname.replace(/\/+$/, '')
    return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, base.origin)
  }
  return new URL(path, base)
}
