import { QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authApi } from '../api/authApi'
import { ApiError } from '../api/apiError'
import { httpClient } from '../api/httpClient'
import { csrfStore } from '../api/csrfStore'
import { orderApi } from '../api/orderApi'
import type { Order, OrderList, User } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { I18nProvider } from '../i18n/I18nProvider'
import { createI18nInstance } from '../i18n/i18n'
import { OrdersPage } from '../pages/OrdersPage'
import { createTestQueryClient } from '../test/render'
import { AuthProvider, useAuth } from './AuthProvider'

const customerA: User = { username: 'customer_a', role: 'CUSTOMER' }
const customerB: User = { username: 'customer_b', role: 'CUSTOMER' }
const admin: User = { username: 'admin', role: 'ADMIN' }
const csrf = { token: 'test-token', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' }

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Missing resolver') }
  let reject: (reason: unknown) => void = () => { throw new Error('Missing rejector') }
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function order(orderId: string, user: User): Order {
  return { orderId, customerName: user.username, items: [], totalPriceYen: '120000', totalWeightKg: 3, estimatedBoxes: 1 }
}

function AuthProbe() {
  const auth = useAuth()
  const [error, setError] = useState('')
  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : 'Failed')
  return <div>
    <output aria-label="Current account">{auth.user?.username ?? 'anonymous'}</output>
    <button onClick={() => void auth.login({ username: customerB.username, password: 'password' }).catch(fail)}>Sign in B</button>
    <button onClick={() => void auth.logout().catch(fail)}>Sign out</button>
    <button onClick={() => void auth.refresh().catch(fail)}>Refresh session</button>
    <button onClick={() => void auth.runProtectedRequest((signal) => httpClient.post('/protected-write', {}, { signal })).catch(fail)}>Protected write</button>
    {error ? <p role="alert">{error}</p> : null}
    <OrdersPage />
  </div>
}

