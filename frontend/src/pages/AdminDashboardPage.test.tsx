import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { adminApi } from '../api/adminApi'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import type { Product } from '../api/types'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { renderWithProviders } from '../test/render'
import AdminDashboardPage from './AdminDashboardPage'

const laptop: Product = { id: 'P001', name: 'Laptop', priceYen: '120000', stock: 2, weightKg: 3, available: true }
const lamp: Product = { id: 'P005', name: 'Desk Lamp', priceYen: '3600', stock: 4, weightKg: 0.8, available: true }
const custom: Product = { id: 'P900', name: '手作りカップ / Handmade cup', priceYen: '2600', stock: 1, weightKg: 0.3, available: true }
const reusedId: Product = { id: 'P006', name: 'Custom Robot Planter', priceYen: '1800', stock: 3, weightKg: 0.5, available: true }
const mouse: Product = { id: 'P002', name: 'Mouse', priceYen: '2500', stock: 20, weightKg: 0.2, available: true }

const languageCases = [
  { language: 'en', heading: 'Low-stock products', laptopName: 'Laptop', lampName: 'Desk Lamp', stockLeft: '2 left' },
  { language: 'ja', heading: '在庫の少ない商品', laptopName: 'ノートパソコン', lampName: 'デスクライト', stockLeft: '残り 2' },
  { language: 'zh-CN', heading: '低库存商品', laptopName: '笔记本电脑', lampName: '台灯', stockLeft: '剩余 2' },
] as const

function mockDashboard() {
  const summary = vi.spyOn(adminApi, 'summary').mockResolvedValue({
    productCount: 5, totalStock: 30, orderCount: 0, customerCount: 0,
    lowStockCount: 4, lowStockThreshold: 5, inventoryValueYen: '0',
  })
  const products = vi.spyOn(productApi, 'list').mockResolvedValue({
    items: [laptop, lamp, custom, reusedId, mouse], total: 5,
  })
  const orders = vi.spyOn(orderApi, 'all').mockResolvedValue({ items: [], total: 0 })
  return { summary, products, orders }
}

describe('AdminDashboardPage product names', () => {
  it.each(languageCases)('shows $language names in low stock while preserving custom names and IDs', async (labels) => {
    mockDashboard()
    renderWithProviders(<AdminDashboardPage />, { language: labels.language, user: { username: 'admin', role: 'ADMIN' } })
    const heading = await screen.findByRole('heading', { name: labels.heading })
    const panel = within(heading.closest('section')!)
    expect(panel.getByText(labels.laptopName)).toBeInTheDocument()
    expect(panel.getByText(labels.lampName)).toBeInTheDocument()
    expect(panel.getByText(custom.name)).toBeInTheDocument()
    expect(panel.getByText(reusedId.name)).toBeInTheDocument()
    expect(panel.getByText('P001')).toBeInTheDocument()
    expect(panel.getByText('P005')).toBeInTheDocument()
    expect(panel.getByText('P006')).toBeInTheDocument()
    expect(panel.getByText(labels.stockLeft)).toBeInTheDocument()
    expect(panel.queryByText('P002')).not.toBeInTheDocument()
    expect(laptop).toMatchObject({ id: 'P001', name: 'Laptop', stock: 2 })
  })

  it('reacts to runtime language changes without refetching or rewriting the inventory', async () => {
    const { summary, products, orders } = mockDashboard()
    renderWithProviders(<><LanguageSelect /><AdminDashboardPage /></>, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
    for (const labels of [languageCases[1], languageCases[2], languageCases[0]]) {
      await user.selectOptions(screen.getByRole('combobox'), labels.language)
      const heading = await screen.findByRole('heading', { name: labels.heading })
      const panel = within(heading.closest('section')!)
      expect(panel.getByText(labels.laptopName)).toBeInTheDocument()
      expect(panel.getByText(labels.lampName)).toBeInTheDocument()
      expect(panel.getByText(custom.name)).toBeInTheDocument()
      expect(panel.getByText(reusedId.name)).toBeInTheDocument()
      expect(panel.getByText(labels.stockLeft)).toBeInTheDocument()
    }
    expect(summary).toHaveBeenCalledTimes(1)
    expect(products).toHaveBeenCalledTimes(1)
    expect(orders).toHaveBeenCalledTimes(1)
    expect(products).toHaveBeenCalledWith({ q: '', inStockOnly: false }, expect.any(AbortSignal))
    expect(laptop).toMatchObject({ id: 'P001', name: 'Laptop', stock: 2 })
    expect(lamp).toMatchObject({ id: 'P005', name: 'Desk Lamp', stock: 4 })
  })
})
