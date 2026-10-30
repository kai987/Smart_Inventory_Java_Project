import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { adminApi } from '../api/adminApi'
import { ApiError } from '../api/apiError'
import { productApi } from '../api/productApi'
import type { Product } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { authValue, renderWithProviders } from '../test/render'
import AdminProductsPage from './AdminProductsPage'

const laptop = { id: 'P001', name: 'Laptop', priceYen: '120000', stock: 8, weightKg: 3, available: true }
const lamp: Product = { id: 'P005', name: 'Desk Lamp', priceYen: '3600', stock: 24, weightKg: 0.8, available: true }
const customProduct: Product = { id: 'P900', name: 'Handmade Cup（私物）', priceYen: '2600', stock: 3, weightKg: 0.3, available: true }

const languageCases = [
  { language: 'en', laptopName: 'Laptop', lampName: 'Desk Lamp', updateLamp: 'Update stock for Desk Lamp', deleteLamp: 'Delete Desk Lamp', stockTitle: 'Update stock', identity: 'Desk Lamp, P005', question: 'Delete Desk Lamp (P005)?', cancel: 'Cancel' },
  { language: 'ja', laptopName: 'ノートパソコン', lampName: 'デスクライト', updateLamp: 'デスクライトの在庫を更新', deleteLamp: 'デスクライトを削除', stockTitle: '在庫を更新', identity: 'デスクライト、P005', question: 'デスクライト（P005）を削除しますか？', cancel: 'キャンセル' },
  { language: 'zh-CN', laptopName: '笔记本电脑', lampName: '台灯', updateLamp: '更新 台灯 的库存', deleteLamp: '删除 台灯', stockTitle: '更新库存', identity: '台灯，P005', question: '删除 台灯（P005）？', cancel: '取消' },
] as const

function mockCatalog(items: Product[] = [laptop, lamp, customProduct]) {
  vi.spyOn(adminApi, 'summary').mockResolvedValue({
    productCount: items.length, totalStock: items.reduce((total, item) => total + item.stock, 0),
    orderCount: 0, customerCount: 0, lowStockCount: 1, lowStockThreshold: 5, inventoryValueYen: '0',
  })
  return vi.spyOn(productApi, 'list').mockResolvedValue({ items, total: items.length })
}

function CaptureQueryClient({ capture }: { capture: (client: QueryClient) => void }) {
  capture(useQueryClient())
  return null
}

async function openAndFillProduct(values: { id: string; price: string }) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  await user.type(screen.getByLabelText('Product ID'), values.id)
  await user.type(screen.getByLabelText('English name (required)'), 'Webcam')
  await user.type(screen.getByLabelText('Price (JPY)'), values.price)
  await user.clear(screen.getByPlaceholderText('12'))
  await user.type(screen.getByPlaceholderText('12'), '12')
  await user.type(screen.getByLabelText('Weight (kg)'), '0.35')
  await user.click(screen.getAllByRole('button', { name: 'Add product' }).at(-1)!)
}

