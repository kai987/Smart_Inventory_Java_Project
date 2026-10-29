import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '../../components/feedback/ToastProvider'
import { I18nProvider } from '../../i18n/I18nProvider'
import { createI18nInstance } from '../../i18n/i18n'
import { ProductToastMessage } from './ProductToastMessage'

function ProductToastTrigger(props: ComponentProps<typeof ProductToastMessage>) {
  const { showToast } = useToast()
  return <button type="button" onClick={() => showToast(<ProductToastMessage {...props} />, 'info')}>Show product toast</button>
}

const messageCases = [
  {
    props: { kind: 'added', productId: 'P005', originalName: 'Desk Lamp' },
    messages: ['Desk Lamp added to your cart.', 'デスクライトをカートに追加しました。', '已将 台灯 加入购物车。'],
  },
  {
    props: { kind: 'stockAdjusted', productId: 'P005', originalName: 'Desk Lamp', stock: 12000 },
    messages: ['Desk Lamp was adjusted to the available stock (12,000).', 'デスクライトの数量を在庫数（12,000）に調整しました。', '已将 台灯 的数量调整为可用库存（12,000）。'],
  },
] as const

describe('ProductToastMessage', () => {
  it.each(messageCases)('reactively translates a visible $props.kind toast within its existing five-second lifetime', async ({ props, messages }) => {
    vi.useFakeTimers()
    try {
      const original = Object.freeze({ ...props })
      const instance = createI18nInstance('en')
      render(<I18nProvider instance={instance}><ToastProvider><ProductToastTrigger {...original} /></ToastProvider></I18nProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Show product toast' }))
      const toast = screen.getByRole('status')
      expect(toast).toHaveTextContent(messages[0])

      act(() => { vi.advanceTimersByTime(1000) })
      await act(() => instance.changeLanguage('ja'))
      expect(screen.getByRole('status')).toBe(toast)
      expect(toast).toHaveTextContent(messages[1])
      expect(toast).not.toHaveTextContent(messages[0])

      act(() => { vi.advanceTimersByTime(1000) })
      await act(() => instance.changeLanguage('zh-CN'))
      expect(screen.getByRole('status')).toBe(toast)
      expect(toast).toHaveTextContent(messages[2])
      expect(toast).not.toHaveTextContent(messages[1])
      expect(original).toEqual(props)
      expect(original.originalName).toBe('Desk Lamp')

      act(() => { vi.advanceTimersByTime(2999) })
      expect(screen.getByRole('status')).toBe(toast)
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
