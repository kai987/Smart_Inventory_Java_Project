import { describe, expect, it } from 'vitest'
import type { Product } from '../../api/types'
import { getLocalizedProductName, getProductCategory, matchesProductSearch, selectCatalogProducts, type ProductCategory } from './productCatalog'

const coreProducts: [string, string, ProductCategory][] = [
  ['P001', 'Laptop', 'electronics'], ['P002', 'Mouse', 'electronics'],
  ['P003', 'Keyboard', 'electronics'], ['P004', 'Monitor', 'electronics'],
  ['P005', 'Desk Lamp', 'home'], ['P006', 'Robot Vacuum', 'home'],
  ['P007', 'Desk Fan', 'home'], ['P008', 'Digital Alarm Clock', 'home'],
  ['P009', 'Electric Kettle', 'kitchen'], ['P010', 'Frying Pan', 'kitchen'],
  ['P011', 'Stainless Steel Bottle', 'kitchen'], ['P012', 'Digital Kitchen Scale', 'kitchen'],
  ['P013', 'Travel Backpack', 'travel'], ['P014', 'Cabin Suitcase', 'travel'],
  ['P015', 'Compact Umbrella', 'travel'], ['P016', 'Toiletry Bag', 'travel'],
  ['P017', 'Yoga Mat', 'sports'], ['P018', 'Dumbbell Set', 'sports'],
  ['P019', 'Jump Rope', 'sports'], ['P020', 'Basketball', 'sports'],
  ['P021', 'Notebook Set', 'stationery'], ['P022', 'Gel Pen Set', 'stationery'],
  ['P023', 'Desk Organizer', 'stationery'], ['P024', 'Pencil Case', 'stationery'],
]

const localizedProducts: [string, string, string, string][] = [
  ['P001', 'Laptop', '笔记本电脑', 'ノートパソコン'],
  ['P002', 'Mouse', '鼠标', 'マウス'],
  ['P003', 'Keyboard', '键盘', 'キーボード'],
  ['P004', 'Monitor', '显示器', 'モニター'],
  ['P005', 'Desk Lamp', '台灯', 'デスクライト'],
  ['P006', 'Robot Vacuum', '扫地机器人', 'ロボット掃除機'],
  ['P007', 'Desk Fan', '桌面风扇', '卓上扇風機'],
  ['P008', 'Digital Alarm Clock', '电子闹钟', 'デジタル目覚まし時計'],
  ['P009', 'Electric Kettle', '电热水壶', '電気ケトル'],
  ['P010', 'Frying Pan', '平底锅', 'フライパン'],
  ['P011', 'Stainless Steel Bottle', '不锈钢水瓶', 'ステンレスボトル'],
  ['P012', 'Digital Kitchen Scale', '电子厨房秤', 'デジタルキッチンスケール'],
  ['P013', 'Travel Backpack', '旅行背包', 'トラベルバックパック'],
  ['P014', 'Cabin Suitcase', '登机行李箱', '機内持ち込みスーツケース'],
  ['P015', 'Compact Umbrella', '折叠雨伞', '折りたたみ傘'],
  ['P016', 'Toiletry Bag', '洗漱包', 'トイレタリーポーチ'],
  ['P017', 'Yoga Mat', '瑜伽垫', 'ヨガマット'],
  ['P018', 'Dumbbell Set', '哑铃套装', 'ダンベルセット'],
  ['P019', 'Jump Rope', '跳绳', '縄跳び'],
  ['P020', 'Basketball', '篮球', 'バスケットボール'],
  ['P021', 'Notebook Set', '笔记本套装', 'ノートセット'],
  ['P022', 'Gel Pen Set', '中性笔套装', 'ゲルインクペンセット'],
  ['P023', 'Desk Organizer', '桌面收纳盒', 'デスクオーガナイザー'],
  ['P024', 'Pencil Case', '笔袋', 'ペンケース'],
]

const product = (id: string, name: string, priceYen = '1000'): Product => ({ id, name, priceYen, stock: 5, weightKg: 1, available: true })

