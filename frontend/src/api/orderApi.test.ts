import { AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../app/queryClient'
import { httpClient } from './httpClient'
import { orderApi } from './orderApi'

const paging = { page: 3, size: 20, sort: 'asc' as const }
function mockGet() {
  return vi.spyOn(httpClient, 'get').mockResolvedValue({
    data: { items: [], total: 43 }, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
  })
}

describe('order pagination compatibility', () => {
  it('retains legacy unpaged calls and forwards cancellation', async () => {
    const get = mockGet()
    const signal = new AbortController().signal
    await orderApi.mine(signal)
    expect(get).toHaveBeenLastCalledWith('/orders/me', { signal })
    await orderApi.mine()
    expect(get).toHaveBeenLastCalledWith('/orders/me', {})
    await orderApi.all('alice', signal)
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { customer: 'alice' }, signal })
    await orderApi.all()
    expect(get).toHaveBeenLastCalledWith('/orders', { params: {} })
  })

  it('adds paging only through the last optional argument and keeps overall total', async () => {
    const get = mockGet()
    const signal = new AbortController().signal
    await expect(orderApi.mine(signal, paging)).resolves.toEqual({ items: [], total: 43 })
    expect(get).toHaveBeenLastCalledWith('/orders/me', { params: paging, signal })
    await orderApi.all('alice', signal, paging)
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { customer: 'alice', ...paging }, signal })
    await orderApi.all('', undefined, { page: 1, size: 5, sort: 'desc' })
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { page: 1, size: 5, sort: 'desc' } })
  })

  it('preserves legacy identity/filter prefixes while separating pages, sorts and accounts', () => {
    const mine = queryKeys.myOrders('alice', 'CUSTOMER')
    const admin = queryKeys.adminOrders('admin', 'alice')
    expect(mine).toEqual(['orders', 'me', 'alice', 'CUSTOMER'])
    expect(admin).toEqual(['orders', 'admin', 'admin', 'ADMIN', { customer: 'alice' }])
    expect(queryKeys.myOrders('alice', 'CUSTOMER', paging)).toEqual([...mine, paging])
    expect(queryKeys.adminOrders('admin', 'alice', paging)).toEqual([...admin, paging])
    expect(queryKeys.myOrders('bob', 'CUSTOMER', paging)).not.toEqual(queryKeys.myOrders('alice', 'CUSTOMER', paging))
    expect(queryKeys.adminOrders('admin', 'bob', paging)).not.toEqual(queryKeys.adminOrders('admin', 'alice', paging))
    expect(queryKeys.myOrders('alice', 'CUSTOMER', { ...paging, page: 2 })).not.toEqual(queryKeys.myOrders('alice', 'CUSTOMER', paging))
    expect(queryKeys.myOrders('alice', 'CUSTOMER', { ...paging, sort: 'desc' })).not.toEqual(queryKeys.myOrders('alice', 'CUSTOMER', paging))
  })
})
