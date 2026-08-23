import { AlertTriangle, Archive, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import styles from './feedback.module.css'

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <section className={styles.state} role="alert">
      <span className={`${styles.stateIcon} ${styles.errorIcon}`}>
        <AlertTriangle aria-hidden="true" />
      </span>
      <h2>{t('errors.loadPageTitle')}</h2>
      <p>{message}</p>
      <Button type="button" variant="secondary" icon={<RefreshCw />} onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </section>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <section className={styles.state}>
      <span className={styles.stateIcon}>
        <Archive aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation()

  return (
    <div className={styles.skeletonList} role="status" aria-label={t('common.loadingContent')}>
      {Array.from({ length: rows }, (_, index) => (
        <div className={styles.skeletonRow} key={index}>
          <span className={styles.skeletonIcon} />
          <span className={styles.skeletonText} />
          <span className={styles.skeletonShort} />
        </div>
      ))}
    </div>
  )
}
