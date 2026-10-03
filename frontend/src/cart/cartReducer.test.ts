import { describe, expect, it } from 'vitest'
import { cartReducer } from './cartReducer'

describe('cartReducer', () => {
  it('only consumes purchased quantities and preserves items added after submission', () => {
    const state = { items: [{ productId: 'P001', quantity: 3 }, { productId: 'P002', quantity: 2 }] }
    expect(cartReducer(state, { type: 'consume', items: [{ productId: 'P001', quantity: 1 }] }).items)
      .toEqual([{ productId: 'P001', quantity: 2 }, { productId: 'P002', quantity: 2 }])
    expect(cartReducer(state, { type: 'consume', items: [{ productId: 'P001', quantity: 10 }] }).items)
      .toEqual([{ productId: 'P002', quantity: 2 }])
  })
  it('merges repeated product additions', () => {
    const first = cartReducer({ items: [] }, { type: 'add', productId: 'P001', quantity: 1 })
    const second = cartReducer(first, { type: 'add', productId: 'P001', quantity: 2 })
    expect(second.items).toEqual([{ productId: 'P001', quantity: 3 }])
  })

  it('decrements and removes the item at zero', () => {
    const state = { items: [{ productId: 'P001', quantity: 2 }] }
    const decremented = cartReducer(state, { type: 'decrement', productId: 'P001' })
    expect(decremented.items[0]?.quantity).toBe(1)
    expect(cartReducer(decremented, { type: 'decrement', productId: 'P001' }).items).toEqual([])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'preserves the item when setQuantity receives invalid quantity %s',
    (quantity) => {
      const state = { items: [{ productId: 'P001', quantity: 2 }] }
      expect(cartReducer(state, { type: 'setQuantity', productId: 'P001', quantity })).toBe(state)
    },
  )
})
