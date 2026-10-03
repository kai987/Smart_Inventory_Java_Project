import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const explicitSharedPaths = [
  'app/providers.tsx',
  'app/queryClient.ts',
  'auth/AuthProvider.tsx',
  'api/orderApi.ts',
  'api/productApi.ts',
  'api/authApi.ts',
  'api/adminApi.ts',
  'api/httpClient.ts',
  'cart/cartReducer.ts',
  'cart/cartTypes.ts',
  'cart/CartProvider.tsx',
  'cart/checkoutIntent.ts',
  'auth/RequireAuth.tsx',
  'auth/RequireRole.tsx',
  'theme/theme.ts',
  'theme/ThemeProvider.tsx',
  'theme/ThemeToggle.tsx',
  'theme/theme.module.css',
  'utils/currency.ts',
  'styles/tokens.css',
  'styles/global.css',
  'features/admin/admin.module.css',
  'components/navigation/Brand.tsx',
]

const sharedDirectories = [
  'i18n',
  'components/layout',
  'components/feedback',
  'components/ui',
  'features/products',
  'features/orders',
]

async function listRuntimeFiles(relativeDirectory) {
  const directory = resolve(repositoryRoot, 'frontend/src', relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) return listRuntimeFiles(relativePath)
    if (!entry.isFile() || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return []
    return [relativePath]
  }))
  return files.flat()
}

const discoveredSharedPaths = (await Promise.all(sharedDirectories.map(listRuntimeFiles))).flat()
const sharedPaths = [...new Set([...explicitSharedPaths, ...discoveredSharedPaths])].sort()
const mappedScreens = [
  'ProductsPage.tsx',
  'CartPage.tsx',
  'OrdersPage.tsx',
  'LoginPage.tsx',
  'RegisterPage.tsx',
  'AdminDashboardPage.tsx',
  'AdminProductsPage.tsx',
  'AdminOrdersPage.tsx',
  'ForbiddenPage.tsx',
  'NotFoundPage.tsx',
  'pages.module.css',
]
const productImages = ['laptop.webp', 'mouse.webp', 'keyboard.webp', 'monitor.webp']
const pairs = [
  ...sharedPaths.map((path) => [`frontend/src/${path}`, `site/src/${path}`]),
  ...mappedScreens.map((path) => [`frontend/src/pages/${path}`, `site/src/screens/${path}`]),
  ...productImages.map((path) => [`frontend/public/product-images/${path}`, `site/public/product-images/${path}`]),
]

const drift = []
for (const [frontendPath, sitePath] of pairs) {
  const [frontendContents, siteContents] = await Promise.all([
    readFile(resolve(repositoryRoot, frontendPath)),
    readFile(resolve(repositoryRoot, sitePath)),
  ])
  if (!frontendContents.equals(siteContents)) drift.push(`${frontendPath} != ${sitePath}`)
}

if (drift.length > 0) {
  console.error('Shared UI parity check failed:')
  for (const mismatch of drift) console.error(`- ${mismatch}`)
  process.exitCode = 1
} else {
  console.log(`Shared UI parity check passed (${pairs.length} file pairs).`)
}
