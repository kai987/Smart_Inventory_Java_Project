import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import axios, { AxiosError } from 'axios'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../app/queryClient'
import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { createTestQueryClient } from '../test/render'
import { toApiError } from './apiError'
import { authApi } from './authApi'
import { csrfStore } from './csrfStore'
import { HTTP_REQUEST_TIMEOUT_MS, httpClient, refreshCsrfToken } from './httpClient'
import { orderApi } from './orderApi'

type RecordedRequest = { xhr: XMLHttpRequest; method: string; url: string }
let requests: RecordedRequest[]
let timeoutTimers: Map<XMLHttpRequest, ReturnType<typeof setTimeout>>

const csrf = { token: 'fresh-token', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' }
const csrfFailure = { status: 403, code: 'CSRF_INVALID', message: 'Expired', fieldErrors: [] }

function clearRequestTimer(xhr: XMLHttpRequest) {
  const timer = timeoutTimers.get(xhr)
  if (timer !== undefined) clearTimeout(timer)
  timeoutTimers.delete(xhr)
}

function respond(index: number, status: number, data: unknown) {
  const request = requests.at(index)
  if (request === undefined) throw new Error(`Missing request ${index}`)
  clearRequestTimer(request.xhr)
  Object.defineProperties(request.xhr, {
    status: { configurable: true, value: status },
    statusText: { configurable: true, value: status === 200 ? 'OK' : 'Error' },
    responseText: { configurable: true, value: JSON.stringify(data) },
  })
  request.xhr.dispatchEvent(new ProgressEvent('loadend'))
}

const flushRequests = () => vi.advanceTimersByTimeAsync(0)
const failure = (promise: Promise<unknown>): Promise<unknown> => promise.then(
  () => { throw new Error('Expected a rejected request') },
  (error: unknown) => error,
)

beforeEach(() => {
  vi.useFakeTimers()
  csrfStore.clear()
  requests = []
  timeoutTimers = new Map()
  const open = vi.spyOn(XMLHttpRequest.prototype, 'open')
  vi.spyOn(XMLHttpRequest.prototype, 'abort').mockImplementation(function (this: XMLHttpRequest) {
    clearRequestTimer(this)
  })
  // Exercise Axios's real browser adapter while keeping all requests local to
  // this test. The timer uses the timeout assigned by each actual client.
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (this: XMLHttpRequest) {
    const openedIndex = open.mock.contexts.lastIndexOf(this)
    if (openedIndex < 0) throw new Error('XHR was not opened')
    const argumentsForRequest = open.mock.calls.at(openedIndex)
    if (argumentsForRequest === undefined) throw new Error('XHR was not opened')
    requests.push({ xhr: this, method: argumentsForRequest[0], url: String(argumentsForRequest[1]) })
    if (this.timeout > 0) {
      timeoutTimers.set(this, setTimeout(() => {
        timeoutTimers.delete(this)
        this.dispatchEvent(new ProgressEvent('timeout'))
      }, this.timeout))
    }
  })
})