function renderAuth(initialUser: User | null) {
  csrfStore.clear()
  vi.spyOn(authApi, 'fetchCsrf').mockResolvedValue(csrf)
  vi.spyOn(authApi, 'login').mockResolvedValue(customerB)
  vi.spyOn(authApi, 'logout').mockResolvedValue(undefined)
  const client = createTestQueryClient()
  client.setQueryData(queryKeys.auth, initialUser)
  const view = render(
    <I18nProvider instance={createI18nInstance('en')}>
      <QueryClientProvider client={client}>
        <MemoryRouter><AuthProvider><AuthProbe /></AuthProvider></MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
  return { client, ...view }
}

describe('AuthProvider private query isolation', () => {
  it('reconciles B when the server commits login but the login response is lost', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    client.setQueryData(queryKeys.myOrders(customerA.username, customerA.role), { items: [order('A-private-order', customerA)], total: 1 })
    vi.mocked(authApi.login).mockRejectedValueOnce(new Error('Login response was lost'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in B' }))
    await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toEqual(customerB))
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
    expect(authApi.me).toHaveBeenCalled()
  })

  it('fails closed if neither an ambiguous login nor session reconciliation can be reached', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockRejectedValue(new Error('Session endpoint unreachable'))
    const { client } = renderAuth(customerA)
    vi.mocked(authApi.login).mockRejectedValueOnce(new Error('Login response was lost'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in B' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Login response was lost')
    expect(client.getQueryData(queryKeys.auth)).toBeNull()
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
  })

  it('fails closed locally when a logout response is lost', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    const { client } = renderAuth(customerA)
    vi.mocked(authApi.logout).mockRejectedValueOnce(new Error('Logout response was lost'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Logout response was lost')
    expect(client.getQueryData(queryKeys.auth)).toBeNull()
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
  })

  it('blocks new protected writes and overlapping auth writes while a login is pending', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    const pending = deferred<User>()
    vi.mocked(authApi.login).mockReturnValueOnce(pending.promise)
    const write = vi.spyOn(httpClient, 'post')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sign in B' }))
    await waitFor(() => expect(authApi.login).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Protected write' }))
    expect(write).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(authApi.logout).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(customerB); await pending.promise })
    await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toEqual(customerB))
  })

  it('finishes a pending logout before allowing a new login to rotate the server session', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    const pending = deferred<undefined>()
    vi.mocked(authApi.logout).mockReturnValueOnce(pending.promise)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Sign in B' }))
    expect(authApi.login).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(undefined); await pending.promise })
    await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Sign in B' }))
    await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toEqual(customerB))
  })

  it('clears cached private data on a confirmed protected orders 401', async () => {
    const pending = deferred<OrderList>()
    vi.spyOn(orderApi, 'mine').mockReturnValueOnce(pending.promise)
    const { client } = renderAuth(customerA)
    client.setQueryData(queryKeys.adminSummary(admin.username), { customerCount: 77 })
    await act(async () => {
      pending.reject(new ApiError({ timestamp: '', status: 401, code: 'UNAUTHENTICATED', message: 'Expired', path: '/api/orders/me', fieldErrors: [] }))
      await pending.promise.catch(() => undefined)
    })
    await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toBeNull())
    expect(client.getQueryData(queryKeys.adminSummary(admin.username))).toBeUndefined()
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
  })

  it('ignores a late protected orders 401 from an aborted old session', async () => {
    const pending = deferred<OrderList>()
    vi.spyOn(orderApi, 'mine').mockReturnValueOnce(pending.promise).mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    await waitFor(() => expect(orderApi.mine).toHaveBeenCalledTimes(1))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in B' }))
    await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toEqual(customerB))
    await act(async () => {
      pending.reject(new ApiError({ timestamp: '', status: 401, code: 'UNAUTHENTICATED', message: 'Expired', path: '/api/orders/me', fieldErrors: [] }))
      await pending.promise.catch(() => undefined)
    })
    expect(client.getQueryData(queryKeys.auth)).toEqual(customerB)
  })

  it('does not retry a delayed CSRF-invalid old-session POST under the new account', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    const pending = deferred<AxiosResponse<unknown>>()
    const originalAdapter = httpClient.defaults.adapter
    let requestConfig: InternalAxiosRequestConfig | undefined
    const adapter = vi.fn((config: InternalAxiosRequestConfig) => { requestConfig = config; return pending.promise })
    httpClient.defaults.adapter = adapter
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Protected write' }))
      await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1))
      await user.click(screen.getByRole('button', { name: 'Sign in B' }))
      await waitFor(() => expect(client.getQueryData(queryKeys.auth)).toEqual(customerB))
      expect(requestConfig?.signal?.aborted).toBe(true)
      const response: AxiosResponse<unknown> = {
        status: 403, statusText: 'Forbidden', headers: new AxiosHeaders(),
        config: requestConfig!, data: { code: 'CSRF_INVALID' },
      }
      await act(async () => {
        pending.reject(new AxiosError('CSRF expired', 'ERR_BAD_REQUEST', requestConfig, undefined, response))
        await pending.promise.catch(() => undefined)
      })
      expect(adapter).toHaveBeenCalledTimes(1)
      expect(client.getQueryData(queryKeys.auth)).toEqual(customerB)
    } finally {
      if (originalAdapter === undefined) delete httpClient.defaults.adapter
      else httpClient.defaults.adapter = originalAdapter
    }
  })

  it('aborts A orders during logout and does not expose a late A response to B', async () => {
    const pending = deferred<OrderList>()
    let signal: AbortSignal | undefined
    vi.spyOn(orderApi, 'mine')
      .mockImplementationOnce((requestSignal) => { signal = requestSignal; return pending.promise })
      .mockResolvedValue({ items: [order('B-order', customerB)], total: 1 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    const user = userEvent.setup()
    await waitFor(() => expect(orderApi.mine).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByLabelText('Current account')).toHaveTextContent('anonymous'))
    expect(signal?.aborted).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Sign in B' }))
    expect(await screen.findByText('B-order')).toBeInTheDocument()
    await act(async () => { pending.resolve({ items: [order('A-private-order', customerA)], total: 1 }); await pending.promise })
    expect(screen.queryByText('A-private-order')).not.toBeInTheDocument()
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
    expect(client.getQueryData(queryKeys.myOrders(customerB.username, customerB.role))).toEqual({ items: [order('B-order', customerB)], total: 1 })
  })

  it('removes admin caches and preserves public products when an admin signs in as a customer', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockResolvedValue(customerB)
    const { client } = renderAuth(admin)
    client.setQueryData(queryKeys.adminOrders(admin.username, ''), { items: [order('admin-private-order', customerA)], total: 1 })
    client.setQueryData(queryKeys.adminSummary(admin.username), { customerCount: 77 })
    client.setQueryData(queryKeys.products({ q: '', inStockOnly: false }), { items: [], total: 0 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in B' }))
    await waitFor(() => expect(screen.getByLabelText('Current account')).toHaveTextContent(customerB.username))
    expect(client.getQueryData(queryKeys.adminOrders(admin.username, ''))).toBeUndefined()
    expect(client.getQueryData(queryKeys.adminSummary(admin.username))).toBeUndefined()
    expect(client.getQueryData(queryKeys.products({ q: '', inStockOnly: false }))).toEqual({ items: [], total: 0 })
  })

  it('cancels a late session response before explicit login can replace it', async () => {
    const pending = deferred<User>()
    let signal: AbortSignal | undefined
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me')
      .mockImplementationOnce((requestSignal) => { signal = requestSignal; return pending.promise })
      .mockResolvedValue(customerB)
    const { client } = renderAuth(customerA)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh session' }))
    await waitFor(() => expect(authApi.me).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Sign in B' }))
    await waitFor(() => expect(screen.getByLabelText('Current account')).toHaveTextContent(customerB.username))
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(customerA); await pending.promise })
    expect(client.getQueryData(queryKeys.auth)).toEqual(customerB)
  })

  it('discards A locally once backend login succeeds even if CSRF reconciliation fails', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    const { client } = renderAuth(customerA)
    client.setQueryData(queryKeys.myOrders(customerA.username, customerA.role), { items: [order('A-private-order', customerA)], total: 1 })
    vi.mocked(authApi.fetchCsrf).mockRejectedValueOnce(new Error('CSRF reconciliation unavailable'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in B' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('CSRF reconciliation unavailable')
    expect(client.getQueryData(queryKeys.auth)).toBeNull()
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
  })

  it('clears expired auth and private caches on confirmed auth/me 401', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(authApi, 'me').mockRejectedValue({ isAxiosError: true, response: { status: 401 } })
    const { client } = renderAuth(customerA)
    client.setQueryData(queryKeys.adminSummary(admin.username), { customerCount: 77 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh session' }))
    await waitFor(() => expect(screen.getByLabelText('Current account')).toHaveTextContent('anonymous'))
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
    expect(client.getQueryData(queryKeys.adminSummary(admin.username))).toBeUndefined()
  })

  it('treats an already-expired logout as local sign-out', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    const { client } = renderAuth(customerA)
    vi.mocked(authApi.logout).mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByLabelText('Current account')).toHaveTextContent('anonymous'))
    expect(client.getQueryData(queryKeys.myOrders(customerA.username, customerA.role))).toBeUndefined()
  })

  it('keeps the existing session when login credentials are rejected', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    const { client } = renderAuth(customerA)
    vi.mocked(authApi.login).mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in B' }))
    await screen.findByRole('alert')
    expect(client.getQueryData(queryKeys.auth)).toEqual(customerA)
  })
})
