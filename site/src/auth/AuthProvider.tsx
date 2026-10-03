import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useRef, useState, type ReactNode } from 'react'
import { CanceledError, isAxiosError } from 'axios'
import { toApiError } from '../api/apiError'
import { authApi } from '../api/authApi'
import { csrfStore } from '../api/csrfStore'
import type { LoginRequest, User } from '../api/types'
import { queryKeys } from '../app/queryClient'

export type AuthContextValue = {
  user: User | null
  isLoading: boolean
  isChangingSession: boolean
  error: Error | null
  login: (request: LoginRequest) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  getSessionVersion: () => number
  getSessionSignal: () => AbortSignal
  isCurrentSession: (user: User, version: number) => boolean
  runProtectedRequest: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

function isUnauthenticated(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401
}

function sameIdentity(first: User | null | undefined, second: User | null): boolean {
  return first?.username === second?.username && first?.role === second?.role
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const authGeneration = useRef(0)
  const sessionRequests = useRef(new AbortController())
  const changingSession = useRef(false)
  const [isChangingSession, setIsChangingSession] = useState(false)

  const clearPrivateQueries = useCallback(async () => {
    const roots = [queryKeys.myOrdersRoot, queryKeys.adminOrdersRoot, queryKeys.adminSummaryRoot]
    await Promise.all(roots.map((queryKey) => queryClient.cancelQueries({ queryKey })))
    for (const queryKey of roots) queryClient.removeQueries({ queryKey })
  }, [queryClient])

  const getSessionVersion = useCallback(() => authGeneration.current, [])
  const getSessionSignal = useCallback(() => sessionRequests.current.signal, [])
  const isSettledGeneration = useCallback((version: number) => !changingSession.current && version === authGeneration.current, [])
  const isCurrentSession = useCallback((user: User, version: number) =>
    !changingSession.current && !sessionRequests.current.signal.aborted && version === authGeneration.current
      && sameIdentity(queryClient.getQueryData<User | null>(queryKeys.auth), user), [queryClient])

  const beginAuthChange = useCallback(() => {
    if (changingSession.current) throw new Error('Another sign-in or sign-out is already in progress')
    changingSession.current = true
    setIsChangingSession(true)
    sessionRequests.current.abort()
    return ++authGeneration.current
  }, [])
  const finishAuthChange = useCallback(() => {
    sessionRequests.current = new AbortController()
    changingSession.current = false
    setIsChangingSession(false)
  }, [])

  const runProtectedRequest = useCallback(async <T,>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (changingSession.current || sessionRequests.current.signal.aborted || queryClient.getQueryData<User | null>(queryKeys.auth) == null) {
      throw new CanceledError('No stable authenticated session')
    }
    const generation = authGeneration.current
    const signal = sessionRequests.current.signal
    try {
      return await operation(signal)
    } catch (error: unknown) {
      const apiError = toApiError(error)
      if (!signal.aborted && isSettledGeneration(generation)
        && apiError.status === 401 && apiError.code === 'UNAUTHENTICATED') {
        const expiredGeneration = ++authGeneration.current
        sessionRequests.current.abort()
        await queryClient.cancelQueries({ queryKey: queryKeys.auth })
        if (!isSettledGeneration(expiredGeneration)) throw error
        queryClient.setQueryData(queryKeys.auth, null)
        csrfStore.clear()
        await clearPrivateQueries()
        if (isSettledGeneration(expiredGeneration)) {
          sessionRequests.current = new AbortController()
        }
      }
      throw error
    }
  }, [clearPrivateQueries, isSettledGeneration, queryClient])

  const session = useQuery({
    queryKey: queryKeys.auth,
    enabled: !isChangingSession,
    queryFn: async ({ signal }): Promise<User | null> => {
      if (csrfStore.get() === null) await authApi.fetchCsrf(signal)
      let current: User | null
      try {
        current = await authApi.me(signal)
      } catch (error: unknown) {
        if (!isUnauthenticated(error)) throw error
        current = null
      }
      signal.throwIfAborted()
      if (!sameIdentity(queryClient.getQueryData<User | null>(queryKeys.auth), current)) {
        const nextGeneration = ++authGeneration.current
        sessionRequests.current.abort()
        queryClient.setQueryData(queryKeys.auth, null)
        await clearPrivateQueries()
        signal.throwIfAborted()
        if (!changingSession.current && nextGeneration === authGeneration.current) {
          sessionRequests.current = new AbortController()
        }
      }
      return current
    },
    staleTime: 60_000,
    retry: false,
  })

  const login = useCallback(
    async (request: LoginRequest): Promise<User> => {
      const generation = beginAuthChange()
      const operation = new AbortController()
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.auth })
        await clearPrivateQueries()
        try {
          await authApi.login(request)
        } catch (error: unknown) {
          if (isUnauthenticated(error)) throw error
          // A missing response can hide a committed server-side identity change.
          queryClient.setQueryData(queryKeys.auth, null)
          csrfStore.clear()
          await clearPrivateQueries()
          try {
            await authApi.fetchCsrf(operation.signal)
            const reconciled = await authApi.me(operation.signal)
            if (generation === authGeneration.current) queryClient.setQueryData(queryKeys.auth, reconciled)
            if (reconciled.username === request.username && generation === authGeneration.current) return reconciled
          } catch {
            // Keep the local session anonymous when reconciliation is also unavailable.
          }
          throw error
        }
        if (generation !== authGeneration.current) throw new Error('Authentication changed during sign in')
        // The server has changed identity even if the following reconciliation fails.
        queryClient.setQueryData(queryKeys.auth, null)
        csrfStore.clear()
        await authApi.fetchCsrf(operation.signal)
        const current = await authApi.me(operation.signal)
        if (generation !== authGeneration.current) throw new Error('Authentication changed during sign in')
        queryClient.setQueryData(queryKeys.auth, current)
        return current
      } finally {
        operation.abort()
        finishAuthChange()
      }
    },
    [beginAuthChange, clearPrivateQueries, finishAuthChange, queryClient],
  )

  const logout = useCallback(async (): Promise<void> => {
    const generation = beginAuthChange()
    const operation = new AbortController()
    try {
      await queryClient.cancelQueries({ queryKey: queryKeys.auth })
      try {
        await authApi.logout()
      } catch (error: unknown) {
        if (generation !== authGeneration.current) return
        if (!isUnauthenticated(error)) {
          queryClient.setQueryData(queryKeys.auth, null)
          csrfStore.clear()
          await clearPrivateQueries()
          throw error
        }
      }
      if (generation !== authGeneration.current) return
      queryClient.setQueryData(queryKeys.auth, null)
      await clearPrivateQueries()
      if (generation !== authGeneration.current) return
      csrfStore.clear()
      await authApi.fetchCsrf(operation.signal)
    } finally {
      operation.abort()
      finishAuthChange()
    }
  }, [beginAuthChange, clearPrivateQueries, finishAuthChange, queryClient])

  const refresh = useCallback(async (): Promise<void> => {
    if (changingSession.current) return
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
  }, [queryClient])

  const value: AuthContextValue = {
    user: session.data ?? null,
    isLoading: session.isLoading,
    isChangingSession,
    error: session.error,
    login,
    logout,
    refresh,
    getSessionVersion,
    getSessionSignal,
    isCurrentSession,
    runProtectedRequest,
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext)
  if (context === null) throw new Error('useAuth must be used within AuthProvider')
  return context
}
