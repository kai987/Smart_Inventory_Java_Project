import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './feedback.module.css'

type ToastTone = 'success' | 'error' | 'info'

type Toast = {
  id: number
  message: string
  tone: ToastTone
}

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const toastIcons = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current
      nextId.current += 1
      setToasts((current) => [...current, { id, message, tone }])
      window.setTimeout(() => removeToast(id), 5000)
    },
    [removeToast],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext value={value}>
      {children}
      <div className={styles.toastRegion} aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = toastIcons[toast.tone]
          return (
            <div className={`${styles.toast} ${styles[toast.tone]}`} key={toast.id} role="status">
              <Icon aria-hidden="true" />
              <span>{toast.message}</span>
              <button type="button" onClick={() => removeToast(toast.id)} aria-label="Dismiss notification">
                <X size={18} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext>
  )
}

export function useToast(): ToastContextValue {
  const context = use(ToastContext)
  if (context === null) throw new Error('useToast must be used within ToastProvider')
  return context
}
