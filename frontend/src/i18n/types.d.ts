import 'i18next'
import type { en } from './resources/en'

declare module 'i18next' {
  // Module augmentation requires an interface declaration.
  interface CustomTypeOptions {
    defaultNS: 'translation'
    returnNull: false
    strictKeyChecks: true
    resources: {
      translation: typeof en
    }
  }
}
