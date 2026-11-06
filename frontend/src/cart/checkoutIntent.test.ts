import { beforeEach, describe, expect, it, vi } from 'vitest'

let checkout: typeof import('./checkoutIntent')

beforeEach(async () => {
  // Model a fresh page per test without weakening runtime memory authority.
  vi.resetModules()
  checkout = await import('./checkoutIntent')
})

const items = [{ productId: 'P001', quantity: 1 }, { productId: 'P002', quantity: 2 }]

describe('checkout intent', () => {
  it('reuses the key for an unchanged retry, regardless of cart order', () => {
    const key = checkout.getCheckoutKey('customer', items)
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(checkout.getCheckoutKey('customer', [...items].reverse())).toBe(key)
  })

  it('separates users and changed quantities', () => {
    const first = checkout.getCheckoutKey('first', items)
    expect(checkout.getCheckoutKey('second', items)).not.toBe(first)
    expect(checkout.getCheckoutKey('first', [{ productId: 'P001', quantity: 2 }])).not.toBe(first)
  })

  it('reads the persisted intent for a remounted page', () => {
    const key = 'persisted-key-12345678'
    const fingerprint = JSON.stringify(items)
    window.sessionStorage.setItem('smart-inventory-checkout:v1:customer', JSON.stringify({ key, fingerprint }))
    expect(checkout.getPendingCheckoutKey('customer', items)).toBe(key)
    expect(checkout.getCheckoutKey('customer', items)).toBe(key)
    expect(checkout.getPendingCheckoutItems('customer')).toEqual(items)
  })

  it.each([
    '{broken',
    JSON.stringify([{ productId: 'P001', quantity: 0 }]),
    JSON.stringify([{ productId: 'P001', quantity: Number.MAX_SAFE_INTEGER + 1 }]),
    JSON.stringify([{ productId: 'P001', quantity: 1 }, { productId: 'P001', quantity: 1 }]),
    JSON.stringify([...items].reverse()),
  ])('does not restore malformed or noncanonical pending items (%s)', (fingerprint) => {
    sessionStorage.setItem('smart-inventory-checkout:v1:customer', JSON.stringify({ key: 'persisted-key-12345678', fingerprint }))
    expect(checkout.getPendingCheckoutItems('customer')).toBeNull()
  })

  it('clears a completed intent but does not discard a newer pending attempt', () => {
    const original = checkout.getCheckoutKey('customer', items)
    const updated = checkout.getCheckoutKey('customer', [{ productId: 'P001', quantity: 3 }])
    checkout.completeCheckoutIntent('customer', original)
    expect(checkout.getCheckoutKey('customer', [{ productId: 'P001', quantity: 3 }])).toBe(updated)
    checkout.completeCheckoutIntent('customer', updated)
    expect(checkout.getCheckoutKey('customer', [{ productId: 'P001', quantity: 3 }])).not.toBe(updated)
  })

  it('keeps an uncertain key but does not restore a cart explicitly changed in this tab after reload', async () => {
    const key = checkout.getCheckoutKey('customer', items)
    checkout.noteCheckoutCartEdited('customer', [])
    expect(checkout.getRestorableCheckoutItems('customer')).toBeNull()
    expect(checkout.getPendingCheckoutKey('customer', items)).toBe(key)
    vi.resetModules()
    const reloaded = await import('./checkoutIntent')
    expect(reloaded.getRestorableCheckoutItems('customer')).toBeNull()
    expect(reloaded.getPendingCheckoutKey('customer', items)).toBe(key)
    reloaded.noteCheckoutCartEdited('customer', items)
    expect(reloaded.getRestorableCheckoutItems('customer')).toEqual(items)
    expect(reloaded.getCheckoutKey('customer', items)).toBe(key)
  })

  it('changes only the current account intent and retains other account metadata unchanged', async () => {
    const key = checkout.getCheckoutKey('customer', items)
    const otherKey = checkout.getCheckoutKey('another-customer', items)
    const otherRaw = sessionStorage.getItem('smart-inventory-checkout:v1:another-customer')
    checkout.noteCheckoutCartEdited('customer', [])
    expect(sessionStorage.getItem('smart-inventory-checkout:v1:another-customer')).toBe(otherRaw)
    vi.resetModules()
    const reloaded = await import('./checkoutIntent')
    expect(reloaded.getRestorableCheckoutItems('customer')).toBeNull()
    expect(reloaded.getPendingCheckoutKey('customer', items)).toBe(key)
    expect(reloaded.getRestorableCheckoutItems('another-customer')).toEqual(items)
    expect(reloaded.getPendingCheckoutKey('another-customer', items)).toBe(otherKey)
  })

  it('retains a retry key when writes fail but sessionStorage reads return null', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const key = checkout.getCheckoutKey('customer', items)
    expect(window.sessionStorage.getItem('smart-inventory-checkout:v1:customer')).toBeNull()
    expect(checkout.getPendingCheckoutKey('customer', items)).toBe(key)
    expect(checkout.getCheckoutKey('customer', [...items].reverse())).toBe(key)
  })

  it('does not replace a newer in-memory intent with an older persisted cart when overwrites fail', () => {
    const original = checkout.getCheckoutKey('customer', items)
    const persisted = window.sessionStorage.getItem('smart-inventory-checkout:v1:customer')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const changedItems = [{ productId: 'P001', quantity: 3 }]
    const next = checkout.getCheckoutKey('customer', changedItems)
    expect(next).not.toBe(original)
    expect(window.sessionStorage.getItem('smart-inventory-checkout:v1:customer')).toBe(persisted)
    expect(checkout.getPendingCheckoutKey('customer', items)).toBeNull()
    expect(checkout.getPendingCheckoutKey('customer', changedItems)).toBe(next)
    expect(checkout.getCheckoutKey('customer', changedItems)).toBe(next)
  })

  it('does not share fallback keys across users or changed carts', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const first = checkout.getCheckoutKey('first', items)
    const second = checkout.getCheckoutKey('second', items)
    const changedItems = [{ productId: 'P001', quantity: 3 }]
    const changed = checkout.getCheckoutKey('first', changedItems)
    expect(first).not.toBe(second)
    expect(changed).not.toBe(first)
    expect(checkout.getPendingCheckoutKey('first', items)).toBeNull()
    expect(checkout.getPendingCheckoutKey('second', items)).toBe(second)
    expect(checkout.getCheckoutKey('first', changedItems)).toBe(changed)
  })

  it('keeps the fallback usable when the sessionStorage property throws', () => {
    const getter = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    try {
      const key = checkout.getCheckoutKey('customer', items)
      expect(checkout.getPendingCheckoutKey('customer', items)).toBe(key)
      expect(checkout.getCheckoutKey('customer', items)).toBe(key)
      checkout.completeCheckoutIntent('customer', key)
      expect(checkout.getPendingCheckoutKey('customer', items)).toBeNull()
      expect(checkout.getCheckoutKey('customer', items)).not.toBe(key)
    } finally {
      getter.mockRestore()
    }
  })

  it('does not resurrect a completed stored key when cleanup and later writes both fail', () => {
    const completed = checkout.getCheckoutKey('customer', items)
    const persisted = window.sessionStorage.getItem('smart-inventory-checkout:v1:customer')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    checkout.completeCheckoutIntent('customer', completed)
    expect(window.sessionStorage.getItem('smart-inventory-checkout:v1:customer')).toBe(persisted)
    expect(checkout.getPendingCheckoutKey('customer', items)).toBeNull()
    const next = checkout.getCheckoutKey('customer', items)
    expect(next).not.toBe(completed)
    expect(checkout.getCheckoutKey('customer', items)).toBe(next)
    expect(checkout.getPendingCheckoutKey('customer', items)).toBe(next)
  })

  it('preserves a newer pending fallback when cleanup of an older completed order fails', () => {
    const original = checkout.getCheckoutKey('customer', items)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const changedItems = [{ productId: 'P001', quantity: 3 }]
    const next = checkout.getCheckoutKey('customer', changedItems)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    checkout.completeCheckoutIntent('customer', original)
    expect(checkout.getPendingCheckoutKey('customer', changedItems)).toBe(next)
    expect(checkout.getCheckoutKey('customer', changedItems)).toBe(next)
    expect(checkout.getPendingCheckoutKey('customer', items)).toBeNull()
  })

  it.each([
    '{broken',
    JSON.stringify(null),
    JSON.stringify({}),
    JSON.stringify({ fingerprint: JSON.stringify(items), key: 'short' }),
    JSON.stringify({ fingerprint: JSON.stringify(items), key: 'invalid key with spaces' }),
    JSON.stringify({ fingerprint: JSON.stringify(items), key: 'a'.repeat(129) }),
    JSON.stringify({ fingerprint: 123, key: 'valid-looking-key-12345' }),
  ])('rejects malformed persisted checkout data without losing retry protection (%s)', (raw) => {
    window.sessionStorage.setItem('smart-inventory-checkout:v1:customer', raw)
    expect(checkout.getPendingCheckoutKey('customer', items)).toBeNull()
    const key = checkout.getCheckoutKey('customer', items)
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(checkout.getPendingCheckoutKey('customer', items)).toBe(key)
    expect(checkout.getCheckoutKey('customer', items)).toBe(key)
  })

  it('supports retry protection without browser globals', () => {
    vi.stubGlobal('window', undefined)
    try {
      const key = checkout.getCheckoutKey('customer', items)
      expect(checkout.getPendingCheckoutKey('customer', items)).toBe(key)
      expect(checkout.getCheckoutKey('customer', items)).toBe(key)
      checkout.completeCheckoutIntent('customer', key)
      expect(checkout.getPendingCheckoutKey('customer', items)).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
