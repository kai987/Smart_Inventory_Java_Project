import { cartReducer } from './cartReducer'
import { readSharedCart, writeSharedCart } from './cartStorage'
import { CART_STORAGE_KEY, SHARED_CART_LOCK_NAME, SHARED_CART_STORAGE_KEY, type CartAction, type CartItem, type CartState, type SharedCart } from './cartTypes'

const changedEvent = 'smart-inventory:cart-changed'
type Operation = { action: CartAction; orderKey?: string; guard?: () => boolean }
export type CartSyncEnvironment = {
  read: () => SharedCart | null
  write: (cart: SharedCart) => boolean
  lock?: (commit: () => void) => Promise<unknown>
  listen?: (refresh: () => void) => () => void
  broadcast?: () => void
}

function browserEnvironment(): CartSyncEnvironment {
  let lock: CartSyncEnvironment['lock']
  try {
    const locks = typeof navigator === 'undefined' ? undefined : Reflect.get(navigator, 'locks') as LockManager | undefined
    if (typeof locks?.request === 'function') {
      lock = (commit) => locks.request(SHARED_CART_LOCK_NAME, { mode: 'exclusive' }, commit)
    }
  } catch { /* Restricted environments retain the existing best-effort persistence. */ }
  return {
    read: readSharedCart,
    write: writeSharedCart,
    ...(lock === undefined ? {} : { lock }),
    listen: (refresh) => {
      if (typeof window === 'undefined') return () => undefined
      const storageChanged = (event: StorageEvent) => {
        if (event.key === null || event.key === SHARED_CART_STORAGE_KEY || event.key === CART_STORAGE_KEY) refresh()
      }
      window.addEventListener('storage', storageChanged)
      window.addEventListener(changedEvent, refresh)
      return () => {
        window.removeEventListener('storage', storageChanged)
        window.removeEventListener(changedEvent, refresh)
      }
    },
    broadcast: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(changedEvent)) },
  }
}

function reduceOperation(cart: SharedCart, operation: Operation): { cart: SharedCart; applied: boolean } {
  if (operation.orderKey !== undefined && (cart.consumedOrders.includes(operation.orderKey) || operation.guard?.() === false)) {
    return { cart, applied: false }
  }
  const next = cartReducer({ items: cart.items }, operation.action)
  return {
    cart: {
      version: 2,
      revision: Math.min(Number.MAX_SAFE_INTEGER, cart.revision + 1),
      items: next.items,
      consumedOrders: operation.orderKey === undefined ? cart.consumedOrders : [...cart.consumedOrders, operation.orderKey],
    },
    applied: true,
  }
}

/** Web Locks serialize authoritative read/reduce/write. The legacy fallback is best-effort only. */
export function createCartSync(environment: CartSyncEnvironment = browserEnvironment()) {
  const initial = environment.read()
  let persisted = initial !== null
  let confirmed: SharedCart = initial ?? { version: 2, revision: 0, items: [], consumedOrders: [] }
  let view: CartState = { items: confirmed.items }
  let queue = Promise.resolve()
  const pending: Operation[] = []
  const subscribers = new Set<() => void>()
  let holdRemote: (items: readonly CartItem[]) => boolean = () => false

  function publish(next: CartState) {
    if (JSON.stringify(view.items) === JSON.stringify(next.items)) return
    view = next
    subscribers.forEach((subscriber) => subscriber())
  }
  function projected() {
    // Consumes are never optimistic: a session may change while waiting for the lock.
    return pending.filter((operation) => operation.orderKey === undefined)
      .reduce((state, operation) => cartReducer(state, operation.action), { items: confirmed.items })
  }
  function refresh() {
    if (!persisted) return
    const next = environment.read()
    if (next === null) { persisted = false; return }
    confirmed = next
    if (!holdRemote(view.items)) publish(projected())
  }
  function enqueue(operation: Operation): Promise<boolean> {
    pending.push(operation)
    if (operation.orderKey === undefined) publish(cartReducer(view, operation.action))
    let applied = false
    const work = async () => {
      const status = { committed: false }
      const commit = () => {
        if (status.committed) return
        status.committed = true
        const latest = persisted ? environment.read() : null
        if (latest === null) persisted = false
        const result = reduceOperation(latest ?? confirmed, operation)
        confirmed = result.cart
        applied = result.applied
        if (applied && persisted && !environment.write(confirmed)) persisted = false
      }
      try {
        if (environment.lock === undefined) commit()
        else {
          try { await environment.lock(commit) }
          catch { if (!status.committed) commit() }
        }
      } finally {
        pending.splice(pending.indexOf(operation), 1)
        if (operation.orderKey !== undefined || !holdRemote(view.items)) publish(projected())
        if (persisted && status.committed) environment.broadcast?.()
      }
    }
    queue = queue.then(work, work)
    return queue.then(() => applied)
  }
  return {
    getSnapshot: () => view,
    subscribe: (subscriber: () => void) => { subscribers.add(subscriber); return () => { subscribers.delete(subscriber) } },
    start: () => { refresh(); return environment.listen?.(refresh) ?? (() => undefined) },
    configurePending: (items: CartItem[] | null, hold: (items: readonly CartItem[]) => boolean) => {
      holdRemote = hold
      if (items !== null && pending.length === 0) publish({ items })
      else if (items === null && pending.length === 0) publish(projected())
    },
    dispatch: (action: CartAction) => { void enqueue({ action }) },
    consumeOrder: (orderKey: string, items: readonly CartItem[], guard?: () => boolean) =>
      enqueue({ action: { type: 'consume', items }, orderKey, ...(guard === undefined ? {} : { guard }) }),
    settled: () => queue,
  }
}
