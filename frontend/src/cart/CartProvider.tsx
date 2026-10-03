import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { cartReducer } from './cartReducer'
import { readCart, writeCart } from './cartStorage'
import type { CartAction, CartItem, CartState } from './cartTypes'

export type CartContextValue = {
  state: CartState
  itemCount: number
  dispatch: React.Dispatch<CartAction>
  consumeOrder: (orderKey: string, items: readonly CartItem[]) => boolean
}

export const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, () => readCart())
  const consumedOrders = useRef(new Set<string>())
  const consumeOrder = useCallback((orderKey: string, items: readonly CartItem[]): boolean => {
    if (consumedOrders.current.has(orderKey)) return false
    consumedOrders.current.add(orderKey)
    dispatch({ type: 'consume', items })
    return true
  }, [])

  useEffect(() => {
    writeCart(state)
  }, [state])

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      itemCount: state.items.reduce((total, item) => total + item.quantity, 0),
      dispatch,
      consumeOrder,
    }),
    [consumeOrder, state],
  )

  return <CartContext value={value}>{children}</CartContext>
}

export function useCart(): CartContextValue {
  const context = use(CartContext)
  if (context === null) throw new Error('useCart must be used within CartProvider')
  return context
}