afterEach(() => {
  csrfStore.clear()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function PendingLoginProbe() {
  const { login, isChangingSession } = useAuth()
  const [error, setError] = useState('')
  return <div>
    <output aria-label="Authentication pending">{isChangingSession ? 'pending' : 'ready'}</output>
    <output aria-label="Transport error">{error}</output>
    <button type="button" disabled={isChangingSession} onClick={() => {
      void login({ username: 'admin', password: 'admin123' }).catch((reason: unknown) => setError(toApiError(reason).code))
    }}>Sign in</button>
  </div>
}

describe('bounded HTTP requests', () => {
  it('uses a finite shared timeout for ordinary API requests', async () => {
    expect(HTTP_REQUEST_TIMEOUT_MS).toBe(15_000)
    expect(httpClient.defaults.timeout).toBe(HTTP_REQUEST_TIMEOUT_MS)
    const result = failure(httpClient.get('/products'))
    await flushRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0].xhr.timeout).toBe(HTTP_REQUEST_TIMEOUT_MS)
    expect(requests[0].xhr.withCredentials).toBe(true)
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS)
    expect(toApiError(await result)).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' })
  })

  it('uses the same finite timeout for the separate CSRF client', async () => {
    const result = failure(refreshCsrfToken())
    await flushRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/api/auth/csrf' })
    expect(requests[0].xhr.timeout).toBe(HTTP_REQUEST_TIMEOUT_MS)
    expect(requests[0].xhr.withCredentials).toBe(true)
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS)
    expect(toApiError(await result)).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' })
    expect(csrfStore.get()).toBeNull()
  })

  it('does not automatically retry an ambiguous order POST timeout or change its idempotency key', async () => {
    const key = 'checkout_timeout_1234567890'
    const result = failure(orderApi.create({ items: [{ productId: 'P001', quantity: 2 }] }, key))
    await flushRequests()
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS)
    const error = await result
    expect(axios.isAxiosError(error)).toBe(true)
    if (!axios.isAxiosError(error)) throw new Error('Expected Axios timeout')
    expect(error.code).toBe(AxiosError.ECONNABORTED)
    expect(error.config?.headers.get('Idempotency-Key')).toBe(key)
    expect(error.config?.data).toBe(JSON.stringify({ items: [{ productId: 'P001', quantity: 2 }] }))
    expect(toApiError(error).code).toBe('REQUEST_TIMEOUT')
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS * 2)
    expect(requests).toHaveLength(1)
  })

  it('still propagates external cancellation instead of waiting for or reporting a timeout', async () => {
    const controller = new AbortController()
    const result = failure(httpClient.get('/products', { signal: controller.signal }))
    await flushRequests()
    controller.abort()
    const error = await result
    expect(axios.isCancel(error)).toBe(true)
    expect(toApiError(error)).toMatchObject({ status: 0, code: 'REQUEST_CANCELED' })
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS)
    expect(requests).toHaveLength(1)
  })

  it('preserves the single CSRF retry and never repeats it after a second CSRF rejection', async () => {
    csrfStore.set({ token: 'old-token', headerName: 'X-CSRF-TOKEN' })
    const key = 'checkout_csrf_1234567890'
    const result = failure(orderApi.create({ items: [{ productId: 'P001', quantity: 1 }] }, key))
    await flushRequests()
    respond(0, 403, csrfFailure)
    await flushRequests()
    expect(requests[1]).toMatchObject({ method: 'GET', url: '/api/auth/csrf' })
    respond(1, 200, csrf)
    await flushRequests()
    expect(requests[2]).toMatchObject({ method: 'POST', url: '/api/orders' })
    respond(2, 403, csrfFailure)
    const error = await result
    expect(toApiError(error)).toMatchObject({ status: 403, code: 'CSRF_INVALID' })
    if (!axios.isAxiosError(error)) throw new Error('Expected Axios HTTP error')
    expect(error.config?.headers.get('Idempotency-Key')).toBe(key)
    expect(error.config?.headers.get('X-CSRF-TOKEN')).toBe(csrf.token)
    expect(requests).toHaveLength(3)
    expect(requests.every(({ xhr }) => xhr.timeout === HTTP_REQUEST_TIMEOUT_MS)).toBe(true)
  })

  it('rejects a pending login when CSRF refresh times out without replaying its POST', async () => {
    let pending = true
    const result = failure(authApi.login({ username: 'admin', password: 'admin123' }).finally(() => { pending = false }))
    await flushRequests()
    respond(0, 403, csrfFailure)
    await flushRequests()
    expect(pending).toBe(true)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS - 1)
    expect(pending).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(toApiError(await result)).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' })
    expect(pending).toBe(false)
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    expect(csrfStore.get()).toBeNull()
  })

  it('passes the external abort signal through a pending CSRF refresh', async () => {
    const controller = new AbortController()
    const result = failure(httpClient.post('/products', {}, { signal: controller.signal }))
    await flushRequests()
    respond(0, 403, csrfFailure)
    await flushRequests()
    expect(requests[1]).toMatchObject({ method: 'GET', url: '/api/auth/csrf' })
    controller.abort()
    const error = await result
    expect(axios.isCancel(error)).toBe(true)
    expect(toApiError(error).code).toBe('REQUEST_CANCELED')
    expect(requests).toHaveLength(2)
    expect(csrfStore.get()).toBeNull()
  })

  it('releases the actual sign-in button after CSRF timeout and unavailable reconciliation', async () => {
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.auth, { username: 'customer', role: 'CUSTOMER' })
    csrfStore.set({ token: 'old-token', headerName: 'X-CSRF-TOKEN' })
    const view = render(<QueryClientProvider client={client}><AuthProvider><PendingLoginProbe /></AuthProvider></QueryClientProvider>)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
      await act(flushRequests)
      expect(screen.getByLabelText('Authentication pending')).toHaveTextContent('pending')
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
      await act(async () => { respond(0, 403, csrfFailure); await flushRequests() })
      await act(async () => { await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS) })
      // AuthProvider reconciles an ambiguous identity change with a new GET;
      // no login POST is retried automatically after its CSRF refresh failed.
      expect(requests[2]).toMatchObject({ method: 'GET', url: '/api/auth/csrf' })
      await act(async () => { respond(2, 503, { status: 503, code: 'INTERNAL_ERROR' }); await flushRequests() })
      expect(screen.getByLabelText('Transport error')).toHaveTextContent('REQUEST_TIMEOUT')
      expect(screen.getByLabelText('Authentication pending')).toHaveTextContent('ready')
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    } finally {
      view.unmount()
      client.clear()
    }
  })
})
