import { expect, test, type Page } from '@playwright/test'
import type { OrderList, ProductList } from '../src/api/types.js'

test.use({ locale: 'en-US', colorScheme: 'light' })

function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function mouseCard(page: Page) {
  return page.getByRole('article').filter({ has: page.getByText('P002', { exact: true }) })
}

for (const storageFailure of ['SecurityError getter', 'QuotaExceededError writes'] as const) {
  test(`cart, language and theme remain usable with localStorage ${storageFailure}`, async ({ page }) => {
    const pageErrors = collectPageErrors(page)
    await page.addInitScript((failure) => {
      if (failure === 'SecurityError getter') {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          get() { throw new DOMException('Storage access is denied', 'SecurityError') },
        })
      } else {
        Object.defineProperty(Storage.prototype, 'setItem', {
          configurable: true,
          value() { throw new DOMException('Storage quota is exhausted', 'QuotaExceededError') },
        })
      }
    }, storageFailure)

    await page.goto('/products')
    await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible()
    await expect(mouseCard(page).getByRole('heading', { name: 'Mouse', exact: true })).toBeVisible()
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    await mouseCard(page).getByRole('button', { name: 'Add to cart', exact: true }).click()
    await page.getByRole('link', { name: /Cart 1/ }).click()
    await expect(page.getByRole('heading', { name: 'Your cart', exact: true })).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'Quantity for Mouse', exact: true })).toHaveValue('1')
    await page.getByRole('button', { name: 'Increase quantity', exact: true }).click()
    await expect(page.getByRole('spinbutton', { name: 'Quantity for Mouse', exact: true })).toHaveValue('2')
    await expect(page.getByRole('link', { name: /Cart 2/ })).toBeVisible()

    // These changes must work in memory even though neither can be persisted.
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.getByRole('heading', { name: 'カート', exact: true })).toBeVisible()
    await expect(page.getByRole('spinbutton')).toHaveValue('2')
    await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('combobox', { name: '言語', exact: true }).selectOption('en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('button', { name: 'Remove Mouse', exact: true }).click()
    await expect(page.getByText('Your cart is empty', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Cart 0/ })).toBeVisible()
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })
}

test('a real checkout timeout keeps its key in memory when sessionStorage writes exceed quota', async ({ page }) => {
  test.setTimeout(60_000)
  const pageErrors = collectPageErrors(page)
  await page.addInitScript(() => {
    const originalSetItem = Reflect.get(Storage.prototype, 'setItem')
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value(this: Storage, key: string, value: string) {
        if (this === globalThis.sessionStorage) {
          throw new DOMException('Session storage quota is exhausted', 'QuotaExceededError')
        }
        originalSetItem.call(this, key, value)
      },
    })
  })

  await page.goto('/login')
  await page.getByRole('button', { name: 'Fill Customer Demo', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
  const beforeOrdersResponse = await page.request.get('/api/orders/me')
  expect(beforeOrdersResponse.status()).toBe(200)
  const beforeOrders = await beforeOrdersResponse.json() as OrderList
  const beforeProductsResponse = await page.request.get('/api/products?q=P002')
  expect(beforeProductsResponse.status()).toBe(200)
  const beforeProducts = await beforeProductsResponse.json() as ProductList
  const stockBefore = beforeProducts.items.find((product) => product.id === 'P002')?.stock
  if (stockBefore === undefined) throw new Error('The isolated catalog must contain P002')
  expect(stockBefore).toBeGreaterThan(0)

  await mouseCard(page).getByRole('button', { name: 'Add to cart', exact: true }).click()
  await page.getByRole('link', { name: /Cart 1/ }).click()
  const quantity = page.getByRole('spinbutton', { name: 'Quantity for Mouse', exact: true })
  await expect(quantity).toHaveValue('1')

  const keys: string[] = []
  let releaseResponse: () => void = () => { throw new Error('Response gate not initialized') }
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
  let firstResponseFetched = false
  let firstResponseFinished = false
  let timedOut = false
  let createdOrderId = ''
  let firstPostStartedAt = 0
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    keys.push(route.request().headers()['idempotency-key'])
    if (keys.length !== 1) {
      await route.continue()
      return
    }

    firstPostStartedAt = Date.now()
    try {
      // Commit the real isolated-server order, but do not deliver its response
      // until the real 15-second Axios/XHR timeout has occurred in the browser.
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      const body = await response.json() as { orderId: string }
      createdOrderId = body.orderId
      firstResponseFetched = true
      await responseGate
      try {
        await route.fulfill({ response })
      } catch (error) {
        // Chromium may reject a response to the already-aborted original XHR.
        if (!timedOut) throw error
      }
    } finally {
      firstResponseFinished = true
    }
  })

  try {
    await page.getByRole('button', { name: 'Place order', exact: true }).click()
    await expect.poll(() => firstResponseFetched).toBe(true)
    await expect(quantity).toBeDisabled()
    await expect(page.getByRole('alert')).toHaveText('The server took too long to respond. Please try again.', { timeout: 20_000 })
    timedOut = true
    expect(Date.now() - firstPostStartedAt).toBeGreaterThanOrEqual(14_000)
    await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeEnabled()
    await expect(quantity).toBeEnabled()
    await expect(quantity).toHaveValue('1')
    await expect(page.getByRole('link', { name: /Cart 1/ })).toBeVisible()
    await expect(page.getByText('An earlier attempt may already be saved. Retry to check its result without creating a duplicate order.', { exact: true })).toBeVisible()
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(await page.evaluate(() => globalThis.sessionStorage.getItem('smart-inventory-checkout:v1:customer'))).toBeNull()
    const storedCart = await page.evaluate(() => globalThis.localStorage.getItem('smart-inventory-cart:v2'))
    expect(storedCart).not.toBeNull()
    expect(JSON.parse(storedCart ?? 'null')).toMatchObject({ version: 2, items: [{ productId: 'P002', quantity: 1 }] })

    // There must be no automatic POST retry. Only this deliberate click may
    // replay the ambiguous attempt, with its original in-memory key.
    await page.getByRole('button', { name: 'Place order', exact: true }).click()
    await expect(page).toHaveURL(/\/orders$/)
    await expect(page.getByText(createdOrderId, { exact: true })).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    await expect(page.getByRole('link', { name: /Cart 0/ })).toBeVisible()

    // A late response must not consume a fresh cart item a second time or
    // navigate away from the cart after the explicit replay already succeeded.
    await page.getByRole('link', { name: 'Products', exact: true }).click()
    await mouseCard(page).getByRole('button', { name: 'Add to cart', exact: true }).click()
    await page.getByRole('link', { name: /Cart 1/ }).click()
    releaseResponse()
    await expect.poll(() => firstResponseFinished).toBe(true)
    await expect(page).toHaveURL(/\/cart$/)
    await expect(page.getByRole('spinbutton', { name: 'Quantity for Mouse', exact: true })).toHaveValue('1')
    await expect(page.getByRole('link', { name: /Cart 1/ })).toBeVisible()

    const afterOrdersResponse = await page.request.get('/api/orders/me')
    expect(afterOrdersResponse.status()).toBe(200)
    const afterOrders = await afterOrdersResponse.json() as OrderList
    expect(afterOrders.total).toBe(beforeOrders.total + 1)
    const afterProductsResponse = await page.request.get('/api/products?q=P002')
    expect(afterProductsResponse.status()).toBe(200)
    const afterProducts = await afterProductsResponse.json() as ProductList
    expect(afterProducts.items.find((product) => product.id === 'P002')?.stock).toBe(stockBefore - 1)
    expect(keys).toHaveLength(2)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    releaseResponse()
  }
})
