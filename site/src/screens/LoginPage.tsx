import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { toApiError } from '../api/apiError'
import { useAuth } from '../auth/AuthProvider'
import { safeNextPath } from '../auth/safeNextPath'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import styles from './pages.module.css'

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })

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
      const apiError = toApiError(error)
      setSubmitError(apiError.code === 'INVALID_CREDENTIALS' ? 'Invalid username or password.' : apiError.message)
    }
  })

  return (
    <div className={styles.authPage}>
      <section className={styles.authCard}>
        <h1>Welcome back</h1>
        <p className={styles.authIntro}>Sign in to manage your orders or inventory.</p>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {submitError === null ? null : <p className={styles.formMessage} role="alert">{submitError}</p>}
          <Field label="Username" autoComplete="username" error={errors.username?.message} {...register('username')} />
          <Field
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            error={errors.password?.message}
            endAdornment={
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            }
            {...register('password')}
          />
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <p className={styles.authFooter}>New to Smart Inventory? <Link to="/register">Create an account</Link></p>
      </section>

      <aside className={styles.demoPanel} aria-labelledby="demo-accounts-title">
        <h2 id="demo-accounts-title">Demo accounts</h2>
        <p>Fill in either account, then submit the form when you are ready.</p>
        <div className={styles.demoAccount}>
          <h3>Customer</h3>
          <dl><dt>Username</dt><dd>customer</dd><dt>Password</dt><dd>user123</dd></dl>
          <Button type="button" variant="secondary" size="small" onClick={() => fillDemo('customer', 'user123')}>Fill Customer Demo</Button>
        </div>
        <div className={styles.demoAccount}>
          <h3>Administrator</h3>
          <dl><dt>Username</dt><dd>admin</dd><dt>Password</dt><dd>admin123</dd></dl>
          <Button type="button" variant="secondary" size="small" onClick={() => fillDemo('admin', 'admin123')}>Fill Admin Demo</Button>
        </div>
      </aside>
    </div>
  )
}
