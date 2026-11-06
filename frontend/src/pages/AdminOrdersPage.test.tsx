import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { orderApi } from '../api/orderApi'
import { useState } from 'react'
import type { Order, OrderList, OrderPagination, User } from '../api/types'
import { AuthContext } from '../auth/AuthProvider'
import { LanguageSelect } from '../i18n/LanguageSelect'
import type { AppLanguage } from '../i18n/language'
import { authValue, renderWithProviders } from '../test/render'
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
    expect(all).toHaveBeenCalledWith('', expect.any(AbortSignal), { page: 1, size: 20, sort: 'asc' })
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

function pagedAdminOrders(customer: string, paging?: OrderPagination): OrderList {
  const all = Array.from({ length: 43 }, (_, index) => ({
    ...historicalOrder(), orderId: `O-admin-${String(index + 1).padStart(3, '0')}`,
    customerName: index < 21 ? 'alice' : 'bob', items: historicalOrder().items.slice(0, 1),
  })).filter((order) => order.customerName.includes(customer))
  return { items: paging === undefined ? all : all.slice((paging.page - 1) * paging.size, paging.page * paging.size), total: all.length }
}

describe('admin order pagination', () => {
  it('resets to page one when the customer filter changes and reports the filtered overall total', async () => {
    const all = vi.spyOn(orderApi, 'all').mockImplementation((customer = '', _signal, paging) => Promise.resolve(pagedAdminOrders(customer, paging)))
    const { container } = renderWithProviders(<AdminOrdersPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByText('O-admin-001')
    expect(container.querySelectorAll('details')).toHaveLength(20)
    await user.click(screen.getByRole('button', { name: 'Last page' }))
    await screen.findByText('O-admin-043')
    expect(container.querySelectorAll('details')).toHaveLength(3)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alice' } })
    await screen.findByText('O-admin-001')
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Order pagination' })).toHaveTextContent('1–20 of 21 orders')
    expect(all).toHaveBeenLastCalledWith('alice', expect.any(AbortSignal), { page: 1, size: 20, sort: 'asc' })
  })

  it('resets both filter and page when the administrator identity changes', async () => {
    const all = vi.spyOn(orderApi, 'all').mockImplementation((customer = '', _signal, paging) => Promise.resolve(pagedAdminOrders(customer, paging)))
    function SwitchAdmin() {
      const [user, setUser] = useState<User>({ username: 'admin-a', role: 'ADMIN' })
      return <AuthContext value={authValue(user)}><button onClick={() => setUser({ username: 'admin-b', role: 'ADMIN' })}>Switch administrator</button><AdminOrdersPage /></AuthContext>
    }
    renderWithProviders(<SwitchAdmin />)
    const user = userEvent.setup()
    await screen.findByText('O-admin-001')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bob' } })
    await screen.findByText('O-admin-022')
    await user.click(screen.getByRole('button', { name: 'Last page' }))
    await screen.findByText('O-admin-043')
    await user.click(screen.getByRole('button', { name: 'Switch administrator' }))
    await screen.findByText('O-admin-001')
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(all).toHaveBeenLastCalledWith('', expect.any(AbortSignal), { page: 1, size: 20, sort: 'asc' })
  })

  it('aborts an old filter request and never displays its late response under a new filter', async () => {
    let resolveOld: (value: OrderList) => void = () => { throw new Error('Missing resolver') }
    const pending = new Promise<OrderList>((resolve) => { resolveOld = resolve })
    let oldSignal: AbortSignal | undefined
    vi.spyOn(orderApi, 'all').mockImplementation((customer = '', signal, paging) => {
      if (customer === 'alice') { oldSignal = signal; return pending }
      return Promise.resolve(pagedAdminOrders(customer, paging))
    })
    renderWithProviders(<AdminOrdersPage />, { user: { username: 'admin', role: 'ADMIN' } })
    await screen.findByText('O-admin-001')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alice' } })
    await waitFor(() => expect(oldSignal).toBeDefined())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bob' } })
    await screen.findByText('O-admin-022')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { resolveOld({ items: [{ ...historicalOrder(), orderId: 'O-private-late-alice' }], total: 1 }); await pending })
    expect(screen.queryByText('O-private-late-alice')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Order pagination' })).toHaveTextContent('1–20 of 22 orders')
  })

  it('handles an empty filtered result without inventing another page', async () => {
    vi.spyOn(orderApi, 'all').mockResolvedValue({ items: [], total: 0 })
    renderWithProviders(<AdminOrdersPage />, { user: { username: 'admin', role: 'ADMIN' } })
    await screen.findByRole('navigation', { name: 'Order pagination' })
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Order pagination' })).toHaveTextContent('0–0 of 0 orders'))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('retains a retry action after a page error', async () => {
    const all = vi.spyOn(orderApi, 'all').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(pagedAdminOrders('', { page: 1, size: 20, sort: 'asc' }))
    renderWithProviders(<AdminOrdersPage />, { user: { username: 'admin', role: 'ADMIN' } })
    await screen.findByRole('alert')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('O-admin-001')
    expect(all).toHaveBeenLastCalledWith('', expect.any(AbortSignal), { page: 1, size: 20, sort: 'asc' })
  })
})
