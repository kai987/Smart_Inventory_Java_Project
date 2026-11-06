import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AuthContext } from '../auth/AuthProvider'
import { cartReducer } from './cartReducer'
import { createCartSync } from './cartSync'
import { getPendingCheckoutKey, getRestorableCheckoutItems, noteCheckoutCartEdited } from './checkoutIntent'
import type { CartAction, CartItem, CartState } from './cartTypes'

export type CartContextValue = {
  state: CartState
  itemCount: number
  dispatch: React.Dispatch<CartAction>
  consumeOrder: (orderKey: string, items: readonly CartItem[], guard?: () => boolean) => Promise<boolean>
}

export const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const auth = use(AuthContext)
  const username = auth?.user?.username
  const editedBeforeAuth = useRef(false)
  const [sync] = useState(() => createCartSync())
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot)
  const dispatch = useCallback((action: CartAction) => {
    const next = cartReducer(sync.getSnapshot(), action)
    if (username === undefined) editedBeforeAuth.current = true
    else noteCheckoutCartEdited(username, next.items)
    sync.dispatch(action)
  }, [sync, username])
  useEffect(() => {
    if (username !== undefined && editedBeforeAuth.current) {
      noteCheckoutCartEdited(username, sync.getSnapshot().items)
      editedBeforeAuth.current = false
    }
    sync.configurePending(username === undefined ? null : getRestorableCheckoutItems(username),
      (items) => username !== undefined && getRestorableCheckoutItems(username) !== null && getPendingCheckoutKey(username, items) !== null)
    return sync.start()
  }, [sync, username])

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      itemCount: state.items.reduce((total, item) => total + item.quantity, 0),
      dispatch,
      consumeOrder: sync.consumeOrder,
    }),
    [dispatch, state, sync],
  )

  return <CartContext value={value}>{children}</CartContext>
}

export function useCart(): CartContextValue {
  const context = use(CartContext)
  if (context === null) throw new Error('useCart must be used within CartProvider')
  return context
}
