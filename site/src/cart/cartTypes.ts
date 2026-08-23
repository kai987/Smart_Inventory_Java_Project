export const CART_STORAGE_KEY = 'smart-inventory-cart:v1'
export const CART_SCHEMA_VERSION = 1

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
