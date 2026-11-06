import { httpClient } from './httpClient'
import type { CreateOrderRequest, Order, OrderList, OrderPagination } from './types'

export const orderApi = {
  create: async (request: CreateOrderRequest, idempotencyKey: string, signal?: AbortSignal): Promise<Order> =>
    (await httpClient.post<Order>('/orders', request, { headers: { 'Idempotency-Key': idempotencyKey }, ...(signal === undefined ? {} : { signal }) })).data,
  mine: async (signal?: AbortSignal, pagination?: OrderPagination): Promise<OrderList> =>
    (await httpClient.get<OrderList>('/orders/me', {
      ...(pagination === undefined ? {} : { params: pagination }),
      ...(signal === undefined ? {} : { signal }),
    })).data,
  all: async (customer?: string, signal?: AbortSignal, pagination?: OrderPagination): Promise<OrderList> =>
    (
      await httpClient.get<OrderList>('/orders', {
        params: { ...(customer === undefined || customer === '' ? {} : { customer }), ...pagination },
        ...(signal === undefined ? {} : { signal }),
      })
    ).data,
}
