import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, type ReactNode } from 'react'
import { isAxiosError } from 'axios'
import { authApi } from '../api/authApi'
import { csrfStore } from '../api/csrfStore'
import type { LoginRequest, User } from '../api/types'
import { queryKeys } from '../app/queryClient'

export type AuthContextValue = {
  user: User | null
  isLoading: boolean
  error: Error | null
  login: (request: LoginRequest) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

async function loadSession(): Promise<User | null> {
  if (csrfStore.get() === null) await authApi.fetchCsrf()
  try {
    return await authApi.me()
  } catch (error: unknown) {
    if (isAxiosError(error) && error.response?.status === 401) return null
    throw error
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useQuery({
    queryKey: queryKeys.auth,
    queryFn: loadSession,
    staleTime: 60_000,
    retry: false,
  })

  const login = useCallback(
    async (request: LoginRequest): Promise<User> => {
      await authApi.login(request)
      csrfStore.clear()
      await authApi.fetchCsrf()
      const current = await authApi.me()
      queryClient.setQueryData(queryKeys.auth, current)
      return current
    },
    [queryClient],
  )

  const logout = useCallback(async (): Promise<void> => {
    await authApi.logout()
    queryClient.setQueryData(queryKeys.auth, null)
    csrfStore.clear()
    await authApi.fetchCsrf()
  }, [queryClient])

  const refresh = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
  }, [queryClient])

  const value: AuthContextValue = {
    user: session.data ?? null,
    isLoading: session.isLoading,
    error: session.error,
    login,
    logout,
    refresh,
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext)
  if (context === null) throw new Error('useAuth must be used within AuthProvider')
  return context
}
