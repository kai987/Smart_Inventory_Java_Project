import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Product } from '../api/types'
import { productApi } from '../api/productApi'
import { useCart } from '../cart/CartProvider'
import { renderWithProviders } from '../test/render'
import { ProductsPage } from './ProductsPage'

const laptop: Product = { id: 'P001', name: 'Laptop', priceYen: '120000', stock: 8, weightKg: 3, available: true }

function CartCount() {
  const { itemCount } = useCart()
  return <output aria-label="Test cart count">{itemCount}</output>
}

describe('ProductsPage', () => {
  it('shows a loading skeleton', () => {
    vi.spyOn(productApi, 'list').mockReturnValue(new Promise(() => undefined))
    renderWithProviders(<ProductsPage />)
    expect(screen.getByLabelText('Loading content')).toBeInTheDocument()
  })

  it('shows an API error with a retry action', async () => {
    vi.spyOn(productApi, 'list').mockRejectedValue(new Error('offline'))
    renderWithProviders(<ProductsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Product data is unavailable.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('shows the empty state', async () => {
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [], total: 0 })
    renderWithProviders(<ProductsPage />)
    expect(await screen.findByText('No products found')).toBeInTheDocument()
  })

  it('adds a product and updates the cart count', async () => {
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    renderWithProviders(<><ProductsPage /><CartCount /></>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add to cart' }))
    expect(screen.getByLabelText('Test cart count')).toHaveTextContent('1')
  })
})
