import { expect, test, type Page } from '@playwright/test'

const THEME_STORAGE_KEY = 'smart-inventory-theme:v1'
const PRODUCT_IMAGE_PATTERN = /^\/product-images\/(laptop|mouse|keyboard|monitor)\.webp$/

async function expectLoadedImages(page: Page, selector: string, expectedCount: number) {
  const images = page.locator(selector)
  await expect(images).toHaveCount(expectedCount)
  for (let index = 0; index < expectedCount; index += 1) {
    const image = images.nth(index)
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
    await expect(image).toHaveJSProperty('naturalWidth', 720)
    await expect(image).toHaveJSProperty('naturalHeight', 540)
  }
}

test('theme persists and local product images work across public, cart, and admin views', async ({ page }) => {
  const productImageResponses = new Map<string, number>()
  page.on('response', (response) => {
    const match = PRODUCT_IMAGE_PATTERN.exec(new URL(response.url()).pathname)
    if (match !== null) productImageResponses.set(match[1], response.status())
  })
  await page.addInitScript(`if (window.localStorage.getItem('${THEME_STORAGE_KEY}') === null) window.localStorage.setItem('${THEME_STORAGE_KEY}', 'light')`)

  await page.goto('/products')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#08111f')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await expectLoadedImages(page, 'article img[src^="/product-images/"]', 4)
  expect([...productImageResponses.values()]).toHaveLength(4)
  expect([...productImageResponses.values()].every((status) => status >= 200 && status < 400)).toBe(true)

  const laptop = page.getByRole('article').filter({ hasText: 'Laptop' })
  await laptop.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByRole('link', { name: /Cart 1/ })).toBeVisible()
  await page.getByRole('link', { name: /Cart 1/ }).click()
  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible()
  await expectLoadedImages(page, 'article img[src="/product-images/laptop.webp"]', 1)

  await page.goto('/login')
  await page.getByRole('button', { name: 'Fill Admin Demo' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
  await page.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expectLoadedImages(page, 'tbody img[src^="/product-images/"]', 4)

  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f8fb')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('reduced motion keeps theme switching functional without transition animation', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.goto('/products')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transitioning', 'true')
  await expect(page.locator('[class*="themeIcon"]')).toHaveCSS('animation-name', 'none')
})
