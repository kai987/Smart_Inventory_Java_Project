import axios, { AxiosError, AxiosHeaders, CanceledError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from './apiError'
import type { ApiErrorBody } from './types'

describe('API transport error normalization', () => {
  it.each([AxiosError.ECONNABORTED, AxiosError.ETIMEDOUT])('classifies response-less %s as a timeout', (code) => {
    const normalized = toApiError(new AxiosError('Adapter timeout', code))
    expect(normalized).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT', fieldErrors: [] })
  })

  it('keeps genuine cancellation distinct from timeouts and ordinary network errors', () => {
    const canceled = new CanceledError('Session changed')
    expect(axios.isCancel(canceled)).toBe(true)
    expect(toApiError(canceled)).toMatchObject({ status: 0, code: 'REQUEST_CANCELED' })
    expect(toApiError(new AxiosError('Canceled by adapter', AxiosError.ERR_CANCELED)))
      .toMatchObject({ status: 0, code: 'REQUEST_CANCELED' })
    expect(toApiError(new AxiosError('Network is unavailable', AxiosError.ERR_NETWORK)))
      .toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })

  it('does not rewrite a received HTTP error as a timeout or cancellation', () => {
    const controller = new AbortController()
    const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders(), signal: controller.signal }
    const data: ApiErrorBody = {
      timestamp: '', status: 403, code: 'CSRF_INVALID', message: 'CSRF expired', path: '/api/products',
      fieldErrors: [{ field: 'request', message: 'Invalid token' }],
    }
    const response: AxiosResponse<ApiErrorBody> = { data, status: 403, statusText: 'Forbidden', headers: new AxiosHeaders(), config }
    const received = new AxiosError('Response already received', AxiosError.ECONNABORTED, config, undefined, response)
    controller.abort()
    const normalized = toApiError(received)
    expect(normalized).toMatchObject({ status: data.status, code: data.code, path: data.path, fieldErrors: data.fieldErrors })
    expect(normalized.message).toBe(data.message)
  })

  it('does not let a later signal abort relabel an already-created timeout', () => {
    const controller = new AbortController()
    const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders(), signal: controller.signal }
    const timedOut = new AxiosError('Timed out first', AxiosError.ETIMEDOUT, config)
    controller.abort()
    expect(toApiError(timedOut)).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' })
  })

  it('preserves normalized ApiError instances', () => {
    const error = new ApiError({ timestamp: '', status: 0, code: 'REQUEST_TIMEOUT', message: 'Timeout', path: '', fieldErrors: [] })
    expect(toApiError(error)).toBe(error)
  })
})
