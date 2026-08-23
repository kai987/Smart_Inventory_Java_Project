import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import type { Order, Product } from '../api/types'
import { CART_STORAGE_KEY } from '../cart/cartTypes'
import { LanguageSelect } from '../i18n/LanguageSelect'
import type { AppLanguage } from '../i18n/language'
import { renderWithProviders } from '../test/render'
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
    expect(orderApi.create).toHaveBeenCalledWith({ items: [{ productId: 'P001', quantity: 1 }] })
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
