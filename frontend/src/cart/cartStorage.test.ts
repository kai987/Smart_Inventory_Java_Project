import { describe, expect, it } from 'vitest'
import { CART_STORAGE_KEY } from './cartTypes'
import { readCart } from './cartStorage'

describe('cartStorage', () => {
  it('discards corrupted localStorage data', () => {
    window.localStorage.setItem(CART_STORAGE_KEY, '{broken')
    expect(readCart()).toEqual({ items: [] })
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull()
  })

  it('rejects an unsupported schema version', () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 2, items: [{ productId: 'P001', quantity: 1 }] }))
    expect(readCart()).toEqual({ items: [] })
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull()
  })

  it('discards stored carts with duplicate product rows', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [
          { productId: 'P001', quantity: 1 },
          { productId: 'P001', quantity: 2 },
        ],
      }),
    )

    expect(readCart()).toEqual({ items: [] })
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull()
  })
})
