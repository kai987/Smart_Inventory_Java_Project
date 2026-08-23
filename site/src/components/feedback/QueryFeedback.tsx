import { AlertTriangle, Archive, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import styles from './feedback.module.css'

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className={styles.state} role="alert">
      <span className={`${styles.stateIcon} ${styles.errorIcon}`}>
        <AlertTriangle aria-hidden="true" />
      </span>
      <h2>We couldn’t load this page</h2>
      <p>{message}</p>
      <Button type="button" variant="secondary" icon={<RefreshCw />} onClick={onRetry}>
        Try again
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
  return (
    <div className={styles.skeletonList} role="status" aria-label="Loading content">
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
