import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Product } from '../api/types'
import { productApi } from '../api/productApi'
import { useCart } from '../cart/CartProvider'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { renderWithProviders } from '../test/render'
import { ProductsPage } from './ProductsPage'

const laptop: Product = { id: 'P001', name: 'Laptop', priceYen: '120000', stock: 8, weightKg: 3, available: true }
const lamp: Product = { id: 'P005', name: 'Desk Lamp', priceYen: '3600', stock: 12, weightKg: 0.8, available: true }
const customProduct: Product = { id: 'CUSTOM-1', name: 'Custom product with a complete, descriptive name', priceYen: '1500', stock: 0, weightKg: 0.4, available: true }

function CartCount() {
  const { itemCount, state } = useCart()
  return <>
    <output aria-label="Test cart count">{itemCount}</output>
    <output aria-label="Test cart product IDs">{state.items.map((item) => item.productId).join(',')}</output>
  </>
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
    const { container } = renderWithProviders(<><ProductsPage /><CartCount /></>)
    const user = userEvent.setup()
    const addButton = await screen.findByRole('button', { name: 'Add to cart' })
    expect(container.querySelector('img')).toHaveAttribute('src', '/product-images/laptop.webp')
    await user.click(addButton)
    expect(screen.getByLabelText('Test cart count')).toHaveTextContent('1')
    expect(addButton).toHaveTextContent('Added')
  })

  it('filters by category, reports result counts, and puts custom products in Other', async () => {
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop, lamp, customProduct], total: 3 })
    renderWithProviders(<ProductsPage />)
    const user = userEvent.setup()
    expect(await screen.findByText('3 products')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Desk Lamp' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Laptop' })).not.toBeInTheDocument()
    expect(screen.getByText('1 product')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Other' }))
    expect(screen.getByRole('heading', { name: customProduct.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Desk Lamp' })).not.toBeInTheDocument()
  })

  it('sorts both price directions without losing large integer precision', async () => {
    const items = [{ ...laptop, priceYen: '9007199254740993' }, { ...lamp, priceYen: '9007199254740992' }]
    vi.spyOn(productApi, 'list').mockResolvedValue({ items, total: 2 })
    renderWithProviders(<ProductsPage />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Laptop' })
    const names = () => screen.getAllByRole('article').map((article) => within(article).getByRole('heading', { level: 2 }).textContent)
    await user.selectOptions(screen.getByLabelText('Sort by'), 'priceAsc')
    expect(names()).toEqual(['Desk Lamp', 'Laptop'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'priceDesc')
    expect(names()).toEqual(['Laptop', 'Desk Lamp'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'default')
    expect(names()).toEqual(['Laptop', 'Desk Lamp'])
  })

  it('combines category, search, and stock filters, and resets every control from the empty state', async () => {
    const items = [laptop, lamp, customProduct]
    const list = vi.spyOn(productApi, 'list').mockResolvedValue({ items, total: items.length })
    renderWithProviders(<ProductsPage />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Laptop' })
    await user.click(screen.getByRole('button', { name: 'Home' }))
    await user.click(screen.getByRole('checkbox', { name: 'In stock only' }))
    await user.selectOptions(screen.getByLabelText('Sort by'), 'priceDesc')
    await user.type(screen.getByRole('searchbox', { name: 'Search by ID or name' }), 'LAPTOP')
    expect(await screen.findByText('No products found')).toBeInTheDocument()
    expect(screen.getByText('0 products')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: 'In stock only' })).not.toBeChecked()
    expect(screen.getByLabelText('Sort by')).toHaveValue('default')
    expect(screen.getByRole('button', { name: 'All products' })).toHaveAttribute('aria-pressed', 'true')
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ q: '', inStockOnly: false }, expect.any(AbortSignal))
  })

  it.each([
    { language: 'en', name: 'Laptop', category: 'Electronics', sort: 'Sort by', reset: 'Reset filters', credits: 'Image credits' },
    { language: 'ja', name: 'ノートパソコン', category: '電子機器', sort: '並び順', reset: '条件をリセット', credits: '画像の出典' },
    { language: 'zh-CN', name: '笔记本电脑', category: '电子产品', sort: '排序方式', reset: '重置筛选', credits: '图片来源' },
  ] as const)('localizes standard product names and catalog controls in $language', async ({ language, name, category, sort, reset, credits }) => {
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop, customProduct], total: 2 })
    renderWithProviders(<ProductsPage />, { language })
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: customProduct.name })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: category }))
    expect(screen.getByLabelText(sort)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: reset })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: credits })).toHaveAttribute('href', '/product-images/CREDITS.md')
    expect(screen.getByRole('link', { name: credits })).toHaveAttribute('rel', 'noreferrer')
  })

  it.each(['笔记本', 'ノートパソ', 'LAP', 'ｐ００１'])('finds products with multilingual fuzzy query %s in the English interface', async (query) => {
    const list = vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop, lamp], total: 2 })
    renderWithProviders(<ProductsPage />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Laptop' })
    await user.type(screen.getByRole('searchbox'), query)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'Laptop' })).toBeInTheDocument()
    expect(screen.getByText('1 product')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('changes displayed names and add-to-cart feedback without changing original data, filters, images, or cart IDs', async () => {
    const items = [Object.freeze({ ...laptop }), Object.freeze({ ...lamp })]
    const list = vi.spyOn(productApi, 'list').mockResolvedValue({ items, total: 2 })
    const { container } = renderWithProviders(<><LanguageSelect /><ProductsPage /><CartCount /></>)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Desk Lamp' })
    await user.type(screen.getByRole('searchbox'), '台灯')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja')
    expect(await screen.findByRole('heading', { name: 'デスクライト' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('台灯')
    expect(container.querySelector('article img')).toHaveAttribute('src', '/product-images/desk-lamp.webp')
    await user.click(screen.getByRole('button', { name: 'カートに追加' }))
    expect(screen.getByText('デスクライトをカートに追加しました。')).toBeInTheDocument()
    expect(screen.getByLabelText('Test cart product IDs')).toHaveTextContent('P005')

    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(await screen.findByRole('heading', { name: '台灯' })).toBeInTheDocument()
    expect(screen.getByText('已将 台灯 加入购物车。')).toBeInTheDocument()
    expect(screen.queryByText('デスクライトをカートに追加しました。')).not.toBeInTheDocument()
    expect(container.querySelector('article img')).toHaveAttribute('src', '/product-images/desk-lamp.webp')
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en')
    expect(await screen.findByRole('heading', { name: 'Desk Lamp' })).toBeInTheDocument()
    expect(screen.getByText('Desk Lamp added to your cart.')).toBeInTheDocument()
    expect(screen.queryByText('已将 台灯 加入购物车。')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('台灯')
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ q: '', inStockOnly: false }, expect.any(AbortSignal))
    expect(items.map((item) => ({ id: item.id, name: item.name }))).toEqual([{ id: 'P001', name: 'Laptop' }, { id: 'P005', name: 'Desk Lamp' }])
  })

  it('searches and switches custom product names, including live cart feedback, without reloading products', async () => {
    const custom = Object.freeze({ ...lamp, id: 'P910', name: 'Ceramic Cup', nameJa: '陶器カップ', nameZh: '陶瓷杯' })
    const list = vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop, custom], total: 2 })
    const { container } = renderWithProviders(<><LanguageSelect /><ProductsPage /><CartCount /></>)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Ceramic Cup' })
    await user.type(screen.getByRole('searchbox'), '陶瓷')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja')
    expect(screen.getByRole('heading', { name: '陶器カップ' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'カートに追加' }))
    expect(screen.getByText('陶器カップをカートに追加しました。')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'zh-CN')
    expect(screen.getByRole('heading', { name: '陶瓷杯' })).toBeInTheDocument()
    expect(screen.getByText('已将 陶瓷杯 加入购物车。')).toBeInTheDocument()
    expect(screen.getByLabelText('Test cart product IDs')).toHaveTextContent('P910')
    expect(screen.getByRole('searchbox')).toHaveValue('陶瓷')
    expect(container.querySelector('article img')).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en')
    expect(screen.getByRole('heading', { name: 'Ceramic Cup' })).toBeInTheDocument()
    expect(screen.getByText('Ceramic Cup added to your cart.')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(1)
    expect(custom.name).toBe('Ceramic Cup')
  })

  it('preserves the administrator read-only catalog experience', async () => {
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    renderWithProviders(<ProductsPage />, { user: { username: 'admin', role: 'ADMIN' } })
    expect(await screen.findByRole('heading', { name: 'Laptop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument()
  })
})
