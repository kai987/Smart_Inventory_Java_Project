import { CART_SCHEMA_VERSION, CART_STORAGE_KEY, SHARED_CART_STORAGE_KEY, type CartItem, type CartState, type SharedCart, type StoredCart } from './cartTypes'
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

export function validCartItems(value: unknown): value is CartItem[] {
  return Array.isArray(value) && value.every((item) => isCartItem(item) && Number.isSafeInteger(item.quantity))
    && new Set(value.map((item: CartItem) => item.productId)).size === value.length
}

/** null means unreadable/unsupported: never overwrite that data with an empty cart. */
export function readSharedCart(storage: (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'removeItem'>>) | null = browserStorage()): SharedCart | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(SHARED_CART_STORAGE_KEY)
    if (raw === null) {
      const legacy = storage.getItem(CART_STORAGE_KEY)
      if (legacy === null) return { version: 2, revision: 0, items: [], consumedOrders: [] }
      const recoverLegacy = (): SharedCart | null => {
        if (storage.removeItem === undefined) return null
        storage.removeItem(CART_STORAGE_KEY)
        return { version: 2, revision: 0, items: [], consumedOrders: [] }
      }
      let parsed: unknown
      try { parsed = JSON.parse(legacy) } catch { return recoverLegacy() }
      if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) return recoverLegacy()
      if (parsed.version !== 1) return null // An unknown/newer format belongs to its writer.
      if (!('items' in parsed) || !validCartItems(parsed.items)) return recoverLegacy()
      return { version: 2, revision: 0, items: parsed.items, consumedOrders: [] }
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 2
      || !('revision' in parsed) || typeof parsed.revision !== 'number' || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0
      || !('items' in parsed) || !validCartItems(parsed.items)
      || !('consumedOrders' in parsed) || !Array.isArray(parsed.consumedOrders)
      || !parsed.consumedOrders.every((key: unknown) => typeof key === 'string' && key.length > 0)
      || new Set(parsed.consumedOrders).size !== parsed.consumedOrders.length) return null
    return { version: 2, revision: parsed.revision, items: parsed.items, consumedOrders: parsed.consumedOrders as string[] }
  } catch {
    return null
  }
}

export function writeSharedCart(cart: SharedCart, storage: Pick<Storage, 'setItem'> | null = browserStorage()): boolean {
  try {
    if (storage === null) return false
    storage.setItem(SHARED_CART_STORAGE_KEY, JSON.stringify(cart))
    return true
  } catch {
    return false
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
