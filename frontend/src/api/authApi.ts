import { httpClient, refreshCsrfToken } from './httpClient'
import type { CsrfToken, LoginRequest, RegisterRequest, User } from './types'

export const authApi = {
  fetchCsrf: (): Promise<CsrfToken> => refreshCsrfToken(),
  me: async (): Promise<User> => (await httpClient.get<User>('/auth/me')).data,
  login: async (request: LoginRequest): Promise<User> => (await httpClient.post<User>('/auth/login', request)).data,
  register: async (request: RegisterRequest): Promise<User> => (await httpClient.post<User>('/auth/register', request)).data,
  logout: async (): Promise<void> => {
    await httpClient.post('/auth/logout')
  },
}
