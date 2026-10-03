import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  auth: ['auth', 'me'] as const,
  productsRoot: ['products'] as const,
  products: (filters: { q: string; inStockOnly: boolean }) => ['products', filters] as const,
  myOrdersRoot: ['orders', 'me'] as const,
  myOrders: (username: string, role: 'ADMIN' | 'CUSTOMER') => ['orders', 'me', username, role] as const,
  adminOrdersRoot: ['orders', 'admin'] as const,
  adminOrders: (username: string, customer: string) => ['orders', 'admin', username, 'ADMIN', { customer }] as const,
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
