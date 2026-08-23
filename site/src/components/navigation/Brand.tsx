import { Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import styles from '../layout/layout.module.css'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/products" className={styles.brand} aria-label="Smart Inventory home">
      <Package className={styles.brandIcon} aria-hidden="true" />
      {compact ? null : <span>Smart Inventory</span>}
    </Link>
  )
}
