import { describe, expect, it } from 'vitest'
import { createI18nInstance } from '../i18n/i18n'
import type { AppLanguage } from '../i18n/language'
import { createRegisterSchema } from './RegisterPage'

describe.each<AppLanguage>(['en', 'ja', 'zh-CN'])('registration password bytes (%s)', (language) => {
  const t = createI18nInstance(language).getFixedT(language)
  const schema = createRegisterSchema(t)

  it.each(['a'.repeat(72), '中'.repeat(24), 'あ'.repeat(24), '😀'.repeat(18)])('accepts a 72-byte password', (password) => {
    expect(schema.safeParse({ username: 'customer', password }).success).toBe(true)
  })

  it.each(['a'.repeat(73), '中'.repeat(24) + 'a', 'あ'.repeat(25), '😀'.repeat(19)])('rejects a password over 72 bytes with a localized error', (password) => {
    const result = schema.safeParse({ username: 'customer', password })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message === t('validation.passwordMaxBytes'))).toBe(true)
  })
})
