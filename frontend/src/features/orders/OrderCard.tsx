import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Order } from '../../api/types'
import { useLocaleFormatters } from '../../i18n/formatters'
import { ProductImage } from '../products/ProductImage'
import styles from './orders.module.css'

export function OrderCard({ order }: { order: Order }) {
  const { t } = useTranslation()
  const { formatYen, formatNumber, formatWeight } = useLocaleFormatters()

  return (
    <article className={styles.orderCard}>
      <div className={styles.orderSummary}>
        <div>
          <span className={styles.overline}>{t('orders.orderId')}</span>
          <strong className={styles.orderId}>{order.orderId}</strong>
        </div>
        <dl>
          <div><dt>{t('orders.items')}</dt><dd>{formatNumber(order.items.reduce((sum, item) => sum + item.quantity, 0))}</dd></div>
          <div><dt>{t('orders.totalPrice')}</dt><dd>{formatYen(order.totalPriceYen)}</dd></div>
          <div><dt>{t('orders.totalWeight')}</dt><dd>{formatWeight(order.totalWeightKg)}</dd></div>
          <div><dt>{t('orders.estimatedBoxes')}</dt><dd>{formatNumber(order.estimatedBoxes)}</dd></div>
        </dl>
      </div>
      <details className={styles.orderDetails}>
        <summary>{t('orders.viewItemSnapshots')} <ChevronDown aria-hidden="true" /></summary>
        <div className={styles.snapshotList}>
          {order.items.map((item) => (
            <div className={styles.snapshot} key={item.productId}>
              <ProductImage productId={item.productId} productName={item.productName} variant="order" alt="" />
              <div className={styles.snapshotName}><strong>{item.productName}</strong><span>{item.productId}</span></div>
              <div><span>{t('orders.unitPrice')}</span><strong>{formatYen(item.unitPriceYen)}</strong></div>
              <div><span>{t('orders.quantity')}</span><strong>{formatNumber(item.quantity)}</strong></div>
              <div><span>{t('orders.subtotal')}</span><strong>{formatYen(item.subtotalYen)}</strong></div>
              <div><span>{t('orders.totalWeight')}</span><strong>{formatWeight(item.totalWeightKg)}</strong></div>
            </div>
          ))}
        </div>
      </details>
    </article>
  )
}
