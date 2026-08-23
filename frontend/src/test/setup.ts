import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import appI18n from '../i18n/i18n'

beforeEach(() => {
  window.localStorage.clear()
  void appI18n.changeLanguage('en')
  document.documentElement.lang = 'en'
  document.documentElement.dir = 'ltr'
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

afterEach(() => {
  cleanup()
  void appI18n.changeLanguage('en')
  window.localStorage.clear()
  vi.restoreAllMocks()
})
