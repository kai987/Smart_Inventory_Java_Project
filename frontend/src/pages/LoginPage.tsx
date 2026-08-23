import { zodResolver } from '@hookform/resolvers/zod'
import type { TFunction } from 'i18next'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { toApiError } from '../api/apiError'
import { useAuth } from '../auth/AuthProvider'
import { safeNextPath } from '../auth/safeNextPath'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { translateApiError } from '../i18n/apiErrorLocalization'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from './pages.module.css'

export function createLoginSchema(t: TFunction) {
  return z.object({
    username: z.string().trim().min(1, t('validation.usernameRequired')),
    password: z.string().min(1, t('validation.passwordRequired')),
  })
}

type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const resolvedLanguage = i18n.resolvedLanguage
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<ReturnType<typeof toApiError> | null>(null)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const schema = useMemo(() => {
    void resolvedLanguage
    return createLoginSchema(t)
  }, [resolvedLanguage, t])
  const { clearErrors, register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  })
  useLocalizedDocumentTitle('auth.loginTitle')

  useEffect(() => {
    clearErrors()
  }, [clearErrors, resolvedLanguage])

  const fillDemo = (username: string, password: string) => {
    setValue('username', username, { shouldValidate: true })
    setValue('password', password, { shouldValidate: true })
    setSubmitError(null)
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      const user = await login(values)
      const next = safeNextPath(searchParams.get('next'))
      void navigate(user.role === 'ADMIN' ? '/admin' : (next ?? '/products'), { replace: true })
    } catch (error: unknown) {
      setSubmitError(toApiError(error))
    }
  })

  return (
    <div className={styles.authPage}>
      <section className={styles.authCard}>
        <h1>{t('auth.loginTitle')}</h1>
        <p className={styles.authIntro}>{t('auth.loginIntro')}</p>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {submitError === null ? null : <p className={styles.formMessage} role="alert">{translateApiError(submitError, t)}</p>}
          <Field label={t('auth.username')} autoComplete="username" error={errors.username?.message} {...register('username')} />
          <Field
            label={t('auth.password')}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            error={errors.password?.message}
            endAdornment={
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            }
            {...register('password')}
          />
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t('auth.signingIn') : t('auth.signIn')}</Button>
        </form>
        <p className={styles.authFooter}>{t('auth.newToApp')} <Link to="/register">{t('auth.createAccount')}</Link></p>
      </section>

      <aside className={styles.demoPanel} aria-labelledby="demo-accounts-title">
        <h2 id="demo-accounts-title">{t('auth.demoAccounts')}</h2>
        <p>{t('auth.demoIntro')}</p>
        <div className={styles.demoAccount}>
          <h3>{t('auth.customer')}</h3>
          <dl><dt>{t('auth.username')}</dt><dd>customer</dd><dt>{t('auth.password')}</dt><dd>user123</dd></dl>
          <Button type="button" variant="secondary" size="small" onClick={() => fillDemo('customer', 'user123')}>{t('auth.fillCustomerDemo')}</Button>
        </div>
        <div className={styles.demoAccount}>
          <h3>{t('auth.administrator')}</h3>
          <dl><dt>{t('auth.username')}</dt><dd>admin</dd><dt>{t('auth.password')}</dt><dd>admin123</dd></dl>
          <Button type="button" variant="secondary" size="small" onClick={() => fillDemo('admin', 'admin123')}>{t('auth.fillAdminDemo')}</Button>
        </div>
      </aside>
    </div>
  )
}
