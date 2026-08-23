import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from './ui.module.css'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | undefined
  hint?: string | undefined
  endAdornment?: ReactNode
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, endAdornment, className = '', ...props },
  ref,
) {
  const inputId = id ?? props.name
  const descriptionId = `${inputId ?? 'field'}-description`
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={inputId}>{label}</label>
      <span className={styles.inputWrap}>
        <input
          {...props}
          ref={ref}
          id={inputId}
          className={`${styles.input} ${error === undefined ? '' : styles.inputError} ${className}`}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined && hint === undefined ? undefined : descriptionId}
        />
        {endAdornment === undefined ? null : <span className={styles.inputAdornment}>{endAdornment}</span>}
      </span>
      {error === undefined && hint === undefined ? null : (
        <span id={descriptionId} className={error === undefined ? styles.hint : styles.fieldError}>
          {error ?? hint}
        </span>
      )}
    </div>
  )
})
