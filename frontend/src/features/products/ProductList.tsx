import { Check, ShoppingCart, Weight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Product } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { useLocaleFormatters } from '../../i18n/formatters'
import { ProductImage } from './ProductImage'
import styles from './products.module.css'

export function ProductList({ products, canAdd, onAdd }: { products: Product[]; canAdd: boolean; onAdd: (product: Product) => void }) {
  const { t } = useTranslation()
  const { formatYen, formatNumber, formatWeight } = useLocaleFormatters()
  const [addedProductIds, setAddedProductIds] = useState<ReadonlySet<string>>(() => new Set())
  const feedbackTimers = useRef(new Map<string, number>())

  useEffect(() => {
    const timers = feedbackTimers.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const handleAdd = (product: Product) => {
    onAdd(product)
    setAddedProductIds((current) => new Set(current).add(product.id))

    const previousTimer = feedbackTimers.current.get(product.id)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const timer = window.setTimeout(() => {
      feedbackTimers.current.delete(product.id)
      setAddedProductIds((current) => {
        if (!current.has(product.id)) return current
        const next = new Set(current)
        next.delete(product.id)
        return next
      })
    }, 900)
    feedbackTimers.current.set(product.id, timer)
  }

  return (
    <div className={styles.productList}>
      {products.map((product, index) => {
        const added = addedProductIds.has(product.id)
        return (
          <article className={styles.productRow} key={product.id}>
            <div className={styles.identity}>
              <ProductImage
                productId={product.id}
                productName={product.name}
                variant="catalog"
                className={styles.productImage}
                alt=""
                priority={index < 2}
              />
              <div>
                <h2>{product.name}</h2>
                <span className={styles.productId}>{product.id}</span>
              </div>
            </div>
            <dl className={styles.productFacts}>
              <div className={styles.priceFact}>
                <dt>{t('products.price')}</dt>
                <dd>{formatYen(product.priceYen)}</dd>
              </div>
              <div>
                <dt>{t('products.stock')}</dt>
                <dd className={product.stock > 0 ? styles.inStock : styles.outOfStock}>
                  <span aria-hidden="true" /> {formatNumber(product.stock)}
                </dd>
              </div>
              <div>
                <dt>{t('products.weight')}</dt>
                <dd><Weight aria-hidden="true" /> {formatWeight(product.weightKg)}</dd>
              </div>
            </dl>
            {canAdd ? (
              <Button
                type="button"
                className={added ? styles.addedButton : ''}
                icon={added ? <Check /> : <ShoppingCart />}
                aria-label={product.stock === 0 ? t('products.outOfStock') : t('products.addToCart')}
                disabled={!product.available || product.stock === 0}
                onClick={() => handleAdd(product)}
              >
                {product.stock === 0 ? t('products.outOfStock') : added ? t('products.added') : t('products.addToCart')}
              </Button>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
