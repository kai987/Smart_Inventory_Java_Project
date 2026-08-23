import { LoaderCircle } from 'lucide-react'
import styles from './feedback.module.css'

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.pageLoading} role="status" aria-live="polite">
      <LoaderCircle className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
