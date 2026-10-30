import { expect, test, type Locator, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const ORIGINAL_IMAGE = fileURLToPath(new URL('../public/product-images/stainless-steel-bottle.webp', import.meta.url))
const REPLACEMENT_IMAGE = fileURLToPath(new URL('../public/product-images/travel-backpack.webp', import.meta.url))

const PRODUCT_ID = 'P987'
const originalNames = {
  en: 'E2E Ceramic Travel Cup',
  ja: 'E2E 陶器トラベルカップ',
  'zh-CN': 'E2E 陶瓷随行杯',
} as const
const updatedNames = {
  en: 'E2E Updated Travel Cup',
  ja: 'E2E 改訂トラベルカップ',
  'zh-CN': 'E2E 新版随行杯',
} as const
type Language = keyof typeof originalNames

function fixtureRow(page: Page): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: PRODUCT_ID, exact: true }) })
}

function fixtureArticle(page: Page): Locator {
  return page.getByRole('article').filter({ has: page.getByText(PRODUCT_ID, { exact: true }) })
}

async function selectLanguage(page: Page, language: Language) {
  await page.getByRole('combobox', { name: /^(Language|言語|语言)$/ }).selectOption(language)
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

async function loginWithDemo(page: Page, role: 'admin' | 'customer') {
  await page.goto('/products')
  await selectLanguage(page, 'en')
  const logout = page.getByRole('button', { name: 'Log out', exact: true })
  if (await logout.count() > 0) await logout.click()
  await page.goto('/login')
  await page.getByRole('button', { name: role === 'admin' ? 'Fill Admin Demo' : 'Fill Customer Demo', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(role === 'admin' ? /\/admin$/ : /\/products$/)
}

async function removeOwnFixture(page: Page) {
  await loginWithDemo(page, 'admin')
  await page.goto('/admin/products')
  await page.getByRole('searchbox', { name: 'Search products' }).fill(PRODUCT_ID)
  await expect(page.getByLabel('Loading content')).toHaveCount(0)
  const row = fixtureRow(page)
  if (await row.count() === 0) return
  // Retried tests may leave this fixture behind. Never delete an unrelated row.
  const name = await row.getByRole('cell').nth(1).innerText()
  expect([originalNames.en, updatedNames.en]).toContain(name)
  await row.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete product?', exact: true }).getByRole('button', { name: 'Delete product', exact: true }).click()
  await expect(row).toHaveCount(0)
}

async function expectNamesAcrossLanguages(page: Page, item: Locator, names: Record<Language, string>) {
  for (const language of ['ja', 'zh-CN', 'en'] as const) {
    await selectLanguage(page, language)
    await expect(item.getByText(names[language], { exact: true })).toBeVisible()
    await expect(item.getByText(PRODUCT_ID, { exact: true })).toBeVisible()
  }
}

test('custom names, category and images survive save, checkout, edits, and product deletion', async ({ page }) => {
  test.setTimeout(120_000)
  // Playwright starts the backend with its disposable .playwright-data[-rust] directory.
  await removeOwnFixture(page)
  let mayHaveCreatedFixture = false

  try {
    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Add product', exact: true })
    await dialog.getByLabel('Product ID', { exact: true }).fill(PRODUCT_ID)
    await dialog.getByLabel('English name (required)', { exact: true }).fill(originalNames.en)
    await dialog.getByLabel('Japanese name (optional)', { exact: true }).fill(originalNames.ja)
    await dialog.getByLabel('Chinese name (optional)', { exact: true }).fill(originalNames['zh-CN'])
    await dialog.getByLabel('Price (JPY)', { exact: true }).fill('1875')
    await dialog.getByLabel('Stock', { exact: true }).fill('3')
    await dialog.getByLabel('Weight (kg)', { exact: true }).fill('0.45')
    await dialog.getByLabel('Category', { exact: true }).selectOption('travel')
    await dialog.getByLabel('Product image', { exact: true }).setInputFiles(ORIGINAL_IMAGE)
    await expect(dialog.getByRole('img', { name: 'Selected product image preview', exact: true })).toBeVisible()

    await selectLanguage(page, 'ja')
    dialog = page.getByRole('dialog', { name: '商品を追加', exact: true })
    await expect(dialog.getByLabel('英語名（必須）', { exact: true })).toHaveValue(originalNames.en)
    await expect(dialog.getByLabel('日本語名（任意）', { exact: true })).toHaveValue(originalNames.ja)
    await expect(dialog.getByLabel('中国語名（任意）', { exact: true })).toHaveValue(originalNames['zh-CN'])
    await selectLanguage(page, 'zh-CN')
    dialog = page.getByRole('dialog', { name: '添加商品', exact: true })
    await expect(dialog.getByLabel('英文名称（必填）', { exact: true })).toHaveValue(originalNames.en)
    await expect(dialog.getByLabel('日文名称（选填）', { exact: true })).toHaveValue(originalNames.ja)
    await expect(dialog.getByLabel('中文名称（选填）', { exact: true })).toHaveValue(originalNames['zh-CN'])
    await selectLanguage(page, 'en')
    dialog = page.getByRole('dialog', { name: 'Add product', exact: true })
    mayHaveCreatedFixture = true
    await dialog.getByRole('button', { name: 'Add product', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(fixtureRow(page).getByRole('cell', { name: originalNames.en, exact: true })).toBeVisible()
    await expect(fixtureRow(page).locator('img')).toHaveAttribute('src', /^\/api\/product-images\/[a-f0-9-]+\.webp$/)
    const originalImageUrl = await fixtureRow(page).locator('img').getAttribute('src')
    if (originalImageUrl === null) throw new Error('Uploaded image URL is missing')

    await page.reload()
    for (const { language, query } of [
      { language: 'ja', query: 'CERAMIC' },
      { language: 'zh-CN', query: 'トラベル' },
      { language: 'en', query: '陶瓷' },
    ] as const) {
      await selectLanguage(page, language)
      await page.getByRole('searchbox').fill(query)
      await expect(fixtureRow(page).getByRole('cell', { name: originalNames[language], exact: true })).toBeVisible()
      await expect(page.getByRole('row')).toHaveCount(2)
    }

    await loginWithDemo(page, 'customer')
    await page.getByRole('searchbox').fill(PRODUCT_ID)
    await expect(fixtureArticle(page).getByRole('heading', { name: originalNames.en, exact: true })).toBeVisible()
    await expect(fixtureArticle(page).getByText('Travel', { exact: true })).toBeVisible()
    await expect(fixtureArticle(page).locator('img')).toHaveAttribute('src', originalImageUrl)
    await fixtureArticle(page).getByRole('button', { name: 'Add to cart', exact: true }).click()
    await page.getByRole('link', { name: /Cart 1/ }).click()
    const cartItem = fixtureArticle(page)
    await expect(cartItem.getByRole('spinbutton')).toHaveValue('1')
    await expect(cartItem.locator('img')).toHaveAttribute('src', originalImageUrl)
    await expectNamesAcrossLanguages(page, cartItem, originalNames)
    await expect(cartItem.getByRole('spinbutton')).toHaveValue('1')
    await page.getByRole('button', { name: 'Place order', exact: true }).click()
    await expect(page).toHaveURL(/\/orders$/)
    const newOrder = page.getByRole('article').last()
    await newOrder.getByText('View item snapshots', { exact: true }).click()
    await expect(newOrder.getByText(originalNames.en, { exact: true })).toBeVisible()
    const orderId = await newOrder.locator('strong').first().innerText()
    await expectNamesAcrossLanguages(page, newOrder, originalNames)

    await loginWithDemo(page, 'admin')
    await page.goto('/admin/products')
    await page.getByRole('searchbox', { name: 'Search products' }).fill(PRODUCT_ID)
    await fixtureRow(page).getByRole('button', { name: `Edit details for ${originalNames.en}`, exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Edit product details', exact: true })
    await dialog.getByLabel('English name (required)', { exact: true }).fill(updatedNames.en)
    await dialog.getByLabel('Japanese name (optional)', { exact: true }).fill(updatedNames.ja)
    await dialog.getByLabel('Chinese name (optional)', { exact: true }).fill(updatedNames['zh-CN'])
    await expect(dialog.getByLabel('Category', { exact: true })).toHaveValue('travel')
    await dialog.getByLabel('Category', { exact: true }).selectOption('home')
    await dialog.getByLabel('Product image', { exact: true }).setInputFiles(REPLACEMENT_IMAGE)
    await dialog.getByRole('button', { name: 'Save details', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(fixtureRow(page).locator('img')).not.toHaveAttribute('src', originalImageUrl)
    await expectNamesAcrossLanguages(page, fixtureRow(page), updatedNames)
    await expect(fixtureRow(page).getByRole('cell', { name: '2', exact: true })).toBeVisible()
    await fixtureRow(page).getByRole('button', { name: `Delete ${updatedNames.en}`, exact: true }).click()
    await page.getByRole('dialog', { name: 'Delete product?', exact: true }).getByRole('button', { name: 'Delete product', exact: true }).click()
    await expect(fixtureRow(page)).toHaveCount(0)
    mayHaveCreatedFixture = false

    await loginWithDemo(page, 'customer')
    await page.goto('/orders')
    const historicalOrder = page.getByRole('article').filter({ has: page.getByText(orderId, { exact: true }) })
    await historicalOrder.getByText('View item snapshots', { exact: true }).click()
    await expectNamesAcrossLanguages(page, historicalOrder, originalNames)
    await expect(historicalOrder.locator('img')).toHaveAttribute('src', originalImageUrl)
    const imageResponse = await page.request.get(originalImageUrl)
    expect(imageResponse.status()).toBe(200)
    expect(imageResponse.headers()['content-type']).toBe('image/webp')
    for (const name of Object.values(updatedNames)) await expect(historicalOrder.getByText(name, { exact: true })).toHaveCount(0)
    await page.goto('/products')
    await page.getByRole('searchbox').fill(PRODUCT_ID)
    await expect(fixtureArticle(page)).toHaveCount(0)
    await expect(page.getByText('No products found', { exact: true })).toBeVisible()
  } finally {
    if (mayHaveCreatedFixture) await removeOwnFixture(page)
  }
})
