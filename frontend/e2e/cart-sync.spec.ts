import { expect, test, type Page } from '@playwright/test'

function product(page: Page, id: string) {
  return page.getByRole('article').filter({ has: page.getByText(id, { exact: true }) })
}
async function add(page: Page, id: string) {
  await product(page, id).getByRole('button', { name: 'Add to cart', exact: true }).click()
}
async function login(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Fill Customer Demo', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
}

test('Web Locks preserve simultaneous same-product and different-product additions in two tabs', async ({ page, context }) => {
  await page.goto('/products')
  const other = await context.newPage()
  await other.goto('/products')
  expect(await page.evaluate(() => typeof navigator.locks.request)).toBe('function')
  await Promise.all([add(page, 'P003'), add(other, 'P003')])
  await expect(page.getByRole('link', { name: /Cart 2/ })).toBeVisible()
  await expect(other.getByRole('link', { name: /Cart 2/ })).toBeVisible()
  await Promise.all([add(page, 'P001'), add(other, 'P002')])
  await expect(page.getByRole('link', { name: /Cart 4/ })).toBeVisible()
  await expect(other.getByRole('link', { name: /Cart 4/ })).toBeVisible()
  await page.getByRole('link', { name: /Cart 4/ }).click()
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Keyboard' })).toHaveValue('2')
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Keyboard' })).toHaveValue('2')
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Laptop' })).toHaveValue('1')
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Mouse' })).toHaveValue('1')
})

test('a stale tab cannot restore a purchased product when adding another item', async ({ page, context }) => {
  await login(page)
  await add(page, 'P003')
  const other = await context.newPage()
  await other.goto('/products')
  await expect(other.getByRole('link', { name: /Cart 1/ })).toBeVisible()
  await page.getByRole('link', { name: /Cart 1/ }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(other.getByRole('link', { name: /Cart 0/ })).toBeVisible()
  await add(other, 'P002')
  await expect(page.getByRole('link', { name: /Cart 1/ })).toBeVisible()
  await other.getByRole('link', { name: /Cart 1/ }).click()
  await expect(other.getByRole('spinbutton', { name: 'Quantity for Mouse' })).toHaveValue('1')
  await expect(other.getByRole('spinbutton', { name: 'Quantity for Keyboard' })).toHaveCount(0)
})

test('remote edits and reload preserve an uncertain checkout key and retain newly added products after replay', async ({ page, context }) => {
  await login(page)
  const before = await (await page.request.get('/api/orders/me')).json() as { total: number }
  await add(page, 'P003')
  const other = await context.newPage()
  await other.goto('/products')
  const keys: string[] = []
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    keys.push(route.request().headers()['idempotency-key'])
    if (keys.length === 1) {
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('link', { name: /Cart 1/ }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await add(other, 'P002')
  await expect(other.getByRole('link', { name: /Cart 2/ })).toBeVisible()
  await page.reload()
  await expect(page.getByText('An earlier attempt may already be saved. Retry to check its result without creating a duplicate order.')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Keyboard' })).toHaveValue('1')
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Mouse' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page).toHaveURL(/\/orders$/)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const after = await (await page.request.get('/api/orders/me')).json() as { total: number }
  expect(after.total).toBe(before.total + 1)
  await expect(other.getByRole('link', { name: /Cart 1/ })).toBeVisible()
  await page.getByRole('link', { name: /Cart 1/ }).click()
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Mouse' })).toHaveValue('1')
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Keyboard' })).toHaveCount(0)
})

test('browsers without Web Locks retain persistence and sequential cross-tab synchronization', async ({ page, context }) => {
  await context.addInitScript(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }) })
  await page.goto('/products')
  const other = await context.newPage()
  await other.goto('/products')
  await add(page, 'P003')
  await expect(other.getByRole('link', { name: /Cart 1/ })).toBeVisible()
  await add(other, 'P002')
  await expect(page.getByRole('link', { name: /Cart 2/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: /Cart 2/ })).toBeVisible()
})

test('an explicit removal after an uncertain checkout stays removed after reload without discarding the old key', async ({ page }) => {
  await login(page)
  await add(page, 'P003')
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() === 'POST') await route.abort('failed') // No server-side order write.
    else await route.continue()
  })
  await page.getByRole('link', { name: /Cart 1/ }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const before = await page.evaluate(() => {
    const raw = sessionStorage.getItem('smart-inventory-checkout:v1:customer')
    return raw === null ? null : JSON.parse(raw) as { key: string }
  })
  expect(before?.key).toBeDefined()
  await page.getByRole('button', { name: 'Remove Keyboard', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('smart-inventory-cart:v2')
    const stored = raw === null ? null : JSON.parse(raw) as { items: unknown[] }
    return stored?.items.length
  })).toBe(0)
  await page.reload()
  await expect(page.getByText('Your cart is empty')).toBeVisible()
  const after = await page.evaluate(() => {
    const raw = sessionStorage.getItem('smart-inventory-checkout:v1:customer')
    return raw === null ? null : JSON.parse(raw) as { key: string; restoreAllowed: boolean }
  })
  expect(after?.key).toBe(before?.key)
  expect(after?.restoreAllowed).toBe(false)
})
