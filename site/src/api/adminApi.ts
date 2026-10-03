import { httpClient } from './httpClient'
import type { DashboardSummary } from './types'

export const adminApi = {
  summary: async (signal?: AbortSignal): Promise<DashboardSummary> => (await httpClient.get<DashboardSummary>('/admin/summary', signal === undefined ? {} : { signal })).data,
}
