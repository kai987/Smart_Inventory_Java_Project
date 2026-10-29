import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n/I18nProvider'
import { createI18nInstance } from '../../i18n/i18n'
import { useProductNames } from './useProductNames'

describe('useProductNames', () => {
  it('updates product names when language changes and keeps its callback stable within one language', async () => {
    const instance = createI18nInstance('en')
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider instance={instance}>{children}</I18nProvider>
    const { result, rerender } = renderHook(() => useProductNames(), { wrapper })
    const englishName = result.current
    expect(englishName('P001', 'Laptop')).toBe('Laptop')
    rerender()
    expect(result.current).toBe(englishName)

    await act(() => instance.changeLanguage('ja'))
    const japaneseName = result.current
    expect(japaneseName).not.toBe(englishName)
    expect(japaneseName('P001', 'Laptop')).toBe('ノートパソコン')
    rerender()
    expect(result.current).toBe(japaneseName)

    await act(() => instance.changeLanguage('zh-CN'))
    expect(result.current('P001', 'Laptop')).toBe('笔记本电脑')
    expect(result.current('P001', 'Renamed laptop')).toBe('Renamed laptop')
    expect(result.current('CUSTOM-1', 'Laptop')).toBe('Laptop')
  })
})
