import { describe, expect, it } from 'vitest'
import type { Product } from '../../api/types'
import { getProductCategory, selectCatalogProducts, type ProductCategory } from './productCatalog'

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
