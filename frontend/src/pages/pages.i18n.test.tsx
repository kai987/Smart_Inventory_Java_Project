import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '../api/adminApi'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import type { Order, Product } from '../api/types'
import { renderWithProviders } from '../test/render'
import AdminDashboardPage from './AdminDashboardPage'
import AdminOrdersPage from './AdminOrdersPage'
import AdminProductsPage from './AdminProductsPage'
import { CartPage } from './CartPage'
import { ForbiddenPage } from './ForbiddenPage'
import { LoginPage } from './LoginPage'
import { NotFoundPage } from './NotFoundPage'
import { OrdersPage } from './OrdersPage'
import { ProductsPage } from './ProductsPage'
import { RegisterPage } from './RegisterPage'

const laptop: Product = {
  id: 'P001',
  name: 'Laptop',
  priceYen: '120000',
  stock: 8,
  weightKg: 3,
  available: true,
}

const savedOrder: Order = {
  orderId: 'O123456',
  customerName: 'customer',
  items: [{
    productId: 'P001',
    productName: 'Laptop',
    unitPriceYen: '120000',
    unitWeightKg: 3,
    quantity: 1,
    subtotalYen: '120000',
    totalWeightKg: 3,
  }],
  totalPriceYen: '120000',
  totalWeightKg: 3,
  estimatedBoxes: 1,
}

const languageCases = [
  {
    language: 'ja',
    labels: {
      products: '商品一覧',
      addToCart: 'カートに追加',
      login: 'おかえりなさい',
      signIn: 'ログイン',
      register: 'アカウント作成',
      createAccount: 'アカウントを作成',
      cart: 'カート',
      browseProducts: '商品を見る',
      orders: '注文履歴',
      dashboard: '在庫概要',
      productsAdmin: '商品管理',
      addProduct: '商品を追加',
      productId: '商品 ID',
      ordersAdmin: '注文管理',
      orderId: '注文 ID',
      forbidden: 'アクセスできません',
      notFound: 'ページが見つかりません',
      returnToProducts: '商品一覧に戻る',
    },
  },
  {
    language: 'zh-CN',
    labels: {
      products: '商品列表',
      addToCart: '加入购物车',
      login: '欢迎回来',
      signIn: '登录',
      register: '创建账户',
      createAccount: '创建账户',
      cart: '购物车',
      browseProducts: '浏览商品',
      orders: '我的订单',
      dashboard: '库存概览',
      productsAdmin: '商品管理',
      addProduct: '添加商品',
      productId: '商品 ID',
      ordersAdmin: '订单管理',
      orderId: '订单 ID',
      forbidden: '访问被拒绝',
      notFound: '未找到页面',
      returnToProducts: '返回商品列表',
    },
  },
] as const

describe.each(languageCases)('$language page localization', ({ language, labels }) => {
  beforeEach(() => {
    vi.spyOn(productApi, 'list').mockResolvedValue({ items: [laptop], total: 1 })
    vi.spyOn(orderApi, 'mine').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(orderApi, 'all').mockResolvedValue({ items: [savedOrder], total: 1 })
    vi.spyOn(adminApi, 'summary').mockResolvedValue({
      productCount: 1,
      totalStock: 8,
      orderCount: 1,
      customerCount: 1,
      lowStockCount: 0,
      lowStockThreshold: 5,
      inventoryValueYen: '960000',
    })
  })

  it('localizes the products page', async () => {
    renderWithProviders(<ProductsPage />, { language })
    expect(screen.getByRole('heading', { name: labels.products })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: labels.addToCart })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
  })

  it('localizes the login page', () => {
    renderWithProviders(<LoginPage />, { language })
    expect(screen.getByRole('heading', { name: labels.login })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.signIn })).toBeInTheDocument()
  })

  it('localizes the registration page', () => {
    renderWithProviders(<RegisterPage />, { language })
    expect(screen.getByRole('heading', { name: labels.register })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.createAccount })).toBeInTheDocument()
  })

  it('localizes the cart page', () => {
    renderWithProviders(<CartPage />, { language })
    expect(screen.getByRole('heading', { name: labels.cart })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.browseProducts })).toBeInTheDocument()
  })

  it('localizes the customer orders page', async () => {
    renderWithProviders(<OrdersPage />, { language, user: { username: 'customer', role: 'CUSTOMER' } })
    expect(screen.getByRole('heading', { name: labels.orders })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: labels.browseProducts })).toBeInTheDocument()
  })

  it('localizes the admin dashboard', async () => {
    renderWithProviders(<AdminDashboardPage />, { language, user: { username: 'admin', role: 'ADMIN' } })
    expect(await screen.findByRole('heading', { name: labels.dashboard })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Inventory overview' })).not.toBeInTheDocument()
  })

  it('localizes admin product controls and table headings', async () => {
    renderWithProviders(<AdminProductsPage />, { language, user: { username: 'admin', role: 'ADMIN' } })
    expect(screen.getByRole('heading', { name: labels.productsAdmin })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.addProduct })).toBeInTheDocument()
    expect(await screen.findByRole('columnheader', { name: labels.productId })).toBeInTheDocument()
  })

  it('localizes admin orders and order labels', async () => {
    renderWithProviders(<AdminOrdersPage />, { language, user: { username: 'admin', role: 'ADMIN' } })
    expect(screen.getByRole('heading', { name: labels.ordersAdmin })).toBeInTheDocument()
    expect(await screen.findByText(labels.orderId)).toBeInTheDocument()
  })

  it('localizes the forbidden page', () => {
    renderWithProviders(<ForbiddenPage />, { language })
    expect(screen.getByRole('heading', { name: labels.forbidden })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.returnToProducts })).toBeInTheDocument()
  })

  it('localizes the not-found page', () => {
    renderWithProviders(<NotFoundPage />, { language })
    expect(screen.getByRole('heading', { name: labels.notFound })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.returnToProducts })).toBeInTheDocument()
  })
})
