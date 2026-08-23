import { httpClient } from './httpClient'
import type { DashboardSummary } from './types'

export const adminApi = {
  summary: async (): Promise<DashboardSummary> => (await httpClient.get<DashboardSummary>('/admin/summary')).data,
}
