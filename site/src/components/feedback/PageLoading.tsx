import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './feedback.module.css'

export function PageLoading({ label }: { label?: string }) {
  const { t } = useTranslation()

  return (
    <div className={styles.pageLoading} role="status" aria-live="polite">
      <LoaderCircle className={styles.spinner} aria-hidden="true" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  )
}
