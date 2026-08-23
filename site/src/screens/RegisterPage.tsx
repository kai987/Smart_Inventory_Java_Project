import { zodResolver } from '@hookform/resolvers/zod'
import type { TFunction } from 'i18next'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { toApiError } from '../api/apiError'
import { authApi } from '../api/authApi'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { useToast } from '../components/feedback/ToastProvider'
import { translateApiError, translateApiFieldError } from '../i18n/apiErrorLocalization'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from './pages.module.css'

export function createRegisterSchema(t: TFunction) {
  return z.object({
    username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, t('validation.usernamePattern')),
    password: z
      .string()
      .min(4, t('validation.passwordMin'))
      .max(100, t('validation.passwordMax'))
      .refine((value) => !/[,|:\r\n]/.test(value), t('validation.passwordReservedCharacters')),
  })
}

type RegisterValues = z.infer<ReturnType<typeof createRegisterSchema>>
const registerFields = ['username', 'password'] as const
type RegisterField = typeof registerFields[number]

function isRegisterField(value: string): value is RegisterField {
  return (registerFields as readonly string[]).includes(value)
}

export function RegisterPage() {
  const { t, i18n } = useTranslation()
  const resolvedLanguage = i18n.resolvedLanguage
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<ReturnType<typeof toApiError> | null>(null)
  const navigate = useNavigate()
  const { showToast } = useToast()
  const schema = useMemo(() => {
    void resolvedLanguage
    return createRegisterSchema(t)
  }, [resolvedLanguage, t])
  const { clearErrors, register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  })
  useLocalizedDocumentTitle('auth.registerTitle')

  useEffect(() => {
    clearErrors()
  }, [clearErrors, resolvedLanguage])

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await authApi.register(values)
      showToast(t('auth.accountCreated'), 'success')
      void navigate('/login', { replace: true })
    } catch (error: unknown) {
      const apiError = toApiError(error)
      for (const fieldError of apiError.fieldErrors) {
        const field = fieldError.field.replace(/^request\./, '')
        if (isRegisterField(field)) {
          setError(field, { type: 'server', message: translateApiFieldError(fieldError, t) })
        }
      }
      setSubmitError(apiError)
    }
  })

  return (
    <div className={styles.authPage}>
      <section className={styles.authCard}>
        <h1>{t('auth.registerTitle')}</h1>
        <p className={styles.authIntro}>{t('auth.registerIntro')}</p>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {submitError === null ? null : <p className={styles.formMessage} role="alert">{translateApiError(submitError, t)}</p>}
          <Field
            label={t('auth.username')}
            autoComplete="username"
            hint={t('auth.usernameHint')}
            error={errors.username?.message}
            {...register('username')}
          />
          <Field
            label={t('auth.password')}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            hint={t('auth.passwordHint')}
            error={errors.password?.message}
            endAdornment={
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            }
            {...register('password')}
          />
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t('auth.creatingAccount') : t('auth.createAccount')}</Button>
        </form>
        <p className={styles.authFooter}>{t('auth.alreadyRegistered')} <Link to="/login">{t('auth.signIn')}</Link></p>
      </section>
      <aside className={styles.demoPanel}>
        <h2>{t('auth.customerAccess')}</h2>
        <p>{t('auth.customerAccessDescription')}</p>
        <div className={styles.demoAccount}>
          <h3>{t('auth.capabilitiesTitle')}</h3>
          <p>{t('auth.capabilitiesDescription')}</p>
        </div>
      </aside>
    </div>
  )
}
