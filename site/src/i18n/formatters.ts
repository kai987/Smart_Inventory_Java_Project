'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getLanguageDefinition, normalizeLanguage, type AppLanguage } from './language'

type ExactYenAmount = string | bigint
type LocalizedNumber = number | bigint

const formatterCache = new Map<string, Intl.NumberFormat>()
const localeFormatterCache = new Map<AppLanguage, LocaleFormatters>()

function getNumberFormatter(language: AppLanguage, kind: 'currency' | 'number' | 'weight'): Intl.NumberFormat {
  const locale = getLanguageDefinition(language).locale
  const cacheKey = `${locale}:${kind}`
  const cached = formatterCache.get(cacheKey)
  if (cached !== undefined) return cached

  const options: Intl.NumberFormatOptions = kind === 'currency'
    ? { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }
    : kind === 'weight'
      ? { style: 'unit', unit: 'kilogram', unitDisplay: 'short', maximumFractionDigits: 2 }
      : { maximumFractionDigits: 2 }
  const formatter = new Intl.NumberFormat(locale, options)
  formatterCache.set(cacheKey, formatter)
  return formatter
}

function toExactInteger(amount: ExactYenAmount): bigint {
  return typeof amount === 'bigint' ? amount : BigInt(amount)
}

export function formatYen(amount: ExactYenAmount, language: AppLanguage = 'en'): string {
  return getNumberFormatter(language, 'currency').format(toExactInteger(amount))
}

export function formatNumber(value: LocalizedNumber, language: AppLanguage = 'en'): string {
  return getNumberFormatter(language, 'number').format(value)
}

export function formatWeight(weightKg: number, language: AppLanguage = 'en'): string {
  return getNumberFormatter(language, 'weight').format(weightKg)
}

export type LocaleFormatters = {
  language: AppLanguage
  formatYen: (amount: ExactYenAmount) => string
  formatNumber: (value: LocalizedNumber) => string
  formatWeight: (weightKg: number) => string
}

export function getLocaleFormatters(language: AppLanguage): LocaleFormatters {
  const cached = localeFormatterCache.get(language)
  if (cached !== undefined) return cached

  const formatters: LocaleFormatters = {
    language,
    formatYen: (amount) => formatYen(amount, language),
    formatNumber: (value) => formatNumber(value, language),
    formatWeight: (weightKg) => formatWeight(weightKg, language),
  }
  localeFormatterCache.set(language, formatters)
  return formatters
}

export function useLocaleFormatters(): LocaleFormatters {
  const { i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
  return useMemo(() => getLocaleFormatters(language), [language])
}
