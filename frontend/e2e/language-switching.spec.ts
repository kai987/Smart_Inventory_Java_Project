import { expect, test, type Locator, type Page } from '@playwright/test'

const LANGUAGE_STORAGE_KEY = 'smart-inventory-language:v1'
const THEME_STORAGE_KEY = 'smart-inventory-theme:v1'

const productNames = {
  en: { P001: 'Laptop', P004: 'Monitor' },
  ja: { P001: 'ノートパソコン', P004: 'モニター' },
  'zh-CN': { P001: '笔记本电脑', P004: '显示器' },
} as const
type Language = keyof typeof productNames

function productCard(page: Page, productId: string) {
  return page.getByRole('article').filter({ has: page.getByText(productId, { exact: true }) })
}

async function expectCatalogProductNames(page: Page, language: Language) {
  for (const productId of ['P001', 'P004'] as const) {
    const card = productCard(page, productId)
    await expect(card.getByRole('heading', { name: productNames[language][productId], exact: true })).toBeVisible()
    await expect(card.getByText(productId, { exact: true })).toBeVisible()
  }
}

async function selectLanguage(page: Page, currentLabel: string, language: Language) {
  await page.getByRole('combobox', { name: currentLabel }).selectOption(language)
}

async function expectMonitorNamesAcrossLanguages(page: Page, item: Locator) {
  await expect(item.getByText('显示器', { exact: true })).toBeVisible()
  for (const { currentLabel, language } of [
    { currentLabel: '语言', language: 'en' },
    { currentLabel: 'Language', language: 'ja' },
    { currentLabel: '言語', language: 'zh-CN' },
  ] as const) {
    await selectLanguage(page, currentLabel, language)
    await expect(item.getByText(productNames[language].P004, { exact: true })).toBeVisible()
    await expect(item.getByText('P004', { exact: true })).toBeVisible()
  }
}

async function loginWithDemo(page: Page, kind: 'customer' | 'admin', language: Language) {
  const labels = {
    en: { language: 'Language', customer: 'Fill Customer Demo', admin: 'Fill Admin Demo', submit: 'Sign in' },
    ja: { language: '言語', customer: '顧客デモを入力', admin: '管理者デモを入力', submit: 'ログイン' },
    'zh-CN': { language: '语言', customer: '填入客户演示账户', admin: '填入管理员演示账户', submit: '登录' },
  } as const

  await page.goto('/login')
  if (language !== 'en') await selectLanguage(page, 'Language', language)
  await page.getByRole('button', { name: labels[language][kind] }).click()
  await page.getByRole('button', { name: labels[language].submit }).click()
}

test('public language switching is immediate, persistent, and does not refetch products', async ({ page }) => {
  let productRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/products') productRequests += 1
  })

  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible()
  await expectCatalogProductNames(page, 'en')
  const requestsBeforeSwitch = productRequests

  await selectLanguage(page, 'Language', 'ja')
  await expect(page.getByRole('heading', { name: '商品一覧' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'カートに追加' }).first()).toBeVisible()
  await expectCatalogProductNames(page, 'ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  expect(productRequests).toBe(requestsBeforeSwitch)

  await page.reload()
  await expect(page.getByRole('heading', { name: '商品一覧' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '言語' })).toHaveValue('ja')
  await expectCatalogProductNames(page, 'ja')
  const requestsBeforeChineseSwitch = productRequests

  await selectLanguage(page, '言語', 'zh-CN')
  await expect(page.getByRole('heading', { name: '商品列表' })).toBeVisible()
  await expect(page.getByRole('button', { name: '加入购物车' }).first()).toBeVisible()
  await expectCatalogProductNames(page, 'zh-CN')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  expect(productRequests).toBe(requestsBeforeChineseSwitch)

  await page.reload()
  await expect(page.getByRole('heading', { name: '商品列表' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '语言' })).toHaveValue('zh-CN')
  await expectCatalogProductNames(page, 'zh-CN')
  const requestsBeforeEnglishSwitch = productRequests

  await selectLanguage(page, '语言', 'en')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expectCatalogProductNames(page, 'en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(productRequests).toBe(requestsBeforeEnglishSwitch)
})

test('authentication and registration copy localize while demo values stay unchanged', async ({ page }) => {
  await page.goto('/login')
  await selectLanguage(page, 'Language', 'ja')
  await expect(page.getByRole('heading', { name: 'おかえりなさい' })).toBeVisible()
  await expect(page.getByLabel('ユーザー名')).toBeVisible()
  await expect(page.getByLabel('パスワード', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '顧客デモを入力' }).click()
  await expect(page.getByLabel('ユーザー名')).toHaveValue('customer')
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('user123')

  await page.goto('/register')
  await selectLanguage(page, '言語', 'zh-CN')
  await expect(page.getByRole('heading', { name: '创建账户' })).toBeVisible()
  await page.getByRole('button', { name: '创建账户' }).click()
  await expect(page.getByText('请使用 3–20 个 ASCII 字母、数字或下划线。')).toBeVisible()
  await expect(page.getByText('密码至少需要 4 个字符。')).toBeVisible()
})

