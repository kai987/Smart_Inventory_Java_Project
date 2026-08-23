import { ShieldX } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import styles from './pages.module.css'

export function ForbiddenPage() {
  const navigate = useNavigate()
  return (
    <section className={styles.notFound}>
      <ShieldX size={64} color="var(--danger)" aria-hidden="true" />
      <h1>Access denied</h1>
      <p>Your account does not have permission to open this page.</p>
      <Button type="button" onClick={() => navigate('/products')}>Return to products</Button>
    </section>
  )
}
