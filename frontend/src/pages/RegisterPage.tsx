import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { applyFieldErrors, toApiError } from '../api/apiError'
import { authApi } from '../api/authApi'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { useToast } from '../components/feedback/ToastProvider'
import styles from './pages.module.css'

const registerSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, 'Use 3–20 ASCII letters, numbers, or underscores.'),
  password: z
    .string()
    .min(4, 'Password must be at least 4 characters.')
    .max(100, 'Password must be at most 100 characters.')
    .refine((value) => !/[,|:\r\n]/.test(value), 'Password cannot contain commas, pipes, colons, or line breaks.'),
})

type RegisterValues = z.infer<typeof registerSchema>
const registerFields = ['username', 'password'] as const

export function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await authApi.register(values)
      showToast('Account created. You can now sign in.', 'success')
      void navigate('/login', { replace: true })
    } catch (error: unknown) {
      const apiError = toApiError(error)
      applyFieldErrors(apiError, setError, registerFields)
      setSubmitError(apiError.code === 'USERNAME_EXISTS' ? 'That username is already in use.' : apiError.message)
    }
  })

  return (
    <div className={styles.authPage}>
      <section className={styles.authCard}>
        <h1>Create an account</h1>
        <p className={styles.authIntro}>Register as a customer to place and review orders.</p>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {submitError === null ? null : <p className={styles.formMessage} role="alert">{submitError}</p>}
          <Field
            label="Username"
            autoComplete="username"
            hint="3–20 letters, numbers, or underscores"
            error={errors.username?.message}
            {...register('username')}
          />
          <Field
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            hint="4–100 characters; no commas, pipes, colons, or line breaks"
            error={errors.password?.message}
            endAdornment={
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            }
            {...register('password')}
          />
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create account'}</Button>
        </form>
        <p className={styles.authFooter}>Already registered? <Link to="/login">Sign in</Link></p>
      </section>
      <aside className={styles.demoPanel}>
        <h2>Customer access</h2>
        <p>Every registration creates a CUSTOMER account. Administrator access cannot be requested through this form.</p>
        <div className={styles.demoAccount}>
          <h3>What you can do</h3>
          <p>Browse products, keep a cart on this device, place orders, and view your own order history.</p>
        </div>
      </aside>
    </div>
  )
}
