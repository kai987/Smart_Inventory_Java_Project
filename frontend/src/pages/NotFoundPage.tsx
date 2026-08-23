import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from './pages.module.css'

export function NotFoundPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  useLocalizedDocumentTitle('access.notFoundTitle')
  return (
    <section className={styles.notFound}>
      <strong aria-hidden="true">404</strong>
      <h1>{t('access.notFoundTitle')}</h1>
      <p>{t('access.notFoundDescription')}</p>
      <Button type="button" onClick={() => navigate('/products')}>{t('access.returnToProducts')}</Button>
    </section>
  )
}
