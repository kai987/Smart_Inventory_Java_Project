import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n/I18nProvider'
import { createI18nInstance } from '../../i18n/i18n'
import type { AppLanguage } from '../../i18n/language'
import { ProductImage } from './ProductImage'
import styles from './ProductImage.module.css'
import { getProductImagePath } from './productImages'

function renderProductImage(ui: ReactElement, language: AppLanguage = 'en') {
  const instance = createI18nInstance(language)
  const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider instance={instance}>{children}</I18nProvider>
  return render(ui, { wrapper })
}

describe('ProductImage', () => {
  it('maps P001 to the local laptop image', () => {
    renderProductImage(<ProductImage productId="P001" productName="Laptop" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Laptop product' })).toHaveAttribute('src', '/product-images/laptop.webp')
  })

  it.each([
    ['ja', 'ノートパソコンの商品画像'],
    ['zh-CN', '笔记本电脑 的商品图片'],
  ] as const)('localizes the default accessible name in %s without losing the photograph', (language, label) => {
    renderProductImage(<ProductImage productId="P001" productName="Laptop" variant="catalog" />, language)
    expect(screen.getByRole('img', { name: label })).toHaveAttribute('src', '/product-images/laptop.webp')
  })

  it('preserves explicit alternative text and decorative image semantics', () => {
    const { rerender, container } = renderProductImage(<ProductImage productId="P001" productName="Laptop" variant="catalog" alt="Custom description" />)
    expect(screen.getByRole('img', { name: 'Custom description' })).toHaveAttribute('src', '/product-images/laptop.webp')
    rerender(<ProductImage productId="P001" productName="Laptop" variant="catalog" alt="" />)
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('maps P002 to the local mouse image', () => {
    renderProductImage(<ProductImage productId="P002" productName="Mouse" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('src', '/product-images/mouse.webp')
  })

  it('maps P003 to the local keyboard image', () => {
    renderProductImage(<ProductImage productId="P003" productName="Keyboard" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Keyboard product' })).toHaveAttribute('src', '/product-images/keyboard.webp')
  })

  it('maps P004 to the local monitor image', () => {
    renderProductImage(<ProductImage productId="P004" productName="Monitor" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Monitor product' })).toHaveAttribute('src', '/product-images/monitor.webp')
  })

  it.each([
    ['P005', 'Desk Lamp', 'desk-lamp'],
    ['P006', 'Robot Vacuum', 'robot-vacuum'],
    ['P007', 'Desk Fan', 'desk-fan'],
    ['P008', 'Digital Alarm Clock', 'digital-alarm-clock'],
    ['P009', 'Electric Kettle', 'electric-kettle'],
    ['P010', 'Frying Pan', 'frying-pan'],
    ['P011', 'Stainless Steel Bottle', 'stainless-steel-bottle'],
    ['P012', 'Digital Kitchen Scale', 'digital-kitchen-scale'],
    ['P013', 'Travel Backpack', 'travel-backpack'],
    ['P014', 'Cabin Suitcase', 'cabin-suitcase'],
    ['P015', 'Compact Umbrella', 'compact-umbrella'],
    ['P016', 'Toiletry Bag', 'toiletry-bag'],
    ['P017', 'Yoga Mat', 'yoga-mat'],
    ['P018', 'Dumbbell Set', 'dumbbell-set'],
    ['P019', 'Jump Rope', 'jump-rope'],
    ['P020', 'Basketball', 'basketball'],
    ['P021', 'Notebook Set', 'notebook-set'],
    ['P022', 'Gel Pen Set', 'gel-pen-set'],
    ['P023', 'Desk Organizer', 'desk-organizer'],
    ['P024', 'Pencil Case', 'pencil-case'],
  ])('maps %s to its matching local catalog photograph', (productId, productName, basename) => {
    renderProductImage(<ProductImage productId={productId} productName={productName} variant="catalog" />)
    const image = screen.getByRole('img', { name: `${productName} product` })
    expect(image).toHaveAttribute('src', `/product-images/${basename}.webp`)
    expect(image).toHaveAttribute('width', '720')
    expect(image).toHaveAttribute('height', '540')
  })

  it('keeps ID-only lookups compatible and accepts canonical names case-insensitively', () => {
    expect(getProductImagePath('P005')).toBe('/product-images/desk-lamp.webp')
    expect(getProductImagePath(' p005 ', ' desk lamp ')).toBe('/product-images/desk-lamp.webp')
  })

  it('does not apply a catalog photograph to a custom product reusing a catalog ID', () => {
    expect(getProductImagePath('P005', 'Custom Handmade Mug')).toBeNull()
    renderProductImage(<ProductImage productId="P005" productName="Custom Handmade Mug" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Custom Handmade Mug product' })).not.toBeInstanceOf(HTMLImageElement)
  })

  it('preserves compact dimensions outside the catalog', () => {
    const { rerender } = renderProductImage(<ProductImage productId="P002" productName="Mouse" variant="cart" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('width', '72')
    rerender(<ProductImage productId="P002" productName="Mouse" variant="admin" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('width', '48')
    rerender(<ProductImage productId="P002" productName="Mouse" variant="order" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('width', '44')
  })

  it('shows a stable fallback for an unknown product ID', () => {
    renderProductImage(<ProductImage productId="P999" productName="Unknown" variant="cart" />)
    const fallback = screen.getByRole('img', { name: 'Unknown product' })
    expect(fallback).not.toBeInstanceOf(HTMLImageElement)
    expect(fallback).toHaveAttribute('data-variant', 'cart')
  })

  it.each([
    ['ja', '陶器カップの商品画像'],
    ['zh-CN', '陶瓷杯 的商品图片'],
  ] as const)('uses a saved custom name for fallback accessibility in %s', (language, label) => {
    renderProductImage(<ProductImage productId="P910" productName="Ceramic Cup" nameJa="陶器カップ" nameZh="陶瓷杯" variant="catalog" />, language)
    expect(screen.getByRole('img', { name: label })).not.toBeInstanceOf(HTMLImageElement)
  })

  it('keeps the canonical photo identity while using an overridden localized alternative name', () => {
    renderProductImage(<ProductImage productId="P001" productName="Laptop" nameJa="業務用ノートPC" variant="catalog" />, 'ja')
    expect(screen.getByRole('img', { name: '業務用ノートPCの商品画像' })).toHaveAttribute('src', '/product-images/laptop.webp')
  })

  it('replaces an image with the fallback after a load error', () => {
    renderProductImage(<ProductImage productId="P001" productName="Laptop" variant="catalog" />)
    fireEvent.error(screen.getByRole('img', { name: 'Laptop product' }))
    const fallback = screen.getByRole('img', { name: 'Laptop product' })
    expect(fallback).not.toBeInstanceOf(HTMLImageElement)
    expect(screen.queryByAltText('Laptop product')).not.toBeInTheDocument()
  })

  it('never renders an external image URL', () => {
    const { container, rerender } = renderProductImage(<ProductImage productId="P004" productName="Monitor" variant="admin" />)
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^\/product-images\/[a-z]+\.webp$/)
    rerender(<ProductImage productId="https://example.com/tracker.png" productName="Remote" variant="admin" />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('applies the requested variant class', () => {
    renderProductImage(<ProductImage productId="P002" productName="Mouse" variant="order" />)
    expect(screen.getByRole('img', { name: 'Mouse product' }).parentElement).toHaveClass(styles.order)
  })
})
