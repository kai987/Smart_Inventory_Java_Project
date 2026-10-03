'use client'

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export type DocumentTitleKey =
  | 'products.title'
  | 'cart.title'
  | 'orders.title'
  | 'auth.loginTitle'
  | 'auth.registerTitle'
  | 'admin.dashboardTitle'
  | 'admin.productManagementTitle'
  | 'admin.ordersTitle'
  | 'access.forbiddenTitle'
  | 'access.notFoundTitle'

export function useLocalizedDocumentTitle(titleKey: DocumentTitleKey): void {
  const { t, i18n } = useTranslation()
  const resolvedLanguage = i18n.resolvedLanguage ?? i18n.language

  useEffect(() => {
    document.title = t('metadata.pageTitle', { page: t(titleKey) })
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (description === null) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.appendChild(description)
    }
    description.content = t('metadata.description')
  }, [resolvedLanguage, t, titleKey])
}
