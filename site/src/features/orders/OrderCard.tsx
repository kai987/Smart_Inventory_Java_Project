import { ChevronDown, Package } from 'lucide-react'
import type { Order } from '../../api/types'
import { formatYen } from '../../utils/currency'
import styles from './orders.module.css'

export function OrderCard({ order }: { order: Order }) {
  return (
    <article className={styles.orderCard}>
      <div className={styles.orderSummary}>
        <div>
          <span className={styles.overline}>Order ID</span>
          <strong className={styles.orderId}>{order.orderId}</strong>
        </div>
        <dl>
          <div><dt>Items</dt><dd>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</dd></div>
          <div><dt>Total</dt><dd>{formatYen(order.totalPriceYen)}</dd></div>
          <div><dt>Weight</dt><dd>{order.totalWeightKg.toFixed(2)} kg</dd></div>
          <div><dt>Boxes</dt><dd>{order.estimatedBoxes}</dd></div>
        </dl>
      </div>
      <details className={styles.orderDetails}>
        <summary>View item snapshots <ChevronDown aria-hidden="true" /></summary>
        <div className={styles.snapshotList}>
          {order.items.map((item) => (
            <div className={styles.snapshot} key={item.productId}>
              <span className={styles.snapshotIcon}><Package aria-hidden="true" /></span>
              <div className={styles.snapshotName}><strong>{item.productName}</strong><span>{item.productId}</span></div>
              <div><span>Unit price</span><strong>{formatYen(item.unitPriceYen)}</strong></div>
              <div><span>Quantity</span><strong>{item.quantity}</strong></div>
              <div><span>Subtotal</span><strong>{formatYen(item.subtotalYen)}</strong></div>
              <div><span>Weight</span><strong>{item.totalWeightKg.toFixed(2)} kg</strong></div>
            </div>
          ))}
        </div>
      </details>
    </article>
  )
}
