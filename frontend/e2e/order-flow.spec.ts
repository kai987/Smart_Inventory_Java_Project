import { expect, test } from '@playwright/test'

test('customer order is visible to admin and reduces stock', async ({ page }) => {
  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()

  await page.getByRole('link', { name: 'Login' }).click()
  await page.getByRole('button', { name: 'Fill Customer Demo' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/products$/)

  const laptop = page.getByRole('article').filter({ hasText: 'Laptop' })
  const mouse = page.getByRole('article').filter({ hasText: 'Mouse' })
  await laptop.getByRole('button', { name: 'Add to cart' }).click()
  await mouse.getByRole('button', { name: 'Add to cart' }).click()
  await mouse.getByRole('button', { name: 'Add to cart' }).click()

  await page.getByRole('link', { name: /Cart 3/ }).click()
  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByText('Order placed successfully.')).toBeVisible()
  await page.getByText('View item snapshots').last().click()
  await expect(page.getByText('Laptop').last()).toBeVisible()
  await expect(page.getByText('Mouse').last()).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('link', { name: 'Login' }).click()
  await page.getByRole('button', { name: 'Fill Admin Demo' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)

  await page.getByRole('link', { name: 'Orders' }).click()
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
  const customerOrders = page.locator('details').filter({ hasText: 'customer' })
  const createdOrder = customerOrders.last()
  await expect(createdOrder).toBeVisible()
  await createdOrder.locator('summary').click()
  await expect(createdOrder.getByText(/Mouse · P002/)).toBeVisible()
  await expect(createdOrder.getByText('2', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  const laptopRow = page.getByRole('row').filter({ hasText: 'P001' })
  const mouseRow = page.getByRole('row').filter({ hasText: 'P002' })
  await expect(laptopRow.getByRole('cell', { name: '7', exact: true })).toBeVisible()
  await expect(mouseRow.getByRole('cell', { name: '28', exact: true })).toBeVisible()
})
