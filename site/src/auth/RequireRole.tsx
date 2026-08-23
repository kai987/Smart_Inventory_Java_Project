import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Role } from '../api/types'
import { useAuth } from './AuthProvider'
import { PageLoading } from '../components/feedback/PageLoading'

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useTranslation()
  const { user, isLoading } = useAuth()
  if (isLoading) return <PageLoading label={t('access.checkingPermissions')} />
  if (user?.role !== role) return <Navigate to="/403" replace />
  return children
}
