import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { orderApi } from '../api/orderApi'
import type { Order } from '../api/types'
import { LanguageSelect } from '../i18n/LanguageSelect'
import type { AppLanguage } from '../i18n/language'
import { renderWithProviders } from '../test/render'
import AdminOrdersPage from './AdminOrdersPage'

function historicalOrder(): Order {
  const item = (productId: string, productName: string): Order['items'][number] => ({
    productId, productName, unitPriceYen: '3200', unitWeightKg: 0.8,
    quantity: 1, subtotalYen: '3200', totalWeightKg: 0.8,
  })
  return {
    orderId: 'O-admin-history-names', customerName: 'customer',
    items: [
      item('P005', 'Desk Lamp'),
      item('P001', 'Historical Laptop'),
      item('P998', 'Desk Lamp'),
      item('P006', 'Desk Lamp'),
    ],
    totalPriceYen: '12800', totalWeightKg: 3.2, estimatedBoxes: 1,
  }
}

describe('AdminOrdersPage localized snapshot names', () => {
  it.each<{ language: AppLanguage; name: string }>([
    { language: 'en', name: 'Desk Lamp' },
    { language: 'ja', name: 'デスクライト' },
    { language: 'zh-CN', name: '台灯' },
  ])('localizes canonical order details in $language without changing snapshots', async ({ language, name }) => {
    const order = historicalOrder()
    const original = structuredClone(order)
    const all = vi.spyOn(orderApi, 'all').mockResolvedValue({ items: [order], total: 1 })
    const { container } = renderWithProviders(<AdminOrdersPage />, {
      language, user: { username: 'admin', role: 'ADMIN' }, route: '/admin/orders',
    })
    await screen.findByText(order.orderId)
    await userEvent.setup().click(container.querySelector('summary')!)
    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByText(`${name} · P005`)).toBeInTheDocument()
    expect(screen.getByText('Historical Laptop · P001')).toBeInTheDocument()
    expect(screen.getByText('Desk Lamp · P998')).toBeInTheDocument()
    expect(screen.getByText('Desk Lamp · P006')).toBeInTheDocument()
    expect(all).toHaveBeenCalledWith('', expect.any(AbortSignal))
    expect(order).toEqual(original)
  })

  it('updates loaded order names on language change without refetching or rewriting snapshots', async () => {
    const order = historicalOrder()
    const original = structuredClone(order)
    const all = vi.spyOn(orderApi, 'all').mockResolvedValue({ items: [order], total: 1 })
    const { container } = renderWithProviders(<><LanguageSelect /><AdminOrdersPage /></>, {
      language: 'en', user: { username: 'admin', role: 'ADMIN' }, route: '/admin/orders',
    })
    const user = userEvent.setup()
    await screen.findByText('Desk Lamp · P005')
    await user.click(container.querySelector('summary')!)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja')
    expect(screen.getByText('デスクライト · P005')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(screen.getByText('台灯 · P005')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en')
    expect(screen.getByText('Desk Lamp · P005')).toBeInTheDocument()
    expect(screen.getByText('Historical Laptop · P001')).toBeInTheDocument()
    expect(screen.getByText('Desk Lamp · P998')).toBeInTheDocument()
    expect(screen.getByText('Desk Lamp · P006')).toBeInTheDocument()
    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(all).toHaveBeenCalledTimes(1)
    expect(order).toEqual(original)
  })
})
