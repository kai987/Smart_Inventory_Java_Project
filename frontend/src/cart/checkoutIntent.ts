import type { CartItem } from './cartTypes'

const STORAGE_PREFIX = 'smart-inventory-checkout:v1:'
const memoryIntents = new Map<string, CheckoutIntent>()

type CheckoutIntent = {
  fingerprint: string
  key: string
}

function storageKey(username: string): string {
  return STORAGE_PREFIX + encodeURIComponent(username)
}

export function checkoutFingerprint(items: readonly CartItem[]): string {
  return JSON.stringify(items.map((item) => ({ ...item })).sort((a, b) => a.productId.localeCompare(b.productId)))
}

export function getPendingCheckoutKey(username: string, items: readonly CartItem[]): string | null {
  const name = storageKey(username)
  const fingerprint = checkoutFingerprint(items)
  try {
    const raw = window.sessionStorage.getItem(name)
    if (raw === null) return null
    const stored: unknown = JSON.parse(raw)
    if (typeof stored === 'object' && stored !== null && 'fingerprint' in stored && 'key' in stored
      && stored.fingerprint === fingerprint && typeof stored.key === 'string'
      && /^[A-Za-z0-9_-]{16,128}$/.test(stored.key)) return stored.key
    return null
  } catch {
    const intent = memoryIntents.get(name)
    return intent?.fingerprint === fingerprint ? intent.key : null
  }
}

export function getCheckoutKey(username: string, items: readonly CartItem[]): string {
  const name = storageKey(username)
  const fingerprint = checkoutFingerprint(items)
  let intent = memoryIntents.get(name)
  try {
    const raw = window.sessionStorage.getItem(name)
    if (raw !== null) {
      const stored: unknown = JSON.parse(raw)
      if (typeof stored === 'object' && stored !== null && 'fingerprint' in stored && 'key' in stored
        && typeof stored.fingerprint === 'string' && typeof stored.key === 'string'
        && /^[A-Za-z0-9_-]{16,128}$/.test(stored.key)) {
        intent = { fingerprint: stored.fingerprint, key: stored.key }
      }
    } else {
      intent = undefined
    }
  } catch {
    // Memory still protects retries when browser storage is unavailable.
  }
  if (intent?.fingerprint === fingerprint) return intent.key
  const next = { fingerprint, key: crypto.randomUUID() }
  memoryIntents.set(name, next)
  try {
    window.sessionStorage.setItem(name, JSON.stringify(next))
  } catch {
    // Storage-restricted browsers retain the key for this page session.
  }
  return next.key
}

export function completeCheckoutIntent(username: string, key: string): void {
  const name = storageKey(username)
  if (memoryIntents.get(name)?.key === key) memoryIntents.delete(name)
  try {
    const raw = window.sessionStorage.getItem(name)
    if (raw !== null) {
      const stored: unknown = JSON.parse(raw)
      if (typeof stored === 'object' && stored !== null && 'key' in stored && stored.key === key) {
        window.sessionStorage.removeItem(name)
      }
    }
  } catch {
    // A successful order remains safe even when storage is unavailable.
  }
}
