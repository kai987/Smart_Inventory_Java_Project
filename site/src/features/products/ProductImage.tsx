import { Package } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getProductImagePath } from './productImages'
import styles from './ProductImage.module.css'

export type ProductImageVariant = 'catalog' | 'cart' | 'admin' | 'order'

type ProductImageProps = {
  productId: string
  productName: string
  variant: ProductImageVariant
  className?: string
  alt?: string
  priority?: boolean
}

const imageDimensions: Record<ProductImageVariant, { width: number; height: number }> = {
  catalog: { width: 112, height: 84 },
  cart: { width: 72, height: 54 },
  admin: { width: 48, height: 36 },
  order: { width: 44, height: 33 },
}

export function ProductImage({
  productId,
  productName,
  variant,
  className = '',
  alt,
  priority = false,
}: ProductImageProps) {
  const { t } = useTranslation()
  const source = getProductImagePath(productId)
  const [loadedSource, setLoadedSource] = useState<string | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const accessibleText = alt ?? t('accessibility.productImage', { productName })
  const dimensions = imageDimensions[variant]
  const frameClassName = `${styles.frame} ${styles[variant]} ${className}`
  const shouldShowFallback = source === null || failedSource === source

  if (shouldShowFallback) {
    const fallbackIcon = <Package aria-hidden="true" />
    if (accessibleText === '') {
      return (
        <span className={`${frameClassName} ${styles.fallback}`} data-variant={variant} aria-hidden="true">
          {fallbackIcon}
        </span>
      )
    }
    return (
      <span className={`${frameClassName} ${styles.fallback}`} data-variant={variant} role="img" aria-label={accessibleText}>
        {fallbackIcon}
      </span>
    )
  }

  const loaded = loadedSource === source
  return (
    <span className={frameClassName} data-variant={variant}>
      <img
        key={source}
        className={`${styles.image} ${loaded ? styles.loaded : ''}`}
        src={source}
        alt={accessibleText}
        width={dimensions.width}
        height={dimensions.height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoadedSource(source)}
        onError={() => setFailedSource(source)}
      />
    </span>
  )
}
