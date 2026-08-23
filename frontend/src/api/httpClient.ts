import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { csrfStore } from './csrfStore'
import type { CsrfToken } from './types'

const unsafeMethods = new Set(['post', 'put', 'patch', 'delete'])

type RetryableConfig = InternalAxiosRequestConfig & {
  _csrfRetried?: boolean
}

const csrfClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

export const httpClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
})

export async function refreshCsrfToken(): Promise<CsrfToken> {
  const { data } = await csrfClient.get<CsrfToken>('/auth/csrf')
  csrfStore.set({ token: data.token, headerName: data.headerName })
  return data
}

httpClient.interceptors.request.use((config) => {
  const method = config.method?.toLowerCase()
  const csrf = csrfStore.get()
  if (method !== undefined && unsafeMethods.has(method) && csrf !== null) {
    config.headers.set(csrf.headerName, csrf.token)
  }
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined
    const method = config?.method?.toLowerCase()
    const responseData = error.response?.data
    const isCsrfFailure = error.response?.status === 403
      && typeof responseData === 'object'
      && responseData !== null
      && 'code' in responseData
      && responseData.code === 'CSRF_INVALID'

    if (config !== undefined && method !== undefined && unsafeMethods.has(method) && isCsrfFailure && config._csrfRetried !== true) {
      config._csrfRetried = true
      const csrf = await refreshCsrfToken()
      config.headers.set(csrf.headerName, csrf.token)
      return httpClient.request(config)
    }

    return Promise.reject(error)
  },
)
