import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Order } from '../../api/types'
import { LanguageSelect } from '../../i18n/LanguageSelect'
import type { AppLanguage } from '../../i18n/language'
import { renderWithProviders } from '../../test/render'
import { OrderCard } from './OrderCard'

function historicalOrder(): Order {
  const item = (productId: string, productName: string): Order['items'][number] => ({
    productId, productName, unitPriceYen: '120000', unitWeightKg: 3,
    quantity: 1, subtotalYen: '120000', totalWeightKg: 3,
  })
  return {
    orderId: 'O-history-names', customerName: 'customer',
    items: [
      item('P001', 'Laptop'),
      item('P005', 'Historical Desk Lamp (2025)'),
      item('P998', 'Laptop'),
      item('P006', 'Desk Lamp'),
    ],
    totalPriceYen: '480000', totalWeightKg: 12, estimatedBoxes: 2,
  }
}

function expectSnapshotName(productId: string, name: string) {
  const identity = screen.getByText(productId).parentElement!
  expect(within(identity).getByText(name, { selector: 'strong' })).toBeInTheDocument()
}

describe('OrderCard localized snapshot names', () => {
  it.each<{ language: AppLanguage; name: string; summary: string }>([
    { language: 'en', name: 'Laptop', summary: 'View item snapshots' },
    { language: 'ja', name: 'ノートパソコン', summary: '注文時の商品情報を表示' },
    { language: 'zh-CN', name: '笔记本电脑', summary: '查看下单时的商品信息' },
  ])('localizes canonical snapshots in $language without rewriting historical data', async ({ language, name, summary }) => {
    const order = historicalOrder()
    const original = structuredClone(order)
    const { container } = renderWithProviders(<OrderCard order={order} />, { language })
    await userEvent.setup().click(screen.getByText(summary))
    expect(container.querySelector('details')).toHaveAttribute('open')
    expectSnapshotName('P001', name)
    expectSnapshotName('P005', 'Historical Desk Lamp (2025)')
    expectSnapshotName('P998', 'Laptop')
    expectSnapshotName('P006', 'Desk Lamp')
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('img')).toHaveAttribute('src', '/product-images/laptop.webp')
    expect(order).toEqual(original)
  })

  it('reacts to language changes while preserving custom names, snapshots, and image identity', async () => {
    const order = historicalOrder()
    const original = structuredClone(order)
    const { container } = renderWithProviders(<><LanguageSelect /><OrderCard order={order} /></>, { language: 'en' })
    const user = userEvent.setup()
    await user.click(screen.getByText('View item snapshots'))
    expectSnapshotName('P001', 'Laptop')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja')
    expectSnapshotName('P001', 'ノートパソコン')
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expectSnapshotName('P001', '笔记本电脑')
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en')
    expectSnapshotName('P001', 'Laptop')
    expectSnapshotName('P005', 'Historical Desk Lamp (2025)')
    expectSnapshotName('P998', 'Laptop')
    expectSnapshotName('P006', 'Desk Lamp')
    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(container.querySelector('img')).toHaveAttribute('src', '/product-images/laptop.webp')
    expect(order).toEqual(original)
  })
})
