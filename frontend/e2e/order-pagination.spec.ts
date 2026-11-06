import { expect, test, type Page } from '@playwright/test'
import type { Order } from '../src/api/types.js'

function fixtures(count: number): Order[] {
  return Array.from({ length: count }, (_, index) => ({
    orderId: `O-pagination-${String(index + 1).padStart(3, '0')}`,
    customerName: index < 21 ? 'alice' : 'bob',
    items: [{ productId: 'P002', productName: 'Mouse', quantity: 1, unitPriceYen: '2500', unitWeightKg: 0.2, subtotalYen: '2500', totalWeightKg: 0.2 }],
    totalPriceYen: '2500', totalWeightKg: 0.2, estimatedBoxes: 1,
  }))
}
async function login(page: Page, role: 'Customer' | 'Admin') {
  await page.goto('/login')
  await page.getByRole('button', { name: `Fill ${role} Demo`, exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(role === 'Admin' ? /\/admin$/ : /\/products$/)
}
type PagingRequest = { page: number; size: number; sort: string; customer: string }
function requested(url: string): PagingRequest {
  const search = new URL(url).searchParams
  return { page: Number(search.get('page')), size: Number(search.get('size')), sort: search.get('sort') ?? '', customer: search.get('customer') ?? '' }
}
function pageResponse(items: Order[], request: PagingRequest) {
  const filtered = items.filter((order) => order.customerName.includes(request.customer))
  const sorted = request.sort === 'desc' ? [...filtered].reverse() : filtered
  return { items: sorted.slice((request.page - 1) * request.size, request.page * request.size), total: filtered.length }
}

test('43 route-fixtured customer orders paginate in three languages and fit a mobile viewport', async ({ page }) => {
  const items = fixtures(43)
  const requests: PagingRequest[] = []
  await page.route(/\/api\/orders\/me(?:\?|$)/, async (route) => {
    const request = requested(route.request().url()); requests.push(request)
    await route.fulfill({ status: 200, json: pageResponse(items, request) })
  })
  await login(page, 'Customer')
  await page.getByRole('link', { name: 'My orders', exact: true }).click()
  await expect(page.getByText('O-pagination-001', { exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(20)
  await expect(page.getByRole('navigation', { name: 'Order pagination' })).toContainText('1–20 of 43 orders')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('O-pagination-021', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Last page', exact: true }).click()
  await expect(page.getByText('O-pagination-043', { exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  const beforeLanguageChange = requests.length
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja')
  await expect(page.getByRole('navigation', { name: '注文のページ切り替え' })).toContainText('全43件中 41–43件')
  await page.getByRole('combobox', { name: '言語', exact: true }).selectOption('zh-CN')
  await expect(page.getByRole('navigation', { name: '订单分页' })).toContainText('共 43 条订单，显示 41–43 条')
  expect(requests).toHaveLength(beforeLanguageChange)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  await page.getByRole('button', { name: '第一页', exact: true }).click()
  await expect(page.getByText('O-pagination-001', { exact: true })).toBeVisible()
  expect(requests.every((request) => request.size === 20 && request.sort === 'asc')).toBe(true)
})

test('admin route-fixtured totals reset with filters, and dashboard requests descending five only', async ({ page }) => {
  const items = fixtures(43)
  const requests: PagingRequest[] = []
  await page.route(/\/api\/orders(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    const request = requested(route.request().url()); requests.push(request)
    await route.fulfill({ status: 200, json: pageResponse(items, request) })
  })
  await login(page, 'Admin')
  await expect(page.getByText('O-pagination-043', { exact: true })).toBeVisible()
  expect(requests.some((request) => request.page === 1 && request.size === 5 && request.sort === 'desc')).toBe(true)
  await page.getByRole('link', { name: 'Orders', exact: true }).click()
  await expect(page.locator('main details')).toHaveCount(20)
  await page.getByRole('button', { name: 'Last page', exact: true }).click()
  await expect(page.getByText('O-pagination-043', { exact: true })).toBeVisible()
  const filter = page.getByRole('searchbox')
  await filter.fill('alice')
  await expect(page.getByRole('navigation', { name: 'Order pagination' })).toContainText('1–20 of 21 orders')
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible()
  await filter.fill('not-a-customer')
  await expect(page.getByRole('navigation', { name: 'Order pagination' })).toContainText('0–0 of 0 orders')
  await expect(page.locator('main details')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})

test('a route-fixtured failed later page can be retried without losing page selection', async ({ page }) => {
  let failSecondPage = true
  const items = fixtures(43)
  await page.route(/\/api\/orders\/me(?:\?|$)/, async (route) => {
    const request = requested(route.request().url())
    if (request.page === 2 && failSecondPage) await route.fulfill({ status: 503, json: { code: 'SERVER_ERROR', message: 'Fixture unavailable' } })
    else await route.fulfill({ status: 200, json: pageResponse(items, request) })
  })
  await login(page, 'Customer')
  await page.getByRole('link', { name: 'My orders', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled()
  failSecondPage = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('O-pagination-021', { exact: true })).toBeVisible()
  await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible()
})

test('route-fixtured checkout beyond forty saved orders navigates to its ascending last page', async ({ page }) => {
  const items = fixtures(40).map((order) => ({ ...order, customerName: 'customer' }))
  const newest = { ...fixtures(41)[40], customerName: 'customer' }
  const requestedPages: number[] = []
  let creates = 0
  await page.route(/\/api\/orders\/me(?:\?|$)/, async (route) => {
    const request = requested(route.request().url()); requestedPages.push(request.page)
    await route.fulfill({ status: 200, json: pageResponse(items, request) })
  })
  await page.route(/\/api\/orders(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    creates += 1; items.push(newest)
    await route.fulfill({ status: 201, json: newest }) // No server-side order or stock mutation.
  })
  await login(page, 'Customer')
  await page.getByRole('article').filter({ has: page.getByText('P002', { exact: true }) }).getByRole('button', { name: 'Add to cart', exact: true }).click()
  await page.getByRole('link', { name: /Cart 1/ }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByText(newest.orderId, { exact: true })).toBeVisible()
  await expect(page.getByText('Page 3 of 3', { exact: true })).toBeVisible()
  expect(requestedPages).toEqual([1, 3])
  expect(creates).toBe(1)
})
