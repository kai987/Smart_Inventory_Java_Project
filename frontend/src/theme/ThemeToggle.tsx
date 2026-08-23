'use client'

import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from './ThemeProvider'
import styles from './theme.module.css'

export function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? t('theme.switchToLight') : t('theme.switchToDark')

  return (
    <button
      className={styles.themeToggle}
      type="button"
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      onClick={toggleTheme}
    >
      <span key={theme} className={styles.themeIcon} aria-hidden="true">
        {isDark ? <Sun /> : <Moon />}
      </span>
    </button>
  )
}
