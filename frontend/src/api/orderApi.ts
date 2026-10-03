import { httpClient } from './httpClient'
import type { CreateOrderRequest, Order, OrderList } from './types'

export const orderApi = {
  create: async (request: CreateOrderRequest, idempotencyKey: string, signal?: AbortSignal): Promise<Order> =>
    (await httpClient.post<Order>('/orders', request, { headers: { 'Idempotency-Key': idempotencyKey }, ...(signal === undefined ? {} : { signal }) })).data,
  mine: async (signal?: AbortSignal): Promise<OrderList> => (await httpClient.get<OrderList>('/orders/me', signal === undefined ? {} : { signal })).data,
  all: async (customer?: string, signal?: AbortSignal): Promise<OrderList> =>
    (
      await httpClient.get<OrderList>('/orders', {
        params: customer === undefined || customer === '' ? {} : { customer },
        ...(signal === undefined ? {} : { signal }),
      })
    ).data,
}
