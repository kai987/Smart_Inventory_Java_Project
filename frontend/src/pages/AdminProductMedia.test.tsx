import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '../api/adminApi'
import { productApi } from '../api/productApi'
import type { Product } from '../api/types'
import { authValue, renderWithProviders } from '../test/render'
import AdminProductsPage from './AdminProductsPage'

const NativeURL = URL
const imageUrl = '/api/product-images/12345678-1234-1234-1234-123456789abc.png'
const customProduct: Product = { id: 'P900', name: 'Handmade Cup', nameJa: '手作りカップ', nameZh: '手工杯', category: 'kitchen', imageUrl, priceYen: '2600', stock: 3, weightKg: 0.3, available: true }
const createObjectURL = vi.fn(() => 'blob:local-product-preview')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
})
afterEach(() => { vi.unstubAllGlobals() })

function mockCatalog(items: Product[] = []) {
  vi.spyOn(adminApi, 'summary').mockResolvedValue({
    productCount: items.length, totalStock: 3, orderCount: 0, customerCount: 0,
    lowStockCount: 1, lowStockThreshold: 5, inventoryValueYen: '7800',
  })
  return vi.spyOn(productApi, 'list').mockResolvedValue({ items, total: items.length })
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  const dialog = screen.getByRole('dialog', { name: 'Add product' })
  await user.type(within(dialog).getByLabelText('Product ID'), 'P900')
  await user.type(within(dialog).getByLabelText('English name (required)'), 'Handmade Cup')
  await user.type(within(dialog).getByLabelText('Price (JPY)'), '2600')
  await user.type(within(dialog).getByLabelText('Weight (kg)'), '0.3')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Category' }), 'kitchen')
  return dialog
}

describe('administrator product images and categories', () => {
  it('previews a selected image without uploading and discards it on cancel', async () => {
    mockCatalog()
    const upload = vi.spyOn(productApi, 'uploadImage')
    const create = vi.spyOn(productApi, 'create')
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByText('No products found')
    const dialog = await fillCreateForm(user)
    await user.upload(within(dialog).getByLabelText('Product image'), new File(['png'], 'cup.png', { type: 'image/png' }))
    expect(within(dialog).getByRole('img', { name: 'Selected product image preview' })).toHaveAttribute('src', 'blob:local-product-preview')
    expect(upload).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-product-preview')
    expect(create).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    expect(within(screen.getByRole('dialog', { name: 'Add product' })).queryByRole('img')).not.toBeInTheDocument()
  })

  it('uploads only on submit, sends the selected category, and reuses its URL when JSON saving is retried', async () => {
    mockCatalog()
    const upload = vi.spyOn(productApi, 'uploadImage').mockResolvedValue({ imageUrl })
    const create = vi.spyOn(productApi, 'create').mockRejectedValueOnce(new Error('Save unavailable')).mockResolvedValue(customProduct)
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByText('No products found')
    const dialog = await fillCreateForm(user)
    const file = new File(['png'], 'cup.png', { type: 'image/png' })
    await user.upload(within(dialog).getByLabelText('Product image'), file)
    expect(upload).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
    await within(dialog).findByRole('alert')
    expect(upload).toHaveBeenCalledWith(file, expect.any(AbortSignal))
    expect(create).toHaveBeenCalledWith({ id: 'P900', name: 'Handmade Cup', category: 'kitchen', imageUrl, priceYen: '2600', stock: 0, weightKg: 0.3 }, expect.any(AbortSignal))
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[1]?.[0].imageUrl).toBe(imageUrl)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-product-preview')
  })

  it('surfaces an upload failure and never sends the product JSON afterward', async () => {
    mockCatalog()
    vi.spyOn(productApi, 'uploadImage').mockRejectedValue(new Error('Upload unavailable'))
    const create = vi.spyOn(productApi, 'create')
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByText('No products found')
    const dialog = await fillCreateForm(user)
    await user.upload(within(dialog).getByLabelText('Product image'), new File(['png'], 'cup.png', { type: 'image/png' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(create).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('img', { name: 'Selected product image preview' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Add product' })).toBeEnabled()
  })

  it('shows invalid-file feedback and prevents upload until the invalid selection is removed', async () => {
    mockCatalog()
    const upload = vi.spyOn(productApi, 'uploadImage')
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup({ applyAccept: false })
    await screen.findByText('No products found')
    const dialog = await fillCreateForm(user)
    await user.upload(within(dialog).getByLabelText('Product image'), new File(['svg'], 'cup.svg', { type: 'image/svg+xml' }))
    expect(within(dialog).getByText('Choose a valid PNG, JPEG or WebP image.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Add product' })).toBeDisabled()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Remove image' }))
    expect(within(dialog).queryByText('Choose a valid PNG, JPEG or WebP image.')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add product' })).toBeEnabled()
  })

  it('edits the category and removes only the custom image without changing stock or price', async () => {
    mockCatalog([customProduct])
    const update = vi.spyOn(productApi, 'updateDetails').mockResolvedValue({ ...customProduct, category: 'home' })
    const upload = vi.spyOn(productApi, 'uploadImage')
    const { container } = renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit details for Handmade Cup' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit product details' })
    expect(within(dialog).getByRole('combobox', { name: 'Category' })).toHaveValue('kitchen')
    expect(within(dialog).getByRole('img', { name: 'Selected product image preview' })).toHaveAttribute('src', imageUrl)
    expect(container.querySelector('table img')).toHaveAttribute('src', imageUrl)
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Category' }), 'home')
    await user.click(within(dialog).getByRole('button', { name: 'Remove image' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('P900', { name: 'Handmade Cup', nameJa: '手作りカップ', nameZh: '手工杯', category: 'home', imageUrl: null }, expect.any(AbortSignal)))
    expect(upload).not.toHaveBeenCalled()
    expect(customProduct).toMatchObject({ stock: 3, priceYen: '2600', imageUrl })
  })

  it('does not save or refresh products if the session changes during image upload', async () => {
    const list = mockCatalog()
    let resolveUpload: (value: { imageUrl: string }) => void = () => { throw new Error('Missing upload resolver') }
    const upload = new Promise<{ imageUrl: string }>((resolve) => { resolveUpload = resolve })
    vi.spyOn(productApi, 'uploadImage').mockReturnValue(upload)
    const create = vi.spyOn(productApi, 'create')
    const isCurrentSession = vi.fn().mockReturnValue(true)
    renderWithProviders(<AdminProductsPage />, { auth: authValue({ username: 'admin', role: 'ADMIN' }, { isCurrentSession }) })
    const user = userEvent.setup()
    await screen.findByText('No products found')
    const dialog = await fillCreateForm(user)
    await user.upload(within(dialog).getByLabelText('Product image'), new File(['png'], 'cup.png', { type: 'image/png' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
    expect(within(dialog).getByRole('button', { name: 'Uploading image…' })).toBeDisabled()
    isCurrentSession.mockReturnValue(false)
    await act(async () => { resolveUpload({ imageUrl }); await upload })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Add product' })).toBeEnabled())
    expect(create).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Product added.')).not.toBeInTheDocument()
  })
})
