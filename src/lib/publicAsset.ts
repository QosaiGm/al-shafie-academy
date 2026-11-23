/** Build a URL for files in /public that also works on a GitHub Pages project path. */
export function publicAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

/** Return to this app after Supabase auth, preserving the deployed project path. */
export function appRedirectUrl(route = ''): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = route ? `#${route.startsWith('/') ? route : `/${route}`}` : ''
  return url.toString()
}

