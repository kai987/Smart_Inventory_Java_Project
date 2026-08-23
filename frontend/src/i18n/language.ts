export type AppLanguage = 'en' | 'ja' | 'zh-CN'

export const LANGUAGE_STORAGE_KEY = 'smart-inventory-language:v1'
export const DEFAULT_LANGUAGE: AppLanguage = 'en'

export const supportedLanguages = [
  {
    code: 'en',
    htmlLang: 'en',
    locale: 'en-US',
    nativeLabel: 'English',
    compactLabel: 'EN',
  },
  {
    code: 'ja',
    htmlLang: 'ja',
    locale: 'ja-JP',
    nativeLabel: '日本語',
    compactLabel: '日本語',
  },
  {
    code: 'zh-CN',
    htmlLang: 'zh-CN',
    locale: 'zh-CN',
    nativeLabel: '简体中文',
    compactLabel: '中文',
  },
] as const

export type SupportedLanguage = (typeof supportedLanguages)[number]

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export type NavigatorLanguageSource = {
  languages?: readonly string[] | undefined
  language?: string | undefined
}

export type LanguageDetectionOptions = {
  storage?: StorageReader | null
  navigator?: NavigatorLanguageSource | null
}

const languageByCode = new Map<AppLanguage, SupportedLanguage>(
  supportedLanguages.map((language) => [language.code, language]),
)

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'ja' || value === 'zh-CN'
}

/** Maps browser language tags to one of the languages shipped by the app. */
export function matchSupportedLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replaceAll('_', '-').toLowerCase()
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return null
}

export function normalizeLanguage(value: unknown): AppLanguage {
  return matchSupportedLanguage(value) ?? DEFAULT_LANGUAGE
}

export function getLanguageDefinition(language: AppLanguage): SupportedLanguage {
  return languageByCode.get(language) ?? supportedLanguages[0]
}

function getBrowserStorage(): StorageReader | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function getBrowserNavigator(): NavigatorLanguageSource | null {
  try {
    return typeof navigator === 'undefined' ? null : navigator
  } catch {
    return null
  }
}

export function readStoredLanguage(storage: StorageReader | null = getBrowserStorage()): AppLanguage | null {
  if (storage === null) return null
  try {
    const stored = storage.getItem(LANGUAGE_STORAGE_KEY)
    return isAppLanguage(stored) ? stored : null
  } catch {
    return null
  }
}

export function persistLanguage(
  language: AppLanguage,
  storage: StorageWriter | null = getBrowserStorage() as (StorageReader & StorageWriter) | null,
): void {
  if (storage === null) return
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Storage can be disabled by browser privacy settings; language still changes in memory.
  }
}

export function detectLanguage(options: LanguageDetectionOptions = {}): AppLanguage {
  const storage = options.storage === undefined ? getBrowserStorage() : options.storage
  const stored = readStoredLanguage(storage)
  if (stored !== null) return stored

  const languageSource = options.navigator === undefined ? getBrowserNavigator() : options.navigator
  if (languageSource !== null) {
    for (const candidate of languageSource.languages ?? []) {
      const match = matchSupportedLanguage(candidate)
      if (match !== null) return match
    }
    const languageMatch = matchSupportedLanguage(languageSource.language)
    if (languageMatch !== null) return languageMatch
  }

  return DEFAULT_LANGUAGE
}

export function applyDocumentLanguage(language: AppLanguage, documentNode: Document | null = typeof document === 'undefined' ? null : document): void {
  if (documentNode === null) return
  documentNode.documentElement.lang = getLanguageDefinition(language).htmlLang
  documentNode.documentElement.dir = 'ltr'
}
