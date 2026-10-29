import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProductImage } from './ProductImage'
import styles from './ProductImage.module.css'
import { getProductImagePath } from './productImages'

describe('ProductImage', () => {
  it('maps P001 to the local laptop image', () => {
    render(<ProductImage productId="P001" productName="Laptop" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Laptop product' })).toHaveAttribute('src', '/product-images/laptop.webp')
  })

  it('maps P002 to the local mouse image', () => {
    render(<ProductImage productId="P002" productName="Mouse" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('src', '/product-images/mouse.webp')
  })

  it('maps P003 to the local keyboard image', () => {
    render(<ProductImage productId="P003" productName="Keyboard" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Keyboard product' })).toHaveAttribute('src', '/product-images/keyboard.webp')
  })

  it('maps P004 to the local monitor image', () => {
    render(<ProductImage productId="P004" productName="Monitor" variant="catalog" />)
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
    render(<ProductImage productId={productId} productName={productName} variant="catalog" />)
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
    render(<ProductImage productId="P005" productName="Custom Handmade Mug" variant="catalog" />)
    expect(screen.getByRole('img', { name: 'Custom Handmade Mug product' })).not.toBeInstanceOf(HTMLImageElement)
  })

  it('preserves compact dimensions outside the catalog', () => {
    const { rerender } = render(<ProductImage productId="P002" productName="Mouse" variant="cart" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('width', '72')
    rerender(<ProductImage productId="P002" productName="Mouse" variant="admin" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('width', '48')
    rerender(<ProductImage productId="P002" productName="Mouse" variant="order" />)
    expect(screen.getByRole('img', { name: 'Mouse product' })).toHaveAttribute('width', '44')
  })

  it('shows a stable fallback for an unknown product ID', () => {
    render(<ProductImage productId="P999" productName="Unknown" variant="cart" />)
    const fallback = screen.getByRole('img', { name: 'Unknown product' })
    expect(fallback).not.toBeInstanceOf(HTMLImageElement)
    expect(fallback).toHaveAttribute('data-variant', 'cart')
  })

  it('replaces an image with the fallback after a load error', () => {
    render(<ProductImage productId="P001" productName="Laptop" variant="catalog" />)
    fireEvent.error(screen.getByRole('img', { name: 'Laptop product' }))
    const fallback = screen.getByRole('img', { name: 'Laptop product' })
    expect(fallback).not.toBeInstanceOf(HTMLImageElement)
    expect(screen.queryByAltText('Laptop product')).not.toBeInTheDocument()
  })

  it('never renders an external image URL', () => {
    const { container, rerender } = render(<ProductImage productId="P004" productName="Monitor" variant="admin" />)
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^\/product-images\/[a-z]+\.webp$/)
    rerender(<ProductImage productId="https://example.com/tracker.png" productName="Remote" variant="admin" />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('applies the requested variant class', () => {
    render(<ProductImage productId="P002" productName="Mouse" variant="order" />)
    expect(screen.getByRole('img', { name: 'Mouse product' }).parentElement).toHaveClass(styles.order)
  })
})
