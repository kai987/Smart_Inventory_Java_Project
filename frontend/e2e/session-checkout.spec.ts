import { expect, test, type Page } from '@playwright/test'

async function customerLogin(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Fill Customer Demo' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/products$/)
}

test('switching customer accounts never displays the previous customer orders', async ({ page }) => {
  await customerLogin(page)
  await page.getByRole('link', { name: 'My orders' }).click()
  await expect(page.getByRole('article').first()).toBeVisible()
  const privateOrderIds = await page.getByRole('article').locator('strong').first().allTextContents()
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('link', { name: 'Register' }).click()
  const username = `qa_${Date.now()}`
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Create an account', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('link', { name: 'My orders' }).click()
  await expect(page.getByText('No orders yet')).toBeVisible()
  for (const orderId of privateOrderIds) await expect(page.getByText(orderId, { exact: true })).toHaveCount(0)
})

test('a lost success response is retried once with the same key after reload, even at zero stock', async ({ page }) => {
  await customerLogin(page)
  const beforeResponse = await page.request.get('/api/orders/me')
  const before = await beforeResponse.json() as { total: number }
  const monitor = page.getByRole('article').filter({ hasText: 'Monitor' })
  await monitor.getByRole('button', { name: 'Add to cart' }).click()
  await page.getByRole('link', { name: /Cart 1/ }).click()
  const quantity = page.getByRole('spinbutton', { name: 'Quantity for Monitor' })
  const startingStock = Number(await quantity.getAttribute('max'))
  await quantity.fill(String(startingStock))

  const keys: string[] = []
  let releaseResponse: () => void = () => { throw new Error('Response gate not initialized') }
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
  let createdOrderId = ''
  let firstResponseFetched = false
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    keys.push(route.request().headers()['idempotency-key'])
    if (keys.length === 1) {
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      const body = await response.json() as { orderId: string }
      createdOrderId = body.orderId
      firstResponseFetched = true
      await responseGate
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Place order' }).click()
  await expect.poll(() => firstResponseFetched).toBe(true)
  await expect(quantity).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove Monitor' })).toBeDisabled()
  releaseResponse()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Monitor' })).toHaveValue(String(startingStock))
  await expect(page.getByText('Waiting to confirm the earlier order attempt.')).toBeVisible()
  expect(await page.getByRole('spinbutton', { name: 'Quantity for Monitor' }).getAttribute('max')).toBe('0')
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByText(createdOrderId, { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
  const afterResponse = await page.request.get('/api/orders/me')
  const after = await afterResponse.json() as { total: number }
  expect(after.total).toBe(before.total + 1)
  await page.getByRole('link', { name: /Cart 0/ }).click()
  await expect(page.getByText('Your cart is empty')).toBeVisible()
})
