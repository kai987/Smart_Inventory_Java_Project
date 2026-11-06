import { describe, expect, it, vi } from 'vitest'
import { createCartSync, type CartSyncEnvironment } from './cartSync'
import { readSharedCart } from './cartStorage'
import { CART_STORAGE_KEY, SHARED_CART_STORAGE_KEY, type SharedCart } from './cartTypes'

const one = [{ productId: 'P001', quantity: 1 }]
function shared(initial = one) {
  let snapshot: SharedCart = { version: 2, revision: 0, items: initial, consumedOrders: [] }
  let mutex = Promise.resolve()
  const listeners = new Set<() => void>()
  const environment = (): CartSyncEnvironment => ({
    read: () => structuredClone(snapshot),
    write: (next) => { snapshot = structuredClone(next); return true },
    lock: (commit) => { const next = mutex.then(commit); mutex = next.catch(() => undefined); return next },
    listen: (refresh) => { listeners.add(refresh); return () => { listeners.delete(refresh) } },
    broadcast: () => { listeners.forEach((refresh) => refresh()) },
  })
  return { environment, snapshot: () => snapshot }
}

describe('shared cart synchronization', () => {
  it('serializes simultaneous increments and different-product additions without losing either writer', async () => {
    const store = shared()
    const a = createCartSync(store.environment())
    const b = createCartSync(store.environment())
    const stopA = a.start(); const stopB = b.start()
    a.dispatch({ type: 'increment', productId: 'P001' })
    b.dispatch({ type: 'increment', productId: 'P001' })
    a.dispatch({ type: 'add', productId: 'P002' })
    b.dispatch({ type: 'add', productId: 'P003' })
    await Promise.all([a.settled(), b.settled()])
    expect(store.snapshot().items).toEqual([{ productId: 'P001', quantity: 3 }, { productId: 'P002', quantity: 1 }, { productId: 'P003', quantity: 1 }])
    expect(a.getSnapshot()).toEqual(b.getSnapshot())
    stopA(); stopB()
  })

  it('rebases queued optimistic actions without applying committed actions a second time', async () => {
    const store = shared()
    const a = createCartSync(store.environment())
    const b = createCartSync(store.environment())
    const stopA = a.start(); const stopB = b.start()
    a.dispatch({ type: 'increment', productId: 'P001' })
    a.dispatch({ type: 'increment', productId: 'P001' })
    b.dispatch({ type: 'add', productId: 'P002' })
    await Promise.all([a.settled(), b.settled()])
    expect(a.getSnapshot().items).toEqual([{ productId: 'P001', quantity: 3 }, { productId: 'P002', quantity: 1 }])
    expect(b.getSnapshot()).toEqual(a.getSnapshot())
    stopA(); stopB()
  })

  it('does not resurrect consumed products when an old tab adds another product', async () => {
    const store = shared()
    const a = createCartSync(store.environment())
    const b = createCartSync(store.environment()) // deliberately not subscribed: model a stale tab
    expect(await a.consumeOrder('customer:order-1', one)).toBe(true)
    b.dispatch({ type: 'add', productId: 'P002' })
    await b.settled()
    expect(store.snapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
    expect(b.getSnapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
  })

  it('deduplicates consumption across contexts and preserves concurrent additions', async () => {
    const store = shared()
    const a = createCartSync(store.environment())
    const b = createCartSync(store.environment())
    b.dispatch({ type: 'increment', productId: 'P001' })
    await b.settled()
    const results = await Promise.all([a.consumeOrder('customer:order-1', one), b.consumeOrder('customer:order-1', one)])
    expect(results).toEqual([true, false])
    expect(store.snapshot().items).toEqual(one)
    expect(store.snapshot().consumedOrders).toEqual(['customer:order-1'])
  })

  it('checks session identity inside the lock and never optimistically consumes while waiting', async () => {
    const store = shared()
    let release: () => void = () => { throw new Error('Missing lock gate') }
    const gate = new Promise<void>((resolve) => { release = resolve })
    let currentSession = true
    const environment = store.environment()
    environment.lock = async (commit) => { await gate; commit() }
    const a = createCartSync(environment)
    const consumed = a.consumeOrder('customer:order-1', one, () => currentSession)
    expect(a.getSnapshot().items).toEqual(one)
    currentSession = false
    release()
    expect(await consumed).toBe(false)
    expect(store.snapshot().items).toEqual(one)
    expect(store.snapshot().consumedOrders).toEqual([])
  })

  it('keeps repeated delta changes in memory after quota failure, even if reads return stale storage', async () => {
    const read = vi.fn((): SharedCart => ({ version: 2, revision: 0, items: [], consumedOrders: [] }))
    const write = vi.fn(() => false)
    const a = createCartSync({ read, write })
    a.dispatch({ type: 'add', productId: 'P001' }); await a.settled()
    a.dispatch({ type: 'increment', productId: 'P001' }); await a.settled()
    a.dispatch({ type: 'increment', productId: 'P001' }); await a.settled()
    expect(a.getSnapshot().items).toEqual([{ productId: 'P001', quantity: 3 }])
    expect(read).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledOnce()
    expect(await a.consumeOrder('customer:order-1', one)).toBe(true)
    expect(await a.consumeOrder('customer:order-1', one)).toBe(false)
    expect(a.getSnapshot().items).toEqual([{ productId: 'P001', quantity: 2 }])
  })

  it.each(['unavailable', 'rejected', 'rejected-after-commit'] as const)('retains best-effort persistence if Web Locks are %s', async (mode) => {
    const store = shared([])
    const environment = store.environment()
    const write = vi.fn(environment.write)
    environment.write = write
    delete environment.lock
    if (mode !== 'unavailable') environment.lock = (commit) => {
      if (mode === 'rejected-after-commit') commit()
      return Promise.reject(new Error('Lock unavailable'))
    }
    const a = createCartSync(environment)
    a.dispatch({ type: 'add', productId: 'P001' }); await a.settled()
    expect(store.snapshot().items).toEqual(one)
    expect(write).toHaveBeenCalledOnce()
  })

  it('migrates v1 on mutation without clearing it and ignores later writes from old deployed tabs', async () => {
    const legacy = JSON.stringify({ version: 1, items: one })
    localStorage.setItem(CART_STORAGE_KEY, legacy)
    const a = createCartSync(); const stop = a.start()
    expect(a.getSnapshot().items).toEqual(one)
    expect(localStorage.getItem(SHARED_CART_STORAGE_KEY)).toBeNull()
    a.dispatch({ type: 'increment', productId: 'P001' }); await a.settled()
    expect(readSharedCart()?.items).toEqual([{ productId: 'P001', quantity: 2 }])
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(legacy)
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [] }))
    window.dispatchEvent(new StorageEvent('storage', { key: CART_STORAGE_KEY }))
    expect(a.getSnapshot().items).toEqual([{ productId: 'P001', quantity: 2 }])
    stop()
  })

  it('treats storage events as invalidations and reads the latest value, not stale event payloads', () => {
    const a = createCartSync(); const stop = a.start()
    const latest: SharedCart = { version: 2, revision: 4, items: one, consumedOrders: [] }
    localStorage.setItem(SHARED_CART_STORAGE_KEY, JSON.stringify(latest))
    window.dispatchEvent(new StorageEvent('storage', { key: SHARED_CART_STORAGE_KEY, newValue: JSON.stringify({ ...latest, items: [] }) }))
    expect(a.getSnapshot().items).toEqual(one)
    stop()
  })

  it('holds an unresolved retry view while tracking remote additions, then reconciles after consumption', async () => {
    const store = shared()
    const a = createCartSync(store.environment())
    a.configurePending(one, () => true)
    const b = createCartSync(store.environment())
    const stopA = a.start()
    b.dispatch({ type: 'add', productId: 'P002' }); await b.settled()
    expect(a.getSnapshot().items).toEqual(one)
    expect(await a.consumeOrder('customer:order-1', one)).toBe(true)
    expect(a.getSnapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
    stopA()
  })

  it('releases a restored pending view after another context already consumed the same order', async () => {
    const store = shared()
    const b = createCartSync(store.environment())
    await b.consumeOrder('customer:order-1', one)
    b.dispatch({ type: 'add', productId: 'P002' }); await b.settled()
    const a = createCartSync(store.environment())
    a.configurePending(one, () => true)
    expect(a.getSnapshot().items).toEqual(one)
    expect(await a.consumeOrder('customer:order-1', one)).toBe(false)
    expect(a.getSnapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
  })

  it('does not let an older queued commit replace a checkout payload frozen while waiting for its lock', async () => {
    const store = shared([])
    const environment = store.environment()
    const serialized = environment.lock
    let release: () => void = () => { throw new Error('Missing lock gate') }
    const gate = new Promise<void>((resolve) => { release = resolve })
    environment.lock = async (commit) => { await gate; await serialized?.(commit) }
    const a = createCartSync(environment)
    const b = createCartSync(store.environment())
    const stop = a.start()
    a.dispatch({ type: 'add', productId: 'P001' })
    a.configurePending(one, () => true) // checkout starts before that local write acquires the lock
    b.dispatch({ type: 'add', productId: 'P002' }); await b.settled()
    expect(a.getSnapshot().items).toEqual(one)
    release(); await a.settled()
    expect(a.getSnapshot().items).toEqual(one)
    expect(store.snapshot().items).toEqual([{ productId: 'P002', quantity: 1 }, ...one])
    await a.consumeOrder('customer:order-1', one)
    expect(a.getSnapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
    stop()
  })

  it('recovers malformed legacy data but never overwrites an unsupported newer cart', async () => {
    localStorage.setItem(CART_STORAGE_KEY, '{broken')
    const a = createCartSync()
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull()
    a.dispatch({ type: 'add', productId: 'P001' }); await a.settled()
    expect(readSharedCart()?.items).toEqual(one)
    const unsupported = JSON.stringify({ version: 3, items: one })
    localStorage.setItem(SHARED_CART_STORAGE_KEY, unsupported)
    const b = createCartSync()
    b.dispatch({ type: 'add', productId: 'P002' }); await b.settled()
    expect(b.getSnapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
    expect(localStorage.getItem(SHARED_CART_STORAGE_KEY)).toBe(unsupported)
  })

  it('releases a previous user retry view after identity changes even if storage is now unavailable', () => {
    const store = shared([{ productId: 'P002', quantity: 1 }])
    const environment = store.environment()
    const a = createCartSync(environment)
    a.configurePending(one, () => true)
    environment.read = () => null
    const stop = a.start()
    expect(a.getSnapshot().items).toEqual(one)
    a.configurePending(null, () => false)
    expect(a.getSnapshot().items).toEqual([{ productId: 'P002', quantity: 1 }])
    stop()
  })
})
