import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import type { Order, Product } from '../api/types'
import { CART_STORAGE_KEY } from '../cart/cartTypes'
import { useCart } from '../cart/CartProvider'
import { getPendingCheckoutKey } from '../cart/checkoutIntent'
import { LanguageSelect } from '../i18n/LanguageSelect'
import type { AppLanguage } from '../i18n/language'
import { authValue, renderWithProviders } from '../test/render'
import { CartPage } from './CartPage'

const laptop: Product = { id: 'P001', name: 'Laptop', priceYen: '120000', stock: 2, weightKg: 3, available: true }
const savedOrder: Order = {
  orderId: 'Od-test',
  customerName: 'customer',
  items: [{ productId: 'P001', productName: 'Laptop', unitPriceYen: '120000', unitWeightKg: 3, quantity: 1, subtotalYen: '120000', totalWeightKg: 3 }],
  totalPriceYen: '120000',
  totalWeightKg: 3,
  estimatedBoxes: 1,
}

function seedCart(quantity: number) {
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId: 'P001', quantity }] }))
}

function storedQuantity() {
  const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '{}') as { items?: { quantity: number }[] }
  return stored.items?.[0]?.quantity
}

describe('CartPage', () => {
  it('clamps stored quantity to current stock', async () => {
    seedCart(5)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    const { container } = renderWithProviders(<CartPage />)
    const input = await screen.findByRole('spinbutton', { name: 'Quantity for Laptop' })
    await waitFor(() => expect(input).toHaveValue(2))
    expect(container.querySelector('img')).toHaveAttribute('src', '/product-images/laptop.webp')
    expect(await screen.findByText(/adjusted to the available stock/i)).toBeInTheDocument()
  })

  it('clears the cart after a successful order', async () => {
    seedCart(1)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    vi.spyOn(orderApi, 'create').mockResolvedValue(savedOrder)
    renderWithProviders(<CartPage />, { user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Place order' }))
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument()
    expect(orderApi.create).toHaveBeenCalledWith({ items: [{ productId: 'P001', quantity: 1 }] }, expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/), expect.any(AbortSignal))
  })

  it('freezes checkout controls and preserves additions during an in-flight order', async () => {
    seedCart(1)
    let resolveOrder: (order: Order) => void = () => { throw new Error('Missing resolver') }
    const pendingOrder = new Promise<Order>((resolve) => { resolveOrder = resolve })
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    vi.spyOn(orderApi, 'create').mockReturnValue(pendingOrder)
    function AddElsewhere() {
      const { dispatch } = useCart()
      return <button onClick={() => dispatch({ type: 'add', productId: 'P001' })}>Add elsewhere</button>
    }
    renderWithProviders(<><AddElsewhere /><CartPage /></>, { user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Place order' }))
    expect(screen.getByRole('spinbutton', { name: 'Quantity for Laptop' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Laptop' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add elsewhere' }))
    await act(async () => { resolveOrder(savedOrder); await pendingOrder })
    await waitFor(() => expect(storedQuantity()).toBe(1))
    expect(orderApi.create).toHaveBeenCalledWith({ items: [{ productId: 'P001', quantity: 1 }] }, expect.any(String), expect.any(AbortSignal))
  })

  it('reuses the persisted idempotency key after a network failure and page remount', async () => {
    seedCart(1)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    const create = vi.spyOn(orderApi, 'create').mockRejectedValue(new Error('Network unavailable'))
    const user = userEvent.setup()
    const first = renderWithProviders(<CartPage />, { user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    await user.click(await screen.findByRole('button', { name: 'Place order' }))
    await screen.findByRole('alert')
    const key = create.mock.calls[0]?.[1]
    first.unmount()
    renderWithProviders(<CartPage />, { user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    await user.click(await screen.findByRole('button', { name: 'Place order' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1]?.[1]).toBe(key)
  })

  it('can replay an unchanged failed attempt even if its order already exhausted stock', async () => {
    seedCart(2)
    const list = vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    const create = vi.spyOn(orderApi, 'create').mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue(savedOrder)
    const first = renderWithProviders(<CartPage />, { user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Place order' }))
    await screen.findByRole('alert')
    list.mockResolvedValue({ items: [{ ...laptop, stock: 0, available: false }], total: 1 })
    const key = create.mock.calls[0]?.[1]
    first.unmount()
    renderWithProviders(<CartPage />, { user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    expect(await screen.findByRole('spinbutton', { name: 'Quantity for Laptop' })).toHaveValue(2)
    expect(screen.getByRole('spinbutton', { name: 'Quantity for Laptop' })).toBeDisabled()
    const retry = await screen.findByRole('button', { name: 'Place order' })
    expect(retry).toBeEnabled()
    await user.click(retry)
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument()
    expect(create.mock.calls[1]?.[1]).toBe(key)
    expect(create.mock.calls[1]?.[0].items).toEqual([{ productId: 'P001', quantity: 2 }])
  })

  it('ignores a delayed success after the authenticated session changes', async () => {
    seedCart(1)
    let resolveOrder: (order: Order) => void = () => { throw new Error('Missing resolver') }
    const pendingOrder = new Promise<Order>((resolve) => { resolveOrder = resolve })
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    vi.spyOn(orderApi, 'create').mockReturnValue(pendingOrder)
    const isCurrentSession = vi.fn().mockReturnValue(true)
    renderWithProviders(<CartPage />, {
      auth: authValue({ username: 'customer', role: 'CUSTOMER' }, { isCurrentSession }), route: '/cart',
    })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Place order' }))
    const key = vi.mocked(orderApi.create).mock.calls[0]?.[1]
    isCurrentSession.mockReturnValue(false)
    await act(async () => { resolveOrder(savedOrder); await pendingOrder })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled())
    expect(storedQuantity()).toBe(1)
    expect(getPendingCheckoutKey('customer', [{ productId: 'P001', quantity: 1 }])).toBe(key)
    expect(screen.queryByText('Order placed successfully.')).not.toBeInTheDocument()
  })

  it.each<{ language: AppLanguage; inputName: string; error: string }>([
    { language: 'en', inputName: 'Quantity for Laptop', error: 'Enter a whole number greater than zero.' },
    { language: 'ja', inputName: 'Laptopの数量', error: '1以上の整数を入力してください。' },
    { language: 'zh-CN', inputName: 'Laptop 的数量', error: '请输入大于 0 的整数。' },
  ])('rejects invalid quantity without changing the cart in $language', async ({ language, inputName, error }) => {
    seedCart(1)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    renderWithProviders(<CartPage />, { language })
    const input = await screen.findByRole('spinbutton', { name: inputName })

    for (const invalidValue of ['', '0', '-1', '1.5']) {
      fireEvent.change(input, { target: { value: invalidValue } })
      expect(screen.getByRole('alert')).toHaveTextContent(error)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
      await waitFor(() => expect(storedQuantity()).toBe(1))
    }

    fireEvent.change(input, { target: { value: '2' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).toHaveValue(2)
    await waitFor(() => expect(storedQuantity()).toBe(2))
  })

  it('updates an active quantity error when the language changes', async () => {
    seedCart(1)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    renderWithProviders(<><LanguageSelect /><CartPage /></>, { language: 'ja' })
    const user = userEvent.setup()
    const input = await screen.findByRole('spinbutton', { name: 'Laptopの数量' })

    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('1以上の整数を入力してください。')
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入大于 0 的整数。')
    expect(screen.queryByText('1以上の整数を入力してください。')).not.toBeInTheDocument()
    expect(storedQuantity()).toBe(1)
  })
})
