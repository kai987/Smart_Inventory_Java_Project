import { httpClient } from './httpClient'
import type { CreateOrderRequest, Order, OrderList } from './types'

export const orderApi = {
  create: async (request: CreateOrderRequest): Promise<Order> => (await httpClient.post<Order>('/orders', request)).data,
  mine: async (): Promise<OrderList> => (await httpClient.get<OrderList>('/orders/me')).data,
  all: async (customer?: string, signal?: AbortSignal): Promise<OrderList> =>
    (
      await httpClient.get<OrderList>('/orders', {
        params: customer === undefined || customer === '' ? {} : { customer },
        ...(signal === undefined ? {} : { signal }),
      })
    ).data,
}
