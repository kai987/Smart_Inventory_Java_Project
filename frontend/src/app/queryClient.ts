import { QueryClient } from '@tanstack/react-query'
import type { OrderPagination } from '../api/types'

export const queryKeys = {
  auth: ['auth', 'me'] as const,
  productsRoot: ['products'] as const,
  products: (filters: { q: string; inStockOnly: boolean }) => ['products', filters] as const,
  myOrdersRoot: ['orders', 'me'] as const,
  myOrders: (username: string, role: 'ADMIN' | 'CUSTOMER', pagination?: OrderPagination) => {
    const prefix = ['orders', 'me', username, role] as const
    return pagination === undefined ? prefix : [...prefix, pagination] as const
  },
  adminOrdersRoot: ['orders', 'admin'] as const,
  adminOrders: (username: string, customer: string, pagination?: OrderPagination) => {
    const prefix = ['orders', 'admin', username, 'ADMIN', { customer }] as const
    return pagination === undefined ? prefix : [...prefix, pagination] as const
  },
  adminSummaryRoot: ['admin', 'summary'] as const,
  adminSummary: (username: string) => ['admin', 'summary', username, 'ADMIN'] as const,
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})
