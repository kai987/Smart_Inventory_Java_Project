import { Package, ShoppingCart, Weight } from 'lucide-react'
import type { Product } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { formatYen } from '../../utils/currency'
import styles from './products.module.css'

export function ProductList({ products, canAdd, onAdd }: { products: Product[]; canAdd: boolean; onAdd: (product: Product) => void }) {
  return (
    <div className={styles.productList}>
      {products.map((product) => (
        <article className={styles.productRow} key={product.id}>
          <div className={styles.identity}>
            <span className={styles.productIcon}><Package aria-hidden="true" /></span>
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
              icon={<ShoppingCart />}
              disabled={!product.available || product.stock === 0}
              onClick={() => onAdd(product)}
            >
              {product.stock === 0 ? 'Out of stock' : 'Add to cart'}
            </Button>
          ) : null}
        </article>
      ))}
    </div>
  )
}
