import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { User } from '../api/types'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import { CartProvider } from '../cart/CartProvider'
import { ToastProvider } from '../components/feedback/ToastProvider'

const noOp = (): Promise<void> => Promise.resolve()

export function authValue(user: User | null = null, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user,
    isLoading: false,
    error: null,
    login: () => Promise.resolve(user ?? { username: 'customer', role: 'CUSTOMER' }),
    logout: noOp,
    refresh: noOp,
    ...overrides,
  }
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  options: { user?: User | null; auth?: AuthContextValue; route?: string } = {},
): RenderResult {
  const client = createTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthContext value={options.auth ?? authValue(options.user)}>
          <CartProvider>
            <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
          </CartProvider>
        </AuthContext>
      </ToastProvider>
    </QueryClientProvider>,
  )
}
