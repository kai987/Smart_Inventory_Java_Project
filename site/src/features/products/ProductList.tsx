import { Check, ShoppingCart, Weight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Product } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { formatYen } from '../../utils/currency'
import { ProductImage } from './ProductImage'
import styles from './products.module.css'

export function ProductList({ products, canAdd, onAdd }: { products: Product[]; canAdd: boolean; onAdd: (product: Product) => void }) {
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
                <dt>Price</dt>
                <dd>{formatYen(product.priceYen)}</dd>
              </div>
              <div>
                <dt>Stock</dt>
                <dd className={product.stock > 0 ? styles.inStock : styles.outOfStock}>
                  <span aria-hidden="true" /> {product.stock}
                </dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd><Weight aria-hidden="true" /> {product.weightKg} kg</dd>
              </div>
            </dl>
            {canAdd ? (
              <Button
                type="button"
                className={added ? styles.addedButton : ''}
                icon={added ? <Check /> : <ShoppingCart />}
                aria-label={product.stock === 0 ? 'Out of stock' : 'Add to cart'}
                disabled={!product.available || product.stock === 0}
                onClick={() => handleAdd(product)}
              >
                {product.stock === 0 ? 'Out of stock' : added ? 'Added' : 'Add to cart'}
              </Button>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
