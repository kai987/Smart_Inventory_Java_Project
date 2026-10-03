import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/apiError'
import { translateApiError, translateApiFieldError } from './apiErrorLocalization'
import { getLocaleFormatters, formatNumber, formatWeight, formatYen, useLocaleFormatters } from './formatters'
import { I18nProvider } from './I18nProvider'
import { createI18nInstance } from './i18n'
import { LanguageSelect } from './LanguageSelect'
import {
  LANGUAGE_STORAGE_KEY,
  detectLanguage,
  type AppLanguage,
} from './language'
import { en } from './resources/en'
import { ja } from './resources/ja'
import { zhCN } from './resources/zhCN'
import { useLocalizedDocumentTitle } from './useLocalizedDocumentTitle'

function renderWithI18n(children: ReactNode, language: AppLanguage = 'en') {
  const instance = createI18nInstance(language)
  return {
    instance,
    ...render(<I18nProvider instance={instance}>{children}</I18nProvider>),
  }
}

function flattenResource(resource: unknown, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  if (typeof resource !== 'object' || resource === null) return entries
  for (const [key, value] of Object.entries(resource)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') entries.set(path, value)
    else for (const [nestedKey, nestedValue] of flattenResource(value, path)) entries.set(nestedKey, nestedValue)
  }
  return entries
}

function apiError(code: string, status = 400): ApiError {
  return new ApiError({ timestamp: '', status, code, message: 'Internal server text', path: '/api/test', fieldErrors: [] })
}

describe('language detection', () => {
  it.each<AppLanguage>(['en', 'ja', 'zh-CN'])('uses a valid stored %s language first', (language) => {
    const storage = { getItem: () => language }
    expect(detectLanguage({ storage, navigator: { languages: ['ja-JP'], language: 'ja-JP' } })).toBe(language)
  })

  it('ignores an invalid stored value and detects the browser language', () => {
    expect(detectLanguage({
      storage: { getItem: () => 'fr' },
      navigator: { languages: ['ja-JP'], language: 'en-US' },
    })).toBe('ja')
  })

  it('maps Japanese browser variants to Japanese', () => {
    expect(detectLanguage({ storage: null, navigator: { languages: ['ja-JP'] } })).toBe('ja')
  })

  it('maps Traditional Chinese browser variants to the available Simplified Chinese UI', () => {
    expect(detectLanguage({ storage: null, navigator: { languages: ['zh-TW'] } })).toBe('zh-CN')
  })

  it('uses navigator.language when navigator.languages is unavailable', () => {
    expect(detectLanguage({ storage: null, navigator: { language: 'ja-JP' } })).toBe('ja')
  })

  it('falls back to English for unknown browser languages', () => {
    expect(detectLanguage({ storage: null, navigator: { languages: ['fr-FR'], language: 'de-DE' } })).toBe('en')
  })

  it('does not crash when localStorage access throws', () => {
    const storage = { getItem: () => { throw new Error('Storage is unavailable') } }
    expect(detectLanguage({ storage, navigator: { languages: ['ja-JP'] } })).toBe('ja')
  })
})

describe('i18n instance and LanguageSelect', () => {
  it('initializes a synchronous instance with the requested language and English fallback', () => {
    const instance = createI18nInstance('ja')
    expect(instance.isInitialized).toBe(true)
    expect(instance.resolvedLanguage).toBe('ja')
    expect(instance.t('products.title')).toBe('商品一覧')
  })

  it.each([
    ['ja', '日本語', '言語'],
    ['zh-CN', '简体中文', '语言'],
    ['en', 'English', 'Language'],
  ] as const)('switches to %s without reloading and persists it', async (language, optionName, accessibleLabel) => {
    const { instance } = renderWithI18n(<LanguageSelect />, language === 'en' ? 'ja' : 'en')
    const select = screen.getByRole('combobox')
    await userEvent.setup().selectOptions(select, optionName)

    await waitFor(() => {
      expect(instance.resolvedLanguage).toBe(language)
      expect(select).toHaveValue(language)
      expect(select).toHaveAccessibleName(accessibleLabel)
      expect(document.documentElement.lang).toBe(language)
    })
    expect(document.documentElement.dir).toBe('ltr')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(language)
  })

  it('is keyboard focusable as a native select', async () => {
    renderWithI18n(<LanguageSelect />)
    await userEvent.setup().tab()
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveFocus()
  })

  it('still changes language when storage writes throw', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value: () => { throw new Error('Storage is unavailable') },
    })
    try {
      const { instance } = renderWithI18n(<LanguageSelect />)
      await userEvent.setup().selectOptions(screen.getByRole('combobox'), '日本語')
      await waitFor(() => expect(instance.resolvedLanguage).toBe('ja'))
    } finally {
      if (descriptor !== undefined) Object.defineProperty(Storage.prototype, 'setItem', descriptor)
    }
  })
})

describe('translation resources', () => {
  const resources = { en, ja, 'zh-CN': zhCN }
  const englishKeys = [...flattenResource(en).keys()].sort()

  it.each(Object.entries(resources))('%s has exactly the same key set as English', (_language, resource) => {
    expect([...flattenResource(resource).keys()].sort()).toEqual(englishKeys)
  })

  it.each(Object.entries(resources))('%s contains no empty translations', (_language, resource) => {
    for (const value of flattenResource(resource).values()) expect(value.trim()).not.toBe('')
  })
})

