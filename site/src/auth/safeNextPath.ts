export function safeNextPath(value: string | null): string | null {
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/')) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
