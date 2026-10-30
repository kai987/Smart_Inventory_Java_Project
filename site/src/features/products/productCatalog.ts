import type { Product } from '../../api/types'
import type { AppLanguage } from '../../i18n/language'

export type ProductCategory = 'electronics' | 'home' | 'kitchen' | 'travel' | 'sports' | 'stationery' | 'other'
export type ProductCategoryFilter = 'all' | ProductCategory
export type ProductSort = 'default' | 'priceAsc' | 'priceDesc'
export type ProductNameTranslations = { nameJa?: string | undefined; nameZh?: string | undefined }

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

type CatalogMetadata = { canonicalName: string; category: ProductCategory; jaName: string; zhName: string }

const catalogMetadata = new Map<string, CatalogMetadata>([
  ['P001', { canonicalName: 'Laptop', category: 'electronics', jaName: 'ノートパソコン', zhName: '笔记本电脑' }],
  ['P002', { canonicalName: 'Mouse', category: 'electronics', jaName: 'マウス', zhName: '鼠标' }],
  ['P003', { canonicalName: 'Keyboard', category: 'electronics', jaName: 'キーボード', zhName: '键盘' }],
  ['P004', { canonicalName: 'Monitor', category: 'electronics', jaName: 'モニター', zhName: '显示器' }],
  ['P005', { canonicalName: 'Desk Lamp', category: 'home', jaName: 'デスクライト', zhName: '台灯' }],
  ['P006', { canonicalName: 'Robot Vacuum', category: 'home', jaName: 'ロボット掃除機', zhName: '扫地机器人' }],
  ['P007', { canonicalName: 'Desk Fan', category: 'home', jaName: '卓上扇風機', zhName: '桌面风扇' }],
  ['P008', { canonicalName: 'Digital Alarm Clock', category: 'home', jaName: 'デジタル目覚まし時計', zhName: '电子闹钟' }],
  ['P009', { canonicalName: 'Electric Kettle', category: 'kitchen', jaName: '電気ケトル', zhName: '电热水壶' }],
  ['P010', { canonicalName: 'Frying Pan', category: 'kitchen', jaName: 'フライパン', zhName: '平底锅' }],
  ['P011', { canonicalName: 'Stainless Steel Bottle', category: 'kitchen', jaName: 'ステンレスボトル', zhName: '不锈钢水瓶' }],
  ['P012', { canonicalName: 'Digital Kitchen Scale', category: 'kitchen', jaName: 'デジタルキッチンスケール', zhName: '电子厨房秤' }],
  ['P013', { canonicalName: 'Travel Backpack', category: 'travel', jaName: 'トラベルバックパック', zhName: '旅行背包' }],
  ['P014', { canonicalName: 'Cabin Suitcase', category: 'travel', jaName: '機内持ち込みスーツケース', zhName: '登机行李箱' }],
  ['P015', { canonicalName: 'Compact Umbrella', category: 'travel', jaName: '折りたたみ傘', zhName: '折叠雨伞' }],
  ['P016', { canonicalName: 'Toiletry Bag', category: 'travel', jaName: 'トイレタリーポーチ', zhName: '洗漱包' }],
  ['P017', { canonicalName: 'Yoga Mat', category: 'sports', jaName: 'ヨガマット', zhName: '瑜伽垫' }],
  ['P018', { canonicalName: 'Dumbbell Set', category: 'sports', jaName: 'ダンベルセット', zhName: '哑铃套装' }],
  ['P019', { canonicalName: 'Jump Rope', category: 'sports', jaName: '縄跳び', zhName: '跳绳' }],
  ['P020', { canonicalName: 'Basketball', category: 'sports', jaName: 'バスケットボール', zhName: '篮球' }],
  ['P021', { canonicalName: 'Notebook Set', category: 'stationery', jaName: 'ノートセット', zhName: '笔记本套装' }],
  ['P022', { canonicalName: 'Gel Pen Set', category: 'stationery', jaName: 'ゲルインクペンセット', zhName: '中性笔套装' }],
  ['P023', { canonicalName: 'Desk Organizer', category: 'stationery', jaName: 'デスクオーガナイザー', zhName: '桌面收纳盒' }],
  ['P024', { canonicalName: 'Pencil Case', category: 'stationery', jaName: 'ペンケース', zhName: '笔袋' }],
])

function getMatchingMetadata(product: Pick<Product, 'id' | 'name'>): CatalogMetadata | undefined {
  const metadata = catalogMetadata.get(product.id.trim().toUpperCase())
  // An administrator may reuse an ID or rename a product. Do not apply stale metadata to it.
  return metadata?.canonicalName.toLowerCase() === product.name.trim().toLowerCase() ? metadata : undefined
}

export function getProductCategory(product: Pick<Product, 'id' | 'name'>): ProductCategory {
  return getMatchingMetadata(product)?.category ?? 'other'
}

export function getLocalizedProductName(productId: string, originalName: string, language: AppLanguage, translations?: ProductNameTranslations): string {
  const savedTranslation = language === 'ja' ? translations?.nameJa : language === 'zh-CN' ? translations?.nameZh : undefined
  if (savedTranslation?.trim()) return savedTranslation.trim()
  const metadata = getMatchingMetadata({ id: productId, name: originalName })
  if (metadata === undefined) return originalName
  if (language === 'ja') return metadata.jaName
  if (language === 'zh-CN') return metadata.zhName
  return metadata.canonicalName
}

function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase()
}

export function matchesProductSearch(product: Pick<Product, 'id' | 'name' | 'nameJa' | 'nameZh'>, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery === '') return true
  if ([product.id, product.name, product.nameJa, product.nameZh].some((value) =>
    value !== undefined && normalizeSearchText(value).includes(normalizedQuery))) return true

  const metadata = getMatchingMetadata(product)
  return metadata !== undefined && [metadata.canonicalName, metadata.jaName, metadata.zhName]
    .some((value) => normalizeSearchText(value).includes(normalizedQuery))
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
