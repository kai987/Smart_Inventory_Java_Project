import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { orderApi } from '../api/orderApi'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useLocaleFormatters } from '../i18n/formatters'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

export default function AdminOrdersPage() {
  const { t } = useTranslation()
  const { user, runProtectedRequest, isChangingSession } = useAuth()
  const { formatNumber, formatWeight, formatYen } = useLocaleFormatters()
  const [customer, setCustomer] = useState('')
  const deferredCustomer = useDeferredValue(customer.trim())
  useLocalizedDocumentTitle('admin.ordersTitle')
  const orders = useQuery({
    queryKey: queryKeys.adminOrders(user?.username ?? '', deferredCustomer),
    queryFn: ({ signal }) => runProtectedRequest((scope) => orderApi.all(deferredCustomer, AbortSignal.any([signal, scope]))),
    enabled: user?.role === 'ADMIN' && !isChangingSession,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === user?.username ? previous : undefined,
  })

  return (
    <div>
      <div className={pageStyles.pageHeader}><div><h1>{t('admin.ordersTitle')}</h1><p>{t('admin.ordersIntro')}</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.toolbarSearch}>
          <span className="srOnly">{t('admin.filterCustomer')}</span><Search aria-hidden="true" />
          <input type="search" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder={t('admin.filterCustomer')} />
        </label>
      </div>
      {orders.isLoading ? <SkeletonRows rows={4} /> : null}
      {orders.isError ? <ErrorState message={t('admin.orderLoadError')} onRetry={() => void orders.refetch()} /> : null}
      {orders.data?.items.length === 0 ? <EmptyState title={t('admin.noOrdersTitle')} description={customer.trim() === '' ? t('admin.noOrdersDescription') : t('admin.noMatchingOrdersDescription')} /> : null}
      {orders.data !== undefined && orders.data.items.length > 0 ? (
        <section className={styles.adminOrderList} aria-label={t('admin.savedOrdersLabel')}>
          {orders.data.items.map((order) => (
            <details className={styles.adminOrder} key={order.orderId}>
              <summary>
                <div><span>{t('admin.orderId')}</span><strong>{order.orderId}</strong></div>
                <div><span>{t('admin.customer')}</span><strong>{order.customerName}</strong></div>
                <div><span>{t('admin.total')}</span><strong>{formatYen(order.totalPriceYen)}</strong></div>
                <div><span>{t('admin.weight')}</span><strong>{formatWeight(order.totalWeightKg)}</strong></div>
                <div><span>{t('admin.boxes')}</span><strong>{formatNumber(order.estimatedBoxes)}</strong></div>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className={styles.adminOrderItems}>
                {order.items.map((item) => (
                  <div className={styles.adminOrderItem} key={item.productId}>
                    <div><span>{t('admin.product')}</span><strong>{item.productName} · {item.productId}</strong></div>
                    <div><span>{t('admin.unitPrice')}</span><strong>{formatYen(item.unitPriceYen)}</strong></div>
                    <div><span>{t('admin.quantity')}</span><strong>{formatNumber(item.quantity)}</strong></div>
                    <div><span>{t('admin.subtotal')}</span><strong>{formatYen(item.subtotalYen)}</strong></div>
                    <div><span>{t('admin.weight')}</span><strong>{formatWeight(item.totalWeightKg)}</strong></div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  )
}
