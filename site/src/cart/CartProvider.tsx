import { createContext, use, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { cartReducer } from './cartReducer'
import { readCart, writeCart } from './cartStorage'
import type { CartAction, CartState } from './cartTypes'

export type CartContextValue = {
  state: CartState
  itemCount: number
  dispatch: React.Dispatch<CartAction>
}

export const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, () => readCart())

  useEffect(() => {
    writeCart(state)
  }, [state])

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      itemCount: state.items.reduce((total, item) => total + item.quantity, 0),
      dispatch,
    }),
    [state],
  )

  return <CartContext value={value}>{children}</CartContext>
}

export function useCart(): CartContextValue {
  const context = use(CartContext)
  if (context === null) throw new Error('useCart must be used within CartProvider')
  return context
}
