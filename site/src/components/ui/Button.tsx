import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './ui.module.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'default' | 'small'
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'default', icon, className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]} ${size === 'small' ? styles.small : ''} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  )
}