describe('productCatalog', () => {
  it.each(coreProducts)('categorizes %s only with its canonical name', (id, name, category) => {
    expect(getProductCategory({ id, name })).toBe(category)
  })

  it('matches canonical metadata without case or surrounding whitespace differences', () => {
    expect(getProductCategory({ id: ' p005 ', name: ' DESK LAMP ' })).toBe('home')
  })

  it('keeps custom, renamed, and mismatched products in Other', () => {
    expect(getProductCategory({ id: 'CUSTOM-1', name: 'Laptop' })).toBe('other')
    expect(getProductCategory({ id: 'P001', name: 'Custom workstation' })).toBe('other')
    expect(getProductCategory({ id: 'P001', name: 'Desk Lamp' })).toBe('other')
    expect(getProductCategory({ id: 'toString', name: 'Laptop' })).toBe('other')
  })

  it('honors saved categories for custom and standard products before metadata fallbacks', () => {
    expect(getProductCategory({ id: 'P900', name: 'Handmade Cup', category: 'kitchen' })).toBe('kitchen')
    expect(getProductCategory({ id: 'P001', name: 'Laptop', category: 'other' })).toBe('other')
    expect(getProductCategory({ id: 'P001', name: 'Laptop', category: 'home' })).toBe('home')
    const custom = { ...product('P900', 'Handmade Cup'), category: 'kitchen' } as const
    const reassignedLaptop = { ...product('P001', 'Laptop'), category: 'other' } as const
    expect(selectCatalogProducts([custom, reassignedLaptop], 'kitchen', 'default')).toEqual([custom])
    expect(selectCatalogProducts([custom, reassignedLaptop], 'electronics', 'default')).toEqual([])
    expect(selectCatalogProducts([custom, reassignedLaptop], 'other', 'default')).toEqual([reassignedLaptop])
  })

  it.each(localizedProducts)('localizes %s in all three languages without modifying source data', (id, name, zhName, jaName) => {
    const original = Object.freeze({ id, name })
    expect(getLocalizedProductName(id, name, 'en')).toBe(name)
    expect(getLocalizedProductName(id, name, 'zh-CN')).toBe(zhName)
    expect(getLocalizedProductName(id, name, 'ja')).toBe(jaName)
    expect(original).toEqual({ id, name })
  })

  it('preserves the exact original name for unknown, renamed, and conflicting products', () => {
    for (const language of ['en', 'ja', 'zh-CN'] as const) {
      expect(getLocalizedProductName('CUSTOM-1', ' Laptop ', language)).toBe(' Laptop ')
      expect(getLocalizedProductName('P001', 'Custom workstation', language)).toBe('Custom workstation')
      expect(getLocalizedProductName('P001', 'Desk Lamp', language)).toBe('Desk Lamp')
      expect(getLocalizedProductName('toString', 'Laptop', language)).toBe('Laptop')
      expect(getLocalizedProductName('P005', '台灯', language)).toBe('台灯')
    }
    expect(getLocalizedProductName(' p001 ', ' LAPTOP ', 'en')).toBe('Laptop')
    expect(getLocalizedProductName(' p001 ', ' LAPTOP ', 'ja')).toBe('ノートパソコン')
  })

  it('displays administrator-provided names in the selected language and falls back to the original', () => {
    const custom = Object.freeze({ id: 'P910', name: 'Ceramic Travel Cup', nameJa: '陶器のトラベルカップ', nameZh: '陶瓷随行杯' })
    expect(getLocalizedProductName(custom.id, custom.name, 'en', custom)).toBe('Ceramic Travel Cup')
    expect(getLocalizedProductName(custom.id, custom.name, 'ja', custom)).toBe('陶器のトラベルカップ')
    expect(getLocalizedProductName(custom.id, custom.name, 'zh-CN', custom)).toBe('陶瓷随行杯')
    expect(getLocalizedProductName(custom.id, custom.name, 'ja', { nameJa: '  ' })).toBe('Ceramic Travel Cup')
    expect(getLocalizedProductName(custom.id, custom.name, 'zh-CN', { nameJa: custom.nameJa })).toBe('Ceramic Travel Cup')
    expect(custom.name).toBe('Ceramic Travel Cup')
  })

  it('prefers saved names over built-in translations without changing built-in fallback behavior', () => {
    expect(getLocalizedProductName('P001', 'Laptop', 'ja', { nameJa: '業務用ノートPC' })).toBe('業務用ノートPC')
    expect(getLocalizedProductName('P001', 'Laptop', 'zh-CN', { nameZh: '商务笔记本' })).toBe('商务笔记本')
    expect(getLocalizedProductName('P001', 'Laptop', 'ja', {})).toBe('ノートパソコン')
    expect(getLocalizedProductName('P001', 'Laptop', 'en', { nameJa: '業務用ノートPC' })).toBe('Laptop')
    expect(getLocalizedProductName('P001', 'Renamed PC', 'ja', { nameJa: '新しいPC' })).toBe('新しいPC')
  })

  it.each(localizedProducts)('searches %s using its ID and every localized name', (id, name, zhName, jaName) => {
    const original = Object.freeze({ id, name })
    for (const query of [id.toLowerCase(), name.toUpperCase(), zhName, jaName, zhName.slice(1), jaName.slice(1)]) {
      expect(matchesProductSearch(original, query)).toBe(true)
    }
    expect(matchesProductSearch(original, 'not-a-product')).toBe(false)
  })

  it('normalizes width, case, and surrounding whitespace for fuzzy search', () => {
    expect(matchesProductSearch({ id: 'P001', name: 'Laptop' }, '  ｐ００１  ')).toBe(true)
    expect(matchesProductSearch({ id: 'P001', name: 'Laptop' }, 'ＬＡＰ')).toBe(true)
    expect(matchesProductSearch({ id: 'P005', name: 'Desk Lamp' }, 'ﾃﾞｽｸ')).toBe(true)
    expect(matchesProductSearch({ id: 'P001', name: 'Laptop' }, '   ')).toBe(true)
  })

  it('searches custom names in every saved language regardless of the interface language', () => {
    const custom = Object.freeze({ id: 'P910', name: 'Ceramic Travel Cup', nameJa: '陶器のトラベルカップ', nameZh: '陶瓷随行杯' })
    for (const query of ['ｐ９１０', 'TRAVEL', 'トラベル', 'ﾄﾗﾍﾞﾙ', '随行']) {
      expect(matchesProductSearch(custom, query)).toBe(true)
    }
    expect(matchesProductSearch(custom, 'ノートパソコン')).toBe(false)
    expect(matchesProductSearch({ id: 'P910', name: 'Ceramic Travel Cup', nameJa: '' }, 'Cup')).toBe(true)
  })

  it('never gives renamed or ID-conflicting products stale translated search aliases', () => {
    expect(matchesProductSearch({ id: 'P001', name: 'Custom workstation' }, '笔记本电脑')).toBe(false)
    expect(matchesProductSearch({ id: 'P001', name: 'Desk Lamp' }, 'ノートパソコン')).toBe(false)
    expect(matchesProductSearch({ id: 'CUSTOM-1', name: 'Laptop' }, '笔记本电脑')).toBe(false)
    expect(matchesProductSearch({ id: 'CUSTOM-1', name: 'Custom workstation' }, 'WORKSTATION')).toBe(true)
    expect(matchesProductSearch({ id: 'P001', name: 'Custom workstation' }, 'p001')).toBe(true)
  })

  it('filters categories while retaining server order', () => {
    const products = coreProducts.map(([id, name]) => product(id, name))
    expect(selectCatalogProducts(products, 'travel', 'default').map(({ id }) => id)).toEqual(['P013', 'P014', 'P015', 'P016'])
    expect(selectCatalogProducts([...products, product('CUSTOM-1', 'New item')], 'other', 'default').map(({ id }) => id)).toEqual(['CUSTOM-1'])
  })

  it('compares prices exactly beyond Number precision and does not mutate input', () => {
    const expensive = product('P001', 'Laptop', '9007199254740993')
    const cheaper = product('P005', 'Desk Lamp', '9007199254740992')
    const least = product('CUSTOM-1', 'Accessory', '999')
    const products = Object.freeze([expensive, cheaper, least])
    expect(selectCatalogProducts(products, 'all', 'priceAsc')).toEqual([least, cheaper, expensive])
    expect(selectCatalogProducts(products, 'all', 'priceDesc')).toEqual([expensive, cheaper, least])
    expect(selectCatalogProducts(products, 'all', 'default')).toEqual([expensive, cheaper, least])
    expect(products).toEqual([expensive, cheaper, least])
  })

  it('preserves server order for equal prices', () => {
    const products = [product('P005', 'Desk Lamp'), product('P001', 'Laptop')]
    expect(selectCatalogProducts(products, 'all', 'priceAsc')).toEqual(products)
    expect(selectCatalogProducts(products, 'all', 'priceDesc')).toEqual(products)
  })
})
