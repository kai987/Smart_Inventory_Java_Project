import type { CartAction, CartState } from './cartTypes'

export const emptyCart: CartState = { items: [] }

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const quantity = action.quantity ?? 1
      if (!Number.isInteger(quantity) || quantity < 1) return state
      const existing = state.items.find((item) => item.productId === action.productId)
      if (existing === undefined) {
        return { items: [...state.items, { productId: action.productId, quantity }] }
      }
      return {
        items: state.items.map((item) =>
          item.productId === action.productId ? { ...item, quantity: item.quantity + quantity } : item,
        ),
      }
    }
    case 'increment':
      return {
        items: state.items.map((item) =>
          item.productId === action.productId ? { ...item, quantity: item.quantity + 1 } : item,
        ),
      }
    case 'decrement':
      return {
        items: state.items.flatMap((item) => {
          if (item.productId !== action.productId) return [item]
          return item.quantity <= 1 ? [] : [{ ...item, quantity: item.quantity - 1 }]
        }),
      }
    case 'setQuantity': {
      if (!Number.isSafeInteger(action.quantity) || action.quantity < 1) return state
      return {
        items: state.items.map((item) =>
          item.productId === action.productId ? { ...item, quantity: action.quantity } : item,
        ),
      }
    }
    case 'remove':
      return { items: state.items.filter((item) => item.productId !== action.productId) }
    case 'clear':
      return emptyCart
  }
}
