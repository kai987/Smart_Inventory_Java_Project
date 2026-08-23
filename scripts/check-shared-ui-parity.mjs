import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const sharedPaths = [
  'app/providers.tsx',
  'theme/theme.ts',
  'theme/ThemeProvider.tsx',
  'theme/ThemeToggle.tsx',
  'theme/theme.module.css',
  'styles/tokens.css',
  'styles/global.css',
  'components/layout/PublicLayout.tsx',
  'components/layout/AdminLayout.tsx',
  'components/layout/layout.module.css',
  'components/ui/ui.module.css',
  'components/feedback/feedback.module.css',
  'features/products/productImages.ts',
  'features/products/ProductImage.tsx',
  'features/products/ProductImage.module.css',
  'features/products/ProductList.tsx',
  'features/products/products.module.css',
  'features/orders/OrderCard.tsx',
  'features/orders/orders.module.css',
  'features/admin/admin.module.css',
]

const mappedScreens = ['CartPage.tsx', 'AdminProductsPage.tsx', 'pages.module.css']
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
