import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { orderApi } from '../api/orderApi'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { ProductImage } from '../features/products/ProductImage'
import { OrderPagination, ORDER_PAGE_SIZE, orderPageCount } from '../features/orders/OrderPagination'
import { useProductNames } from '../features/products/useProductNames'
import { useLocaleFormatters } from '../i18n/formatters'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

export default function AdminOrdersPage() {
  const { user } = useAuth()
  return <AdminOrderHistory key={JSON.stringify([user?.username, user?.role])} />
}

function AdminOrderHistory() {
  const { t } = useTranslation()
  const [customer, setCustomer] = useState('')
  useLocalizedDocumentTitle('admin.ordersTitle')
  return (
    <div>
      <div className={pageStyles.pageHeader}><div><h1>{t('admin.ordersTitle')}</h1><p>{t('admin.ordersIntro')}</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.toolbarSearch}>
          <span className="srOnly">{t('admin.filterCustomer')}</span><Search aria-hidden="true" />
          <input type="search" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder={t('admin.filterCustomer')} />
        </label>
      </div>
      <AdminOrderResults key={customer.trim()} customer={customer.trim()} />
    </div>
  )
}

function AdminOrderResults({ customer }: { customer: string }) {
  const { t } = useTranslation()
  const productName = useProductNames()
  const { user, runProtectedRequest, isChangingSession } = useAuth()
  const { formatNumber, formatWeight, formatYen } = useLocaleFormatters()
  const [page, setPage] = useState(1)
  const paging = { page, size: ORDER_PAGE_SIZE, sort: 'asc' as const }
  const orders = useQuery({
    queryKey: queryKeys.adminOrders(user?.username ?? '', customer, paging),
    queryFn: ({ signal }) => runProtectedRequest((scope) => orderApi.all(customer, AbortSignal.any([signal, scope]), paging)),
    enabled: user?.role === 'ADMIN' && !isChangingSession,
  })
  const lastPage = orderPageCount(orders.data?.total ?? 0)
  const clamping = orders.data !== undefined && !orders.isFetching && !orders.isError && page > lastPage
  if (clamping) setPage(lastPage)

  return (
    <>
      {orders.isLoading || clamping ? <SkeletonRows rows={4} /> : null}
      {orders.isError ? <ErrorState message={t('admin.orderLoadError')} onRetry={() => void orders.refetch()} /> : null}
      {!clamping && !orders.isError && orders.data?.total === 0 ? <EmptyState title={t('admin.noOrdersTitle')} description={customer === '' ? t('admin.noOrdersDescription') : t('admin.noMatchingOrdersDescription')} /> : null}
      {!clamping && !orders.isError && orders.data !== undefined && orders.data.items.length > 0 ? (
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
                    <div><span>{t('admin.product')}</span><div className={styles.adminOrderProduct}><ProductImage productId={item.productId} productName={item.productName} imageUrl={item.productImageUrl} variant="order" alt="" /><strong>{productName(item.productId, item.productName, { nameJa: item.productNameJa, nameZh: item.productNameZh })} · {item.productId}</strong></div></div>
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
      <OrderPagination page={page} total={orders.isError ? undefined : orders.data?.total}
        busy={orders.isFetching || clamping || isChangingSession} onPageChange={setPage} />
    </>
  )
}