describe('AdminProductsPage', () => {
  it.each(languageCases)('shows $language demo names in rows, actions, stock identity, and delete confirmation', async (labels) => {
    mockCatalog()
    renderWithProviders(<AdminProductsPage />, { language: labels.language, user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    expect(await screen.findByRole('cell', { name: labels.laptopName })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: labels.lampName })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: customProduct.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.deleteLamp })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: labels.updateLamp }))
    const stockDialog = screen.getByRole('dialog', { name: labels.stockTitle })
    expect(stockDialog).toHaveAccessibleDescription(labels.identity)
    await user.click(within(stockDialog).getByRole('button', { name: labels.cancel }))

    await user.click(screen.getByRole('button', { name: labels.deleteLamp }))
    expect(screen.getByText(labels.question)).toBeInTheDocument()
    expect(lamp.name).toBe('Desk Lamp')
    expect(customProduct.name).toBe('Handmade Cup（私物）')
  })

  it('searches IDs and English, Japanese, and Chinese names without sending translated filters to the API', async () => {
    const list = mockCatalog()
    const captured: { client?: QueryClient } = {}
    renderWithProviders(<><CaptureQueryClient capture={(client) => { captured.client = client }} /><LanguageSelect /><AdminProductsPage /></>, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByRole('cell', { name: 'Laptop' })
    const search = screen.getByRole('searchbox', { name: 'Search products' })

    for (const query of ['p005', 'lAmP', '台灯', 'デスクライト']) {
      await user.clear(search)
      await user.type(search, query)
      await waitFor(() => {
        expect(screen.getByRole('cell', { name: 'Desk Lamp' })).toBeInTheDocument()
        expect(screen.queryByRole('cell', { name: 'Laptop' })).not.toBeInTheDocument()
        expect(screen.queryByRole('cell', { name: customProduct.name })).not.toBeInTheDocument()
      })
    }

    await user.selectOptions(screen.getByRole('combobox'), 'ja')
    expect(await screen.findByRole('cell', { name: 'デスクライト' })).toBeInTheDocument()
    expect(search).toHaveValue('デスクライト')
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN')
    expect(await screen.findByRole('cell', { name: '台灯' })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ q: '', inStockOnly: false }, expect.any(AbortSignal))
    expect(lamp).toMatchObject({ id: 'P005', name: 'Desk Lamp', stock: 24 })
    expect(captured.client?.getQueryData(queryKeys.products({ q: '', inStockOnly: false }))).toEqual({
      items: [laptop, lamp, customProduct], total: 3,
    })
  })

  it('keeps custom products and reused IDs in their original names and does not apply demo search aliases', async () => {
    const renamedLamp = { ...lamp, name: 'Workshop Fixture' }
    mockCatalog([renamedLamp, customProduct])
    renderWithProviders(<AdminProductsPage />, { language: 'ja', user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    expect(await screen.findByRole('cell', { name: 'Workshop Fixture' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: customProduct.name })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'デスクライト' })).not.toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: '商品を検索' })
    await user.type(search, '台灯')
    expect(await screen.findByText('商品が見つかりません')).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'wOrKsHoP')
    expect(await screen.findByRole('cell', { name: 'Workshop Fixture' })).toBeInTheDocument()
  })

  it('updates an open stock dialog on language changes without overwriting the stock draft or its real mutation ID', async () => {
    mockCatalog([lamp])
    const updateStock = vi.spyOn(productApi, 'updateStock').mockResolvedValue({ ...lamp, stock: 19 })
    renderWithProviders(<><LanguageSelect /><AdminProductsPage /></>, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Update stock for Desk Lamp' }))
    const stock = within(screen.getByRole('dialog', { name: 'Update stock' })).getByLabelText('Stock')
    await user.clear(stock)
    await user.type(stock, '19')

    await user.selectOptions(screen.getByRole('combobox'), 'ja')
    const japaneseDialog = screen.getByRole('dialog', { name: '在庫を更新' })
    expect(japaneseDialog).toHaveAccessibleDescription('デスクライト、P005')
    expect(within(japaneseDialog).getByLabelText('在庫')).toHaveValue('19')
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN')
    const chineseDialog = screen.getByRole('dialog', { name: '更新库存' })
    expect(chineseDialog).toHaveAccessibleDescription('台灯，P005')
    expect(within(chineseDialog).getByLabelText('库存')).toHaveValue('19')
    await user.click(within(chineseDialog).getByRole('button', { name: '保存库存' }))
    await waitFor(() => expect(updateStock).toHaveBeenCalledWith('P005', 19, expect.any(AbortSignal)))
    expect(lamp).toMatchObject({ id: 'P005', name: 'Desk Lamp', stock: 24 })
  })

  it('updates an open delete confirmation on language changes and deletes only the original product ID', async () => {
    mockCatalog([lamp])
    const remove = vi.spyOn(productApi, 'remove').mockResolvedValue()
    renderWithProviders(<><LanguageSelect /><AdminProductsPage /></>, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete Desk Lamp' }))
    expect(screen.getByText('Delete Desk Lamp (P005)?')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN')
    expect(screen.getByText('删除 台灯（P005）？')).toBeInTheDocument()
    expect(screen.queryByText('Delete Desk Lamp (P005)?')).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog', { name: '删除商品？' })).getByRole('button', { name: '删除商品' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('P005', expect.any(AbortSignal)))
  })

  it('preserves the user-entered product name and business values when adding from a translated interface', async () => {
    mockCatalog([])
    const created = { id: 'P900', name: '私のランプ / 手工台灯', priceYen: '2600', stock: 28, weightKg: 0.3, available: true }
    const create = vi.spyOn(productApi, 'create').mockResolvedValue(created)
    renderWithProviders(<AdminProductsPage />, { language: 'ja', user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByText('商品が見つかりません')
    await user.click(screen.getByRole('button', { name: '商品を追加' }))
    const dialog = screen.getByRole('dialog', { name: '商品を追加' })
    await user.type(within(dialog).getByLabelText('商品 ID'), created.id)
    await user.type(within(dialog).getByLabelText('英語名（必須）'), created.name)
    await user.type(within(dialog).getByLabelText('価格（JPY）'), created.priceYen)
    await user.clear(within(dialog).getByLabelText('在庫'))
    await user.type(within(dialog).getByLabelText('在庫'), '28')
    await user.type(within(dialog).getByLabelText('重量（kg）'), '0.3')
    await user.click(within(dialog).getByRole('button', { name: '商品を追加' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      id: 'P900', name: '私のランプ / 手工台灯', priceYen: '2600', stock: 28, weightKg: 0.3,
    }, expect.any(AbortSignal)))
  })

  it('creates custom products with all three names and preserves drafts when language changes', async () => {
    mockCatalog([])
    const created = { ...customProduct, name: 'Ceramic Mug', nameJa: '陶器マグ', nameZh: '陶瓷马克杯' }
    const create = vi.spyOn(productApi, 'create').mockResolvedValue(created)
    renderWithProviders(<><LanguageSelect /><AdminProductsPage /></>, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await screen.findByText('No products found')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    const dialog = screen.getByRole('dialog', { name: 'Add product' })
    await user.type(within(dialog).getByLabelText('Product ID'), 'P900')
    await user.type(within(dialog).getByLabelText('English name (required)'), ' Ceramic Mug ')
    await user.type(within(dialog).getByLabelText('Japanese name (optional)'), ' 陶器マグ ')
    await user.type(within(dialog).getByLabelText('Chinese name (optional)'), ' 陶瓷马克杯 ')
    await user.type(within(dialog).getByLabelText('Price (JPY)'), '2600')
    await user.type(within(dialog).getByLabelText('Weight (kg)'), '0.3')
    await user.selectOptions(screen.getByRole('combobox'), 'ja')
    const japaneseDialog = screen.getByRole('dialog', { name: '商品を追加' })
    expect(within(japaneseDialog).getByLabelText('日本語名（任意）')).toHaveValue(' 陶器マグ ')
    expect(within(japaneseDialog).getByLabelText('中国語名（任意）')).toHaveValue(' 陶瓷马克杯 ')
    await user.click(within(japaneseDialog).getByRole('button', { name: '商品を追加' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      id: 'P900', name: 'Ceramic Mug', nameJa: '陶器マグ', nameZh: '陶瓷马克杯', priceYen: '2600', stock: 0, weightKg: 0.3,
    }, expect.any(AbortSignal)))
  })

  it('edits saved multilingual names without touching stock, price, or old order snapshots', async () => {
    const translated = { ...customProduct, name: 'Ceramic Mug', nameJa: '陶器マグ', nameZh: '陶瓷马克杯' }
    mockCatalog([translated])
    const update = vi.spyOn(productApi, 'updateNames').mockResolvedValue({ ...translated, nameZh: '手工陶瓷杯' })
    renderWithProviders(<><LanguageSelect /><AdminProductsPage /></>, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit names for Ceramic Mug' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit product names' })
    expect(within(dialog).getByLabelText('Japanese name (optional)')).toHaveValue('陶器マグ')
    await user.clear(within(dialog).getByLabelText('Chinese name (optional)'))
    await user.type(within(dialog).getByLabelText('Chinese name (optional)'), '手工陶瓷杯')
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN')
    const chineseDialog = screen.getByRole('dialog', { name: '编辑商品名称' })
    expect(within(chineseDialog).getByLabelText('中文名称（选填）')).toHaveValue('手工陶瓷杯')
    expect(screen.getByRole('cell', { name: '陶瓷马克杯' })).toBeInTheDocument()
    await user.click(within(chineseDialog).getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('P900', {
      name: 'Ceramic Mug', nameJa: '陶器マグ', nameZh: '手工陶瓷杯',
    }, expect.any(AbortSignal)))
    expect(translated).toMatchObject({ stock: 3, priceYen: '2600', nameZh: '陶瓷马克杯' })
  })

  it('validates optional translations and can clear a saved translation', async () => {
    const translated = { ...customProduct, nameJa: '陶器マグ', nameZh: '陶瓷马克杯' }
    mockCatalog([translated])
    const update = vi.spyOn(productApi, 'updateNames').mockResolvedValue(customProduct)
    renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: `Edit names for ${customProduct.name}` }))
    const dialog = screen.getByRole('dialog', { name: 'Edit product names' })
    const japanese = within(dialog).getByLabelText('Japanese name (optional)')
    await user.clear(japanese)
    await user.type(japanese, 'Invalid|Name')
    await user.click(within(dialog).getByRole('button', { name: 'Save names' }))
    expect(await within(dialog).findByText('Name contains a reserved character.')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    await user.clear(japanese)
    await user.click(within(dialog).getByRole('button', { name: 'Save names' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('P900', {
      name: customProduct.name, nameJa: '', nameZh: '陶瓷马克杯',
    }, expect.any(AbortSignal)))
  })

  it('ignores delayed product creation after the admin session changes', async () => {
    vi.spyOn(adminApi, 'summary').mockResolvedValue({ productCount: 0, totalStock: 0, orderCount: 0, customerCount: 0, lowStockCount: 0, lowStockThreshold: 5, inventoryValueYen: '0' })
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [], total: 0 })
    let resolveCreation: (value: typeof laptop) => void = () => { throw new Error('Missing resolver') }
    const pending = new Promise<typeof laptop>((resolve) => { resolveCreation = resolve })
    vi.spyOn(productApi, 'create').mockReturnValue(pending)
    const isCurrentSession = vi.fn().mockReturnValue(true)
    renderWithProviders(<AdminProductsPage />, { auth: authValue({ username: 'admin', role: 'ADMIN' }, { isCurrentSession }) })
    await screen.findByText('No products found')
    await openAndFillProduct({ id: 'P005', price: '9800' })
    isCurrentSession.mockReturnValue(false)
    await act(async () => { resolveCreation(laptop); await pending })
    expect(screen.queryByText('Product added.')).not.toBeInTheDocument()
    expect(productApi.list).toHaveBeenCalledTimes(1)
    expect(adminApi.summary).toHaveBeenCalledTimes(1)
  })
  it('renders the mapped local product thumbnail in the table', async () => {
    vi.spyOn(adminApi, 'summary').mockResolvedValue({ productCount: 1, totalStock: 8, orderCount: 0, customerCount: 0, lowStockCount: 0, lowStockThreshold: 5, inventoryValueYen: '960000' })
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    const { container } = renderWithProviders(<AdminProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    expect(await screen.findByRole('cell', { name: 'Laptop' })).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/product-images/laptop.webp')
  })

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
    expect(await screen.findByText('Enter a valid product name.')).toBeInTheDocument()
  })
})
