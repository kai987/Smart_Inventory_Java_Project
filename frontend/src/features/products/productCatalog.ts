import type { Product } from '../../api/types'

export type ProductCategory = 'electronics' | 'home' | 'kitchen' | 'travel' | 'sports' | 'stationery' | 'other'
export type ProductCategoryFilter = 'all' | ProductCategory
export type ProductSort = 'default' | 'priceAsc' | 'priceDesc'

export const productCategoryLabelKeys = {
  all: 'products.categoryAll',
  electronics: 'products.categoryElectronics',
  home: 'products.categoryHome',
  kitchen: 'products.categoryKitchen',
  travel: 'products.categoryTravel',
  sports: 'products.categorySports',
  stationery: 'products.categoryStationery',
  other: 'products.categoryOther',
} as const

export const productCategories: readonly ProductCategoryFilter[] = [
  'all', 'electronics', 'home', 'kitchen', 'travel', 'sports', 'stationery', 'other',
]

const catalogMetadata = new Map<string, { canonicalName: string; category: ProductCategory }>([
  ['P001', { canonicalName: 'Laptop', category: 'electronics' }],
  ['P002', { canonicalName: 'Mouse', category: 'electronics' }],
  ['P003', { canonicalName: 'Keyboard', category: 'electronics' }],
  ['P004', { canonicalName: 'Monitor', category: 'electronics' }],
  ['P005', { canonicalName: 'Desk Lamp', category: 'home' }],
  ['P006', { canonicalName: 'Robot Vacuum', category: 'home' }],
  ['P007', { canonicalName: 'Desk Fan', category: 'home' }],
  ['P008', { canonicalName: 'Digital Alarm Clock', category: 'home' }],
  ['P009', { canonicalName: 'Electric Kettle', category: 'kitchen' }],
  ['P010', { canonicalName: 'Frying Pan', category: 'kitchen' }],
  ['P011', { canonicalName: 'Stainless Steel Bottle', category: 'kitchen' }],
  ['P012', { canonicalName: 'Digital Kitchen Scale', category: 'kitchen' }],
  ['P013', { canonicalName: 'Travel Backpack', category: 'travel' }],
  ['P014', { canonicalName: 'Cabin Suitcase', category: 'travel' }],
  ['P015', { canonicalName: 'Compact Umbrella', category: 'travel' }],
  ['P016', { canonicalName: 'Toiletry Bag', category: 'travel' }],
  ['P017', { canonicalName: 'Yoga Mat', category: 'sports' }],
  ['P018', { canonicalName: 'Dumbbell Set', category: 'sports' }],
  ['P019', { canonicalName: 'Jump Rope', category: 'sports' }],
  ['P020', { canonicalName: 'Basketball', category: 'sports' }],
  ['P021', { canonicalName: 'Notebook Set', category: 'stationery' }],
  ['P022', { canonicalName: 'Gel Pen Set', category: 'stationery' }],
  ['P023', { canonicalName: 'Desk Organizer', category: 'stationery' }],
  ['P024', { canonicalName: 'Pencil Case', category: 'stationery' }],
])

export function getProductCategory(product: Pick<Product, 'id' | 'name'>): ProductCategory {
  const metadata = catalogMetadata.get(product.id.trim().toUpperCase())
  // An administrator may reuse an ID or rename a product. Do not apply stale metadata to it.
  return metadata?.canonicalName.toLowerCase() === product.name.trim().toLowerCase() ? metadata.category : 'other'
}

export function selectCatalogProducts(
  products: readonly Product[],
  category: ProductCategoryFilter,
  sort: ProductSort,
): Product[] {
  const selected = category === 'all' ? [...products] : products.filter((product) => getProductCategory(product) === category)
  if (sort === 'default') return selected

  return selected.sort((left, right) => {
    const leftPrice = BigInt(left.priceYen)
    const rightPrice = BigInt(right.priceYen)
    const comparison = leftPrice < rightPrice ? -1 : leftPrice > rightPrice ? 1 : 0
    return sort === 'priceAsc' ? comparison : -comparison
  })
}
