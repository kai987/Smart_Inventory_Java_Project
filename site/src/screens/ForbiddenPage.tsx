import { ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from './pages.module.css'

export function ForbiddenPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  useLocalizedDocumentTitle('access.forbiddenTitle')
  return (
    <section className={styles.notFound}>
      <ShieldX size={64} color="var(--danger)" aria-hidden="true" />
      <h1>{t('access.forbiddenTitle')}</h1>
      <p>{t('access.forbiddenDescription')}</p>
      <Button type="button" onClick={() => navigate('/products')}>{t('access.returnToProducts')}</Button>
    </section>
  )
}
