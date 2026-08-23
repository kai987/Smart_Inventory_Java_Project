import { describe, expect, it } from 'vitest'
import { cartReducer } from './cartReducer'

describe('cartReducer', () => {
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
})
