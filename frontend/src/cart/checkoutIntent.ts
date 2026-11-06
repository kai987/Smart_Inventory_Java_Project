import type { CartItem } from './cartTypes'
import { validCartItems } from './cartStorage'

const STORAGE_PREFIX = 'smart-inventory-checkout:v1:'
// A null entry is a completed-intent tombstone. Once this page has observed an
// intent, stale or unwritable sessionStorage must not replace its current state.
const memoryIntents = new Map<string, CheckoutIntent | null>()

type CheckoutIntent = {
  fingerprint: string
  key: string
  restoreAllowed: boolean
}

function storageKey(username: string): string {
  return STORAGE_PREFIX + encodeURIComponent(username)
}

export function checkoutFingerprint(items: readonly CartItem[]): string {
  return JSON.stringify(items.map((item) => ({ ...item })).sort((a, b) => a.productId.localeCompare(b.productId)))
}

function parseIntent(raw: string | null): CheckoutIntent | null {
  if (raw === null) return null
  const stored: unknown = JSON.parse(raw)
  if (typeof stored !== 'object' || stored === null || !('fingerprint' in stored) || !('key' in stored)
    || typeof stored.fingerprint !== 'string' || typeof stored.key !== 'string'
    || !/^[A-Za-z0-9_-]{16,128}$/.test(stored.key)
    || ('restoreAllowed' in stored && typeof stored.restoreAllowed !== 'boolean')) return null
  return { fingerprint: stored.fingerprint, key: stored.key, restoreAllowed: !('restoreAllowed' in stored) || stored.restoreAllowed !== false }
}

function saveIntent(name: string, intent: CheckoutIntent) {
  memoryIntents.set(name, intent)
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(name, JSON.stringify(intent))
  } catch {
    // Storage-restricted browsers retain changes for this page session.
  }
}

function currentIntent(name: string): CheckoutIntent | null {
  if (memoryIntents.has(name)) return memoryIntents.get(name) ?? null
  try {
    if (typeof window === 'undefined') return null
    const stored = parseIntent(window.sessionStorage.getItem(name))
    if (stored !== null) memoryIntents.set(name, stored)
    return stored
  } catch {
    return null
  }
}

export function getPendingCheckoutKey(username: string, items: readonly CartItem[]): string | null {
  const intent = currentIntent(storageKey(username))
  return intent?.fingerprint === checkoutFingerprint(items) ? intent.key : null
}

/** Restore the frozen retry payload after another tab changes the shared cart. */
export function getPendingCheckoutItems(username: string): CartItem[] | null {
  const intent = currentIntent(storageKey(username))
  if (intent === null) return null
  try {
    const items: unknown = JSON.parse(intent.fingerprint)
    return validCartItems(items) && checkoutFingerprint(items) === intent.fingerprint
      ? items.map((item) => ({ productId: item.productId, quantity: item.quantity })) : null
  } catch {
    return null
  }
}

export function getRestorableCheckoutItems(username: string): CartItem[] | null {
  return currentIntent(storageKey(username))?.restoreAllowed === true ? getPendingCheckoutItems(username) : null
}

/** Explicit edits belong to this tab; remote shared-cart updates must NOT call this. */
export function noteCheckoutCartEdited(username: string, items: readonly CartItem[]): void {
  const name = storageKey(username)
  const intent = currentIntent(name)
  if (intent === null) return
  const fingerprint = checkoutFingerprint(items)
  const restoreAllowed = intent.fingerprint === fingerprint
  if (intent.restoreAllowed !== restoreAllowed) saveIntent(name, { ...intent, restoreAllowed })
}

export function getCheckoutKey(username: string, items: readonly CartItem[]): string {
  const name = storageKey(username)
  const fingerprint = checkoutFingerprint(items)
  const intent = currentIntent(name)
  if (intent?.fingerprint === fingerprint) {
    if (!intent.restoreAllowed) saveIntent(name, { ...intent, restoreAllowed: true })
    return intent.key
  }
  const next = { fingerprint, key: crypto.randomUUID(), restoreAllowed: true }
  saveIntent(name, next)
  return next.key
}

export function completeCheckoutIntent(username: string, key: string): void {
  const name = storageKey(username)
  const intent = currentIntent(name)
  if (intent === null || intent.key === key) memoryIntents.set(name, null)
  try {
    if (typeof window === 'undefined') return
    const storage = window.sessionStorage
    if (parseIntent(storage.getItem(name))?.key === key) storage.removeItem(name)
  } catch {
    // A successful order remains safe even when storage is unavailable.
  }
}
