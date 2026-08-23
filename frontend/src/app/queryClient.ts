import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  auth: ['auth', 'me'] as const,
  productsRoot: ['products'] as const,
  products: (filters: { q: string; inStockOnly: boolean }) => ['products', filters] as const,
  myOrders: ['orders', 'me'] as const,
  adminOrdersRoot: ['orders', 'admin'] as const,
  adminOrders: (customer: string) => ['orders', 'admin', { customer }] as const,
  adminSummary: ['admin', 'summary'] as const,
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
