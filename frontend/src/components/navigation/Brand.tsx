import { Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styles from '../layout/layout.module.css'

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()

  return (
    <Link to="/products" className={styles.brand} aria-label={t('app.homeLabel')}>
      <Package className={styles.brandIcon} aria-hidden="true" />
      {compact ? null : <span>Smart Inventory</span>}
    </Link>
  )
}
