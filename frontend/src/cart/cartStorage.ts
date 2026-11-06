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

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readCart(storage?: Pick<Storage, 'getItem' | 'removeItem'>): CartState {
  const availableStorage = storage ?? browserStorage()
  if (availableStorage === null) return emptyCart
  let raw: string | null
  try {
    raw = availableStorage.getItem(CART_STORAGE_KEY)
  } catch {
    return emptyCart
  }
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
    try {
      availableStorage.removeItem(CART_STORAGE_KEY)
    } catch {
      // A browser storage restriction must not prevent an in-memory cart.
    }
    return emptyCart
  }
}

export function writeCart(state: CartState, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const availableStorage = storage ?? browserStorage()
    if (availableStorage === null) return
    const stored: StoredCart = { version: CART_SCHEMA_VERSION, items: state.items }
    availableStorage.setItem(CART_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // React remains the source of truth when persistence is unavailable or full.
  }
}
