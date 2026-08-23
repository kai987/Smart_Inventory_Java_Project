'use client'

import type { i18n as I18n } from 'i18next'
import { useEffect, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import appI18n from './i18n'
import {
  applyDocumentLanguage,
  normalizeLanguage,
  persistLanguage,
  type AppLanguage,
} from './language'

type I18nProviderProps = {
  children: ReactNode
  instance?: I18n
  initialLanguage?: AppLanguage
}

export function I18nProvider({ children, instance = appI18n, initialLanguage }: I18nProviderProps) {
  useEffect(() => {
    if (initialLanguage !== undefined && normalizeLanguage(instance.resolvedLanguage ?? instance.language) !== initialLanguage) {
      persistLanguage(initialLanguage)
      void instance.changeLanguage(initialLanguage)
    }
  }, [initialLanguage, instance])

  useEffect(() => {
    const synchronizeLanguage = (nextLanguage: string) => {
      const language = normalizeLanguage(nextLanguage)
      applyDocumentLanguage(language)
      persistLanguage(language)
    }

    synchronizeLanguage(instance.resolvedLanguage ?? instance.language)
    instance.on('languageChanged', synchronizeLanguage)
    return () => {
      instance.off('languageChanged', synchronizeLanguage)
    }
  }, [instance])

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}
