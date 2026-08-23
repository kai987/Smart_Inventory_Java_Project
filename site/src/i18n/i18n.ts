import i18next, { type i18n as I18n, type TFunction } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { detectLanguage, persistLanguage, type AppLanguage } from './language'
import { en } from './resources/en'
import { ja } from './resources/ja'
import { zhCN } from './resources/zhCN'

export const resources = {
  en: { translation: en },
  ja: { translation: ja },
  'zh-CN': { translation: zhCN },
} as const

export function createI18nInstance(initialLanguage: AppLanguage = detectLanguage()): I18n {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ja', 'zh-CN'],
    defaultNS: 'translation',
    ns: ['translation'],
    load: 'currentOnly',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
    returnNull: false,
  })
  return instance
}

export const createAppI18n = createI18nInstance
export const appI18n = createI18nInstance()

export function changeLanguage(language: AppLanguage, instance: I18n = appI18n): Promise<TFunction> {
  persistLanguage(language)
  return instance.changeLanguage(language)
}

export default appI18n