describe('locale formatters', () => {
  it.each([
    ['en', 'en-US'],
    ['ja', 'ja-JP'],
    ['zh-CN', 'zh-CN'],
  ] as const)('formats JPY with the %s locale', (language, locale) => {
    const expected = new Intl.NumberFormat(locale, {
      style: 'currency', currency: 'JPY', maximumFractionDigits: 0,
    }).format(120000n)
    expect(formatYen('120000', language)).toBe(expected)
  })

  it('keeps BigInt yen amounts exact beyond Number.MAX_SAFE_INTEGER', () => {
    const amount = 9_007_199_254_740_993n
    const expected = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'JPY', maximumFractionDigits: 0,
    }).format(amount)
    expect(formatYen(amount, 'en')).toBe(expected)
    expect(formatYen(amount.toString(), 'en')).toBe(expected)
  })

  it('localizes weights and inventory numbers', () => {
    expect(formatWeight(12.5, 'ja')).toBe(new Intl.NumberFormat('ja-JP', {
      style: 'unit', unit: 'kilogram', unitDisplay: 'short', maximumFractionDigits: 2,
    }).format(12.5))
    expect(formatNumber(12345, 'zh-CN')).toBe(new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(12345))
  })

  it('reuses the cached formatter bundle for each language', () => {
    expect(getLocaleFormatters('en')).toBe(getLocaleFormatters('en'))
    expect(getLocaleFormatters('ja')).not.toBe(getLocaleFormatters('en'))
  })

  it('updates the formatter hook when the active language changes', async () => {
    function Probe() {
      const formatters = useLocaleFormatters()
      return <output>{formatters.language}:{formatters.formatNumber(12345)}</output>
    }
    const { instance } = renderWithI18n(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent(`en:${formatNumber(12345, 'en')}`)
    await act(() => instance.changeLanguage('ja'))
    expect(screen.getByRole('status')).toHaveTextContent(`ja:${formatNumber(12345, 'ja')}`)
  })
})

describe('API error localization', () => {
  it.each([
    ['en', 'INVALID_CREDENTIALS', en.errors.INVALID_CREDENTIALS],
    ['ja', 'INVALID_CREDENTIALS', ja.errors.INVALID_CREDENTIALS],
    ['zh-CN', 'INVALID_CREDENTIALS', zhCN.errors.INVALID_CREDENTIALS],
    ['en', 'USERNAME_EXISTS', en.errors.USERNAME_EXISTS],
    ['ja', 'USERNAME_EXISTS', ja.errors.USERNAME_EXISTS],
    ['zh-CN', 'USERNAME_EXISTS', zhCN.errors.USERNAME_EXISTS],
    ['en', 'INSUFFICIENT_STOCK', en.errors.INSUFFICIENT_STOCK],
    ['ja', 'INSUFFICIENT_STOCK', ja.errors.INSUFFICIENT_STOCK],
    ['zh-CN', 'INSUFFICIENT_STOCK', zhCN.errors.INSUFFICIENT_STOCK],
    ['en', 'NETWORK_ERROR', en.errors.NETWORK_ERROR],
    ['ja', 'NETWORK_ERROR', ja.errors.NETWORK_ERROR],
    ['zh-CN', 'NETWORK_ERROR', zhCN.errors.NETWORK_ERROR],
    ['en', 'IDEMPOTENCY_CONFLICT', en.errors.IDEMPOTENCY_CONFLICT],
    ['ja', 'IDEMPOTENCY_CONFLICT', ja.errors.IDEMPOTENCY_CONFLICT],
    ['zh-CN', 'IDEMPOTENCY_CONFLICT', zhCN.errors.IDEMPOTENCY_CONFLICT],
    ['en', 'RATE_LIMITED', en.errors.RATE_LIMITED],
    ['ja', 'RATE_LIMITED', ja.errors.RATE_LIMITED],
    ['zh-CN', 'RATE_LIMITED', zhCN.errors.RATE_LIMITED],
  ] as const)('translates %s %s errors', (language, code, expected) => {
    const t = createI18nInstance(language).getFixedT(language)
    expect(translateApiError(apiError(code), t)).toBe(expected)
  })

  it.each([
    ['en', en.errors.generic],
    ['ja', ja.errors.generic],
    ['zh-CN', zhCN.errors.generic],
  ] as const)('uses the localized %s generic message for unknown codes', (language, expected) => {
    const t = createI18nInstance(language).getFixedT(language)
    expect(translateApiError(apiError('UNEXPECTED_SERVER_CODE', 500), t)).toBe(expected)
  })

  it('localizes known and unknown server field errors without exposing server text', () => {
    const t = createI18nInstance('ja').getFixedT('ja')
    expect(translateApiFieldError({ field: 'request.stock' }, t)).toBe(ja.validation.invalidStock)
    expect(translateApiFieldError({ field: 'private.internalField' }, t)).toBe(ja.validation.invalidValue)
  })
})

describe('localized document metadata', () => {
  it('updates the document title and description when language changes', async () => {
    function MetadataProbe() {
      useLocalizedDocumentTitle('products.title')
      return null
    }
    const { instance } = renderWithI18n(<MetadataProbe />)
    expect(document.title).toBe('Products | Smart Inventory')
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', en.metadata.description)

    await act(() => instance.changeLanguage('ja'))
    expect(document.title).toBe('商品一覧 | Smart Inventory')
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', ja.metadata.description)
  })
})
