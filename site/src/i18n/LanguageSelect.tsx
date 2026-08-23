'use client'

import { ChevronDown, Globe2 } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from './i18n'
import { getLanguageDefinition, isAppLanguage, normalizeLanguage, supportedLanguages } from './language'
import styles from './LanguageSelect.module.css'

type LanguageSelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'disabled'>

export function LanguageSelect({ className = '', disabled = false }: LanguageSelectProps) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
  const definition = getLanguageDefinition(language)
  const label = t('language.label')

  return (
    <label className={`${styles.control} ${className}`}>
      <span className={styles.visuallyHidden}>{label}</span>
      <Globe2 className={styles.globe} aria-hidden="true" />
      <select
        className={styles.select}
        value={language}
        disabled={disabled}
        title={label}
        onChange={(event) => {
          const nextLanguage = event.target.value
          if (isAppLanguage(nextLanguage)) void changeLanguage(nextLanguage, i18n)
        }}
      >
        {supportedLanguages.map((option) => (
          <option key={option.code} value={option.code}>{option.nativeLabel}</option>
        ))}
      </select>
      <span className={styles.currentLanguage} aria-hidden="true">
        <span className={styles.fullLabel}>{definition.nativeLabel}</span>
        <span className={styles.compactLabel}>{definition.compactLabel}</span>
      </span>
      <ChevronDown className={styles.chevron} aria-hidden="true" />
    </label>
  )
}
