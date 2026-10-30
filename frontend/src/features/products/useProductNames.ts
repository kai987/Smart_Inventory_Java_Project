'use client'

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeLanguage } from '../../i18n/language'
import { getLocalizedProductName, type ProductNameTranslations } from './productCatalog'

export function useProductNames(): (productId: string, originalName: string, translations?: ProductNameTranslations) => string {
  const { i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
  return useCallback((productId: string, originalName: string, translations?: ProductNameTranslations) =>
    getLocalizedProductName(productId, originalName, language, translations), [language])
}
