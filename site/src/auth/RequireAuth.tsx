import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from './AuthProvider'
import { PageLoading } from '../components/feedback/PageLoading'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <PageLoading label={t('auth.checkingSession')} />
  if (user === null) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return children
}
