import { describe, expect, it, vi } from 'vitest'
import { CART_STORAGE_KEY } from './cartTypes'
import { readCart, writeCart } from './cartStorage'

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

  it('falls back to an empty cart when getItem is blocked without trying to remove unreadable data', () => {
    const storage = {
      getItem: vi.fn(() => { throw new DOMException('Storage access denied', 'SecurityError') }),
      removeItem: vi.fn(),
    }
    expect(readCart(storage)).toEqual({ items: [] })
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('does not throw when removing a corrupted cart is also blocked', () => {
    const storage = {
      getItem: vi.fn(() => '{broken'),
      removeItem: vi.fn(() => { throw new DOMException('Storage access denied', 'SecurityError') }),
    }
    expect(readCart(storage)).toEqual({ items: [] })
    expect(storage.removeItem).toHaveBeenCalledWith(CART_STORAGE_KEY)
  })

  it('catches access errors from the localStorage property itself', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    try {
      expect(readCart()).toEqual({ items: [] })
      expect(() => writeCart({ items: [{ productId: 'P001', quantity: 2 }] })).not.toThrow()
    } finally {
      getter.mockRestore()
    }
  })

  it('keeps the existing schema when persisting a cart', () => {
    const setItem = vi.fn()
    const state = { items: [{ productId: 'P001', quantity: 2 }] }
    writeCart(state, { setItem })
    expect(setItem).toHaveBeenCalledWith(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: state.items }))
  })

  it('does not throw or mutate in-memory state when writing exceeds the storage quota', () => {
    const state = { items: [{ productId: 'P001', quantity: 2 }] }
    const setItem = vi.fn(() => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError') })
    expect(() => writeCart(state, { setItem })).not.toThrow()
    expect(state).toEqual({ items: [{ productId: 'P001', quantity: 2 }] })
  })

  it('works without browser globals', () => {
    vi.stubGlobal('window', undefined)
    try {
      expect(readCart()).toEqual({ items: [] })
      expect(() => writeCart({ items: [] })).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
