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
  it.each<{ language: AppLanguage; name: string; inputName: string; removeName: string; adjustment: string }>([
    { language: 'en', name: 'Laptop', inputName: 'Quantity for Laptop', removeName: 'Remove Laptop', adjustment: 'Laptop was adjusted to the available stock (2).' },
    { language: 'ja', name: 'ノートパソコン', inputName: 'ノートパソコンの数量', removeName: 'ノートパソコンを削除', adjustment: 'ノートパソコンの数量を在庫数（2）に調整しました。' },
    { language: 'zh-CN', name: '笔记本电脑', inputName: '笔记本电脑 的数量', removeName: '移除 笔记本电脑', adjustment: '已将 笔记本电脑 的数量调整为可用库存（2）。' },
  ])('localizes names and stock adjustment controls in $language without changing product identity', async ({ language, name, inputName, removeName, adjustment }) => {
    seedCart(5)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    const { container } = renderWithProviders(<CartPage />, { language })
    const input = await screen.findByRole('spinbutton', { name: inputName })
    await waitFor(() => expect(input).toHaveValue(2))
    expect(screen.getByText(name, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: removeName })).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/product-images/laptop.webp')
    expect(await screen.findByText(adjustment)).toBeInTheDocument()
    expect(laptop.name).toBe('Laptop')
  })

  it.each<{ language: AppLanguage; buttonName: string; emptyTitle: string }>([
    { language: 'en', buttonName: 'Place order', emptyTitle: 'Your cart is empty' },
    { language: 'ja', buttonName: '注文を確定', emptyTitle: 'カートは空です' },
    { language: 'zh-CN', buttonName: '提交订单', emptyTitle: '购物车为空' },
  ])('submits the unchanged checkout payload and clears the cart in $language', async ({ language, buttonName, emptyTitle }) => {
    seedCart(1)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    vi.spyOn(orderApi, 'create').mockResolvedValue(savedOrder)
    renderWithProviders(<CartPage />, { language, user: { username: 'customer', role: 'CUSTOMER' }, route: '/cart' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: buttonName }))
    expect(await screen.findByText(emptyTitle)).toBeInTheDocument()
    expect(orderApi.create).toHaveBeenCalledWith({ items: [{ productId: 'P001', quantity: 1 }] }, expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/), expect.any(AbortSignal))
    expect(savedOrder.items[0]?.productName).toBe('Laptop')
    expect(laptop.name).toBe('Laptop')
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
    { language: 'ja', inputName: 'ノートパソコンの数量', error: '1以上の整数を入力してください。' },
    { language: 'zh-CN', inputName: '笔记本电脑 的数量', error: '请输入大于 0 的整数。' },
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

  it('updates names, accessible controls, and an active quantity error at runtime without changing cart data', async () => {
    seedCart(1)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    renderWithProviders(<><LanguageSelect /><CartPage /></>, { language: 'ja' })
    const user = userEvent.setup()
    const input = await screen.findByRole('spinbutton', { name: 'ノートパソコンの数量' })
    const originalCart = window.localStorage.getItem(CART_STORAGE_KEY)

    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('1以上の整数を入力してください。')
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入大于 0 的整数。')
    expect(screen.getByText('笔记本电脑', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '笔记本电脑 的数量' })).toBe(input)
    expect(screen.getByRole('button', { name: '移除 笔记本电脑' })).toBeInTheDocument()
    expect(screen.queryByText('1以上の整数を入力してください。')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en')
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number greater than zero.')
    expect(screen.getByText('Laptop', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Quantity for Laptop' })).toBe(input)
    expect(screen.getByRole('button', { name: 'Remove Laptop' })).toBeInTheDocument()
    expect(storedQuantity()).toBe(1)
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(originalCart)
    expect(laptop.name).toBe('Laptop')
  })

  it('keeps renamed and unknown cart products unchanged instead of applying demo translations', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [
      { productId: 'P001', quantity: 1 }, { productId: 'P999', quantity: 1 },
    ] }))
    const renamed = { ...laptop, name: 'Custom Warehouse Laptop' }
    const unknown = { ...laptop, id: 'P999' }
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [renamed, unknown], total: 2 })
    const { container } = renderWithProviders(<CartPage />, { language: 'ja' })
    expect(await screen.findByRole('spinbutton', { name: 'Custom Warehouse Laptopの数量' })).toHaveValue(1)
    expect(screen.getByRole('button', { name: 'Custom Warehouse Laptopを削除' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Laptopの数量' })).toHaveValue(1)
    expect(screen.getByText('Custom Warehouse Laptop', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Laptop', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText('ノートパソコン', { selector: 'strong' })).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(renamed.name).toBe('Custom Warehouse Laptop')
    expect(unknown.name).toBe('Laptop')
  })

  it('switches custom names and quantity/remove controls while retaining the cart and quantity draft', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId: 'P910', quantity: 1 }] }))
    const custom = Object.freeze({ ...laptop, id: 'P910', name: 'Ceramic Cup', nameJa: '陶器カップ', nameZh: '陶瓷杯' })
    const list = vi.spyOn(productApi, 'list').mockResolvedValue({ items: [custom], total: 1 })
    renderWithProviders(<><LanguageSelect /><CartPage /></>)
    const user = userEvent.setup()
    const input = await screen.findByRole('spinbutton', { name: 'Quantity for Ceramic Cup' })
    const originalCart = window.localStorage.getItem(CART_STORAGE_KEY)
    fireEvent.change(input, { target: { value: '' } })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja')
    expect(screen.getByText('陶器カップ', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '陶器カップの数量' })).toBe(input)
    expect(screen.getByRole('button', { name: '陶器カップを削除' })).toBeInTheDocument()
    expect(input).toHaveValue(null)
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(screen.getByText('陶瓷杯', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '陶瓷杯 的数量' })).toBe(input)
    expect(screen.getByRole('button', { name: '移除 陶瓷杯' })).toBeInTheDocument()
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(originalCart)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('uses the uploaded custom product image without changing cart identity or totals', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId: 'P900', quantity: 1 }] }))
    const imageUrl = '/api/product-images/12345678-1234-1234-1234-123456789abc.jpg'
    const custom: Product = { ...laptop, id: 'P900', name: 'Custom Cup', imageUrl }
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [custom], total: 1 })
    const { container } = renderWithProviders(<CartPage />)
    expect(await screen.findByRole('spinbutton', { name: 'Quantity for Custom Cup' })).toHaveValue(1)
    expect(container.querySelector('article img')).toHaveAttribute('src', imageUrl)
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toContain('P900')
    expect(screen.getAllByText('¥120,000')).toHaveLength(2)
  })
})
