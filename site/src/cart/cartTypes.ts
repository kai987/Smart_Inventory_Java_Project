export const CART_STORAGE_KEY = 'smart-inventory-cart:v1'
export const CART_SCHEMA_VERSION = 1
// Keep the v1 key readable for migration; old deployed tabs must not overwrite v2.
export const SHARED_CART_STORAGE_KEY = 'smart-inventory-cart:v2'
export const SHARED_CART_LOCK_NAME = 'smart-inventory-cart:v2:write'

export type SharedCart = CartState & {
  version: 2
  revision: number
  consumedOrders: string[]
}

export type CartItem = {
  productId: string
  quantity: number
}

export type CartState = {
  items: CartItem[]
}

export type StoredCart = {
  version: typeof CART_SCHEMA_VERSION
  items: CartItem[]
}

export type CartAction =
  | { type: 'add'; productId: string; quantity?: number }
  | { type: 'increment'; productId: string }
  | { type: 'decrement'; productId: string }
  | { type: 'setQuantity'; productId: string; quantity: number }
  | { type: 'remove'; productId: string }
  | { type: 'clear' }
  | { type: 'consume'; items: readonly CartItem[] }