test('customer cart and order flow retains localized product names', async ({ page }) => {
  await loginWithDemo(page, 'customer', 'zh-CN')
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('heading', { name: '商品列表' })).toBeVisible()

  const monitor = productCard(page, 'P004')
  await expect(monitor.getByRole('heading', { name: '显示器', exact: true })).toBeVisible()
  await monitor.getByRole('button', { name: '加入购物车' }).click()
  await page.getByRole('link', { name: /购物车.*1/ }).click()
  await expect(page.getByRole('heading', { name: '购物车' })).toBeVisible()
  const cartMonitor = productCard(page, 'P004')
  await expect(cartMonitor.getByRole('spinbutton')).toHaveValue('1')
  await expectMonitorNamesAcrossLanguages(page, cartMonitor)
  await expect(cartMonitor.getByRole('spinbutton')).toHaveValue('1')
  await page.getByRole('button', { name: '提交订单' }).click()

  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByText('订单提交成功。')).toBeVisible()
  await page.getByText('查看下单时的商品信息').last().click()
  await expectMonitorNamesAcrossLanguages(page, page.getByRole('article').last())
})

test('admin navigation and locale formatting update immediately', async ({ page }) => {
  await loginWithDemo(page, 'admin', 'ja')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: '在庫概要' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '言語' })).toBeVisible()
  await expect(page.getByRole('link', { name: '概要' })).toBeVisible()
  await expect(page.getByRole('link', { name: '商品', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '注文', exact: true })).toBeVisible()

  await page.getByRole('link', { name: '商品', exact: true }).click()
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'ノートパソコン', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'モニター', exact: true })).toBeVisible()
  const japanesePrice = await page.evaluate(() => new Intl.NumberFormat('ja-JP', {
    style: 'currency', currency: 'JPY', maximumFractionDigits: 0,
  }).format(120000n))
  await expect(page.getByText(japanesePrice).first()).toBeVisible()

  await selectLanguage(page, '言語', 'zh-CN')
  await expect(page.getByRole('link', { name: '概览' })).toBeVisible()
  await expect(page.getByRole('link', { name: '订单', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '笔记本电脑', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '显示器', exact: true })).toBeVisible()
  const chinesePrice = await page.evaluate(() => new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: 'JPY', maximumFractionDigits: 0,
  }).format(120000n))
  await expect(page.getByText(chinesePrice).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: new Intl.NumberFormat('zh-CN').format(8), exact: true })).toBeVisible()
})

test('theme and language preferences persist independently', async ({ page }) => {
  await page.addInitScript(`
    if (window.localStorage.getItem('${LANGUAGE_STORAGE_KEY}') === null) window.localStorage.setItem('${LANGUAGE_STORAGE_KEY}', 'en');
    if (window.localStorage.getItem('${THEME_STORAGE_KEY}') === null) window.localStorage.setItem('${THEME_STORAGE_KEY}', 'light');
  `)
  await page.goto('/products')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await selectLanguage(page, 'Language', 'ja')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await selectLanguage(page, '言語', 'zh-CN')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
})

function boxesOverlap(first: Awaited<ReturnType<Locator['boundingBox']>>, second: Awaited<ReturnType<Locator['boundingBox']>>) {
  if (first === null || second === null) return true
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y
}

test('mobile header controls remain ordered, tappable, and free of horizontal overflow', async ({ page }) => {
  await page.addInitScript(`
    if (window.localStorage.getItem('${LANGUAGE_STORAGE_KEY}') === null) window.localStorage.setItem('${LANGUAGE_STORAGE_KEY}', 'zh-CN');
    if (window.localStorage.getItem('${THEME_STORAGE_KEY}') === null) window.localStorage.setItem('${THEME_STORAGE_KEY}', 'light');
  `)

  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/products')
    const menu = page.getByRole('button', { name: '打开导航' })
    const cart = page.getByRole('link', { name: /购物车中有 0 件商品/ })
    const language = page.getByRole('combobox', { name: '语言' })
    const theme = page.getByRole('button', { name: '切换到深色模式' })

    await expect(menu).toBeVisible()
    await expect(cart).toBeVisible()
    await expect(language).toBeVisible()
    await expect(theme).toBeVisible()
    for (const control of [menu, cart, language, theme]) {
      const box = await control.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40)
    }

    const [menuBox, cartBox, languageBox, themeBox] = await Promise.all([
      menu.boundingBox(), cart.boundingBox(), language.boundingBox(), theme.boundingBox(),
    ])
    expect(boxesOverlap(menuBox, cartBox)).toBe(false)
    expect(boxesOverlap(cartBox, languageBox)).toBe(false)
    expect(boxesOverlap(languageBox, themeBox)).toBe(false)
    expect(cartBox!.x).toBeLessThan(languageBox!.x)
    expect(languageBox!.x).toBeLessThan(themeBox!.x)
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true)
  }
})
