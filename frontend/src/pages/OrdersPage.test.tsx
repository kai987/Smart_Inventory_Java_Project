import { useQueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import type { Order, OrderList, OrderPagination, User } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { AuthContext } from '../auth/AuthProvider'
import { CART_STORAGE_KEY } from '../cart/cartTypes'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { authValue, renderWithProviders } from '../test/render'
import { CartPage } from './CartPage'
import { OrdersPage } from './OrdersPage'

function fixtures(count: number, username = 'customer'): Order[] {
  return Array.from({ length: count }, (_, index) => ({
    orderId: `O-${username}-${String(index + 1).padStart(3, '0')}`, customerName: username,
    items: [{ productId: 'P002', productName: 'Mouse', quantity: 1, unitPriceYen: '2500', unitWeightKg: 0.2, subtotalYen: '2500', totalWeightKg: 0.2 }],
    totalPriceYen: '2500', totalWeightKg: 0.2, estimatedBoxes: 1,
  }))
}
function result(items: Order[], paging?: OrderPagination): OrderList {
  return { items: paging === undefined ? items : items.slice((paging.page - 1) * paging.size, paging.page * paging.size), total: items.length }
}
function RouteProbe() { return <output aria-label="Current route">{useLocation().pathname}</output> }
function LatestNavigation() {
  const navigate = useNavigate()
  return <button onClick={() => void navigate('/orders', { state: { showLatest: true, username: 'customer' } })}>Show newly created order</button>
}
function RefreshOrders() {
  const client = useQueryClient()
  return <button onClick={() => void client.invalidateQueries({ queryKey: queryKeys.myOrdersRoot })}>Refresh saved orders</button>
}
const customer: User = { username: 'customer', role: 'CUSTOMER' }

describe('customer order pagination', () => {
  it('fetches and renders only 20 of 43 orders, with correct total and page controls', async () => {
    const items = fixtures(43)
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => Promise.resolve(result(items, paging)))
    renderWithProviders(<OrdersPage />, { user: customer, route: '/orders' })
    await screen.findByText('O-customer-001')
    expect(screen.getAllByRole('article')).toHaveLength(20)
    expect(screen.queryByText('O-customer-021')).not.toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Order pagination' }))
    expect(nav.getByRole('status')).toHaveTextContent('1–20 of 43 orders')
    expect(nav.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(nav.getByRole('button', { name: 'First page' })).toBeDisabled()
    expect(nav.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(nav.getByRole('button', { name: 'Next' })).toBeEnabled()
    expect(mine).toHaveBeenCalledWith(expect.any(AbortSignal), { page: 1, size: 20, sort: 'asc' })
  })

  it('supports next, previous, last and first without changing ascending order', async () => {
    const items = fixtures(43)
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => Promise.resolve(result(items, paging)))
    renderWithProviders(<OrdersPage />, { user: customer })
    const user = userEvent.setup()
    await screen.findByText('O-customer-001')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('O-customer-021')
    expect(screen.getAllByRole('article')).toHaveLength(20)
    expect(screen.queryByText('O-customer-001')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Last page' }))
    await screen.findByText('O-customer-043')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('O-customer-021')
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await screen.findByText('O-customer-001')
    expect(mine.mock.calls.every(([, paging]) => paging?.size === 20 && paging.sort === 'asc')).toBe(true)
  })

  it('localizes controls and total in all three languages without resetting or refetching the page', async () => {
    const items = fixtures(43)
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => Promise.resolve(result(items, paging)))
    renderWithProviders(<><LanguageSelect /><OrdersPage /></>, { user: customer })
    const user = userEvent.setup()
    await screen.findByText('O-customer-001')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('O-customer-021')
    const requests = mine.mock.calls.length
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja')
    expect(screen.getByRole('navigation', { name: '注文のページ切り替え' })).toHaveTextContent('全43件中 21–40件')
    expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled()
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(screen.getByRole('navigation', { name: '订单分页' })).toHaveTextContent('共 43 条订单，显示 21–40 条')
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(mine).toHaveBeenCalledTimes(requests)
  })

  it('shows a valid empty page with zero overall total', async () => {
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    renderWithProviders(<OrdersPage />, { user: customer })
    await screen.findByText('No orders yet')
    expect(screen.getByRole('navigation', { name: 'Order pagination' })).toHaveTextContent('0–0 of 0 orders')
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('keeps previous-page recovery available when a later page fails', async () => {
    const items = fixtures(43)
    vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => paging?.page === 2 ? Promise.reject(new Error('offline')) : Promise.resolve(result(items, paging)))
    renderWithProviders(<OrdersPage />, { user: customer })
    const user = userEvent.setup()
    await screen.findByText('O-customer-001')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('O-customer-001')
  })

  it('clamps an out-of-range page after the overall count shrinks without showing a false empty history', async () => {
    let items = fixtures(43)
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => Promise.resolve(result(items, paging)))
    renderWithProviders(<><RefreshOrders /><OrdersPage /></>, { user: customer })
    const user = userEvent.setup()
    await screen.findByText('O-customer-001')
    await user.click(screen.getByRole('button', { name: 'Last page' }))
    await screen.findByText('O-customer-043')
    items = fixtures(21)
    await user.click(screen.getByRole('button', { name: 'Refresh saved orders' }))
    await screen.findByText('O-customer-021')
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument()
    expect(mine).toHaveBeenLastCalledWith(expect.any(AbortSignal), { page: 2, size: 20, sort: 'asc' })
  })

  it('selects the latest page only once for a matching post-checkout navigation', async () => {
    const items = fixtures(43)
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => Promise.resolve(result(items, paging)))
    renderWithProviders(<><LatestNavigation /><OrdersPage /></>, { user: customer, route: '/orders' })
    const user = userEvent.setup()
    await screen.findByText('O-customer-001')
    await user.click(screen.getByRole('button', { name: 'Show newly created order' }))
    await screen.findByText('O-customer-043')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('O-customer-021')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(mine.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('shows a newly created order beyond page two while retaining the /orders URL', async () => {
    const items = fixtures(40)
    const newest = fixtures(41)[40]
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [{ id: 'P002', name: 'Mouse', priceYen: '2500', stock: 30, weightKg: 0.2, available: true }], total: 1 })
    vi.spyOn(orderApi, 'create').mockImplementation(() => { items.push(newest); return Promise.resolve(newest) })
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((_signal, paging) => Promise.resolve(result(items, paging)))
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId: 'P002', quantity: 1 }] }))
    renderWithProviders(<><Routes><Route path="/cart" element={<CartPage />} /><Route path="/orders" element={<OrdersPage />} /></Routes><RouteProbe /></>, { user: customer, route: '/cart' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Place order' }))
    await screen.findByText(newest.orderId)
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/orders')
    expect(mine.mock.calls.map(([, paging]) => paging?.page)).toEqual([1, 3])
  })

  it('cancels an old-account page and starts the next account at page one without leaking a late response', async () => {
    let active = 'alice'
    let resolveOld: (value: OrderList) => void = () => { throw new Error('Missing resolver') }
    const oldResponse = new Promise<OrderList>((resolve) => { resolveOld = resolve })
    let oldSignal: AbortSignal | undefined
    const mine = vi.spyOn(orderApi, 'mine').mockImplementation((signal, paging) => {
      if (active === 'alice' && paging?.page === 3) { oldSignal = signal; return oldResponse }
      return Promise.resolve(result(fixtures(43, active), paging))
    })
    function AccountSwitch() {
      const [user, setUser] = useState<User>({ username: 'alice', role: 'CUSTOMER' })
      return <AuthContext value={authValue(user)}><button onClick={() => { active = 'bob'; setUser({ username: 'bob', role: 'CUSTOMER' }) }}>Switch account</button><OrdersPage /></AuthContext>
    }
    renderWithProviders(<AccountSwitch />)
    const user = userEvent.setup()
    await screen.findByText('O-alice-001')
    await user.click(screen.getByRole('button', { name: 'Last page' }))
    await waitFor(() => expect(oldSignal).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Switch account' }))
    await screen.findByText('O-bob-001')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { resolveOld(result(fixtures(43, 'alice'), { page: 3, size: 20, sort: 'asc' })); await oldResponse })
    expect(screen.queryByText('O-alice-041')).not.toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(mine).toHaveBeenLastCalledWith(expect.any(AbortSignal), { page: 1, size: 20, sort: 'asc' })
  })
})
