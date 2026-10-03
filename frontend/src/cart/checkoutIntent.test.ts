import { describe, expect, it } from 'vitest'
import { completeCheckoutIntent, getCheckoutKey } from './checkoutIntent'

const items = [{ productId: 'P001', quantity: 1 }, { productId: 'P002', quantity: 2 }]

describe('checkout intent', () => {
  it('reuses the key for an unchanged retry, regardless of cart order', () => {
    const key = getCheckoutKey('customer', items)
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(getCheckoutKey('customer', [...items].reverse())).toBe(key)
  })

  it('separates users and changed quantities', () => {
    const first = getCheckoutKey('first', items)
    expect(getCheckoutKey('second', items)).not.toBe(first)
    expect(getCheckoutKey('first', [{ productId: 'P001', quantity: 2 }])).not.toBe(first)
  })

  it('reads the persisted intent for a remounted page', () => {
    const key = 'persisted-key-12345678'
    const fingerprint = JSON.stringify(items)
    window.sessionStorage.setItem('smart-inventory-checkout:v1:customer', JSON.stringify({ key, fingerprint }))
    expect(getCheckoutKey('customer', items)).toBe(key)
  })

  it('clears a completed intent but does not discard a newer pending attempt', () => {
    const original = getCheckoutKey('customer', items)
    const updated = getCheckoutKey('customer', [{ productId: 'P001', quantity: 3 }])
    completeCheckoutIntent('customer', original)
    expect(getCheckoutKey('customer', [{ productId: 'P001', quantity: 3 }])).toBe(updated)
    completeCheckoutIntent('customer', updated)
    expect(getCheckoutKey('customer', [{ productId: 'P001', quantity: 3 }])).not.toBe(updated)
  })
})
