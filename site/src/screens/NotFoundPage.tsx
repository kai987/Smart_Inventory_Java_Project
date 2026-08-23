import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import styles from './pages.module.css'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <section className={styles.notFound}>
      <strong aria-hidden="true">404</strong>
      <h1>Page not found</h1>
      <p>The page you requested does not exist or may have moved.</p>
      <Button type="button" onClick={() => navigate('/products')}>Return to products</Button>
    </section>
  )
}
