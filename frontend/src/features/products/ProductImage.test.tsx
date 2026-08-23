import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProductImage } from './ProductImage'
import styles from './ProductImage.module.css'

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
