import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { adminApi } from '../api/adminApi'
import { ApiError } from '../api/apiError'
import { productApi } from '../api/productApi'
import { renderWithProviders } from '../test/render'
import AdminProductsPage from './AdminProductsPage'

async function openAndFillProduct(values: { id: string; price: string }) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  await user.type(screen.getByLabelText('Product ID'), values.id)
  await user.type(screen.getByLabelText('Name'), 'Webcam')
  await user.type(screen.getByLabelText('Price (JPY)'), values.price)
  await user.clear(screen.getByPlaceholderText('12'))
  await user.type(screen.getByPlaceholderText('12'), '12')
  await user.type(screen.getByLabelText('Weight (kg)'), '0.35')
  await user.click(screen.getAllByRole('button', { name: 'Add product' }).at(-1)!)
}

describe('AdminProductsPage', () => {
  it('validates product ID and whole-yen price', async () => {
    vi.spyOn(adminApi, 'summary').mockResolvedValue({ productCount: 0, totalStock: 0, orderCount: 0, customerCount: 0, lowStockCount: 0, lowStockThreshold: 5, inventoryValueYen: '0' })
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [], total: 0 })
    const create = vi.spyOn(productApi, 'create')
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    await screen.findByText('No products found')
    await openAndFillProduct({ id: 'BAD', price: '12.50' })
    expect(await screen.findByText('Use the format P followed by three digits.')).toBeInTheDocument()
    expect(screen.getByText('Enter a positive whole-yen amount.')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('maps API field errors back to product form controls', async () => {
    vi.spyOn(adminApi, 'summary').mockResolvedValue({ productCount: 0, totalStock: 0, orderCount: 0, customerCount: 0, lowStockCount: 0, lowStockThreshold: 5, inventoryValueYen: '0' })
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(productApi, 'create').mockRejectedValue(new ApiError({
      timestamp: '', status: 400, code: 'VALIDATION_ERROR', message: 'Validation failed.', path: '/api/products',
      fieldErrors: [{ field: 'name', message: 'Server rejected this product name.' }],
    }))
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    await screen.findByText('No products found')
    await openAndFillProduct({ id: 'P005', price: '9800' })
    expect(await screen.findByText('Server rejected this product name.')).toBeInTheDocument()
  })
})
