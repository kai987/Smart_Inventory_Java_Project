import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import type { Order, Product } from '../api/types'
import { CART_STORAGE_KEY } from '../cart/cartTypes'
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

describe('CartPage', () => {
  it('clamps stored quantity to current stock', async () => {
    seedCart(5)
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    renderWithProviders(<CartPage />)
    const input = await screen.findByRole('spinbutton', { name: 'Quantity for Laptop' })
    await waitFor(() => expect(input).toHaveValue(2))
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
})
