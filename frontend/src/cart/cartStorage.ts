import { CART_SCHEMA_VERSION, CART_STORAGE_KEY, type CartItem, type CartState, type StoredCart } from './cartTypes'
import { emptyCart } from './cartReducer'

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.productId === 'string' &&
    record.productId.length > 0 &&
    typeof record.quantity === 'number' &&
    Number.isInteger(record.quantity) &&
    record.quantity > 0
  )
}

export function readCart(storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage): CartState {
  const raw = storage.getItem(CART_STORAGE_KEY)
  if (raw === null) return emptyCart

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid cart')
    const record = parsed as Record<string, unknown>
    if (record.version !== CART_SCHEMA_VERSION || !Array.isArray(record.items) || !record.items.every(isCartItem)) {
      throw new Error('Unsupported cart schema')
    }
    const productIds = new Set(record.items.map((item) => item.productId))
    if (productIds.size !== record.items.length) {
      throw new Error('Duplicate cart product')
    }
    return { items: record.items }
  } catch {
    storage.removeItem(CART_STORAGE_KEY)
    return emptyCart
  }
}

export function writeCart(state: CartState, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  const stored: StoredCart = { version: CART_SCHEMA_VERSION, items: state.items }
  storage.setItem(CART_STORAGE_KEY, JSON.stringify(stored))
}
