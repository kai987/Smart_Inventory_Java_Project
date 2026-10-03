import { useQueries } from '@tanstack/react-query'
import { Archive, Boxes, CircleDollarSign, Package, ShoppingCart, TriangleAlert, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { adminApi } from '../api/adminApi'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useLocaleFormatters } from '../i18n/formatters'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

export default function AdminDashboardPage() {
  const { t } = useTranslation()
  const { user, runProtectedRequest, isChangingSession } = useAuth()
  const { formatNumber, formatYen } = useLocaleFormatters()
  useLocalizedDocumentTitle('admin.dashboardTitle')
  const [summary, products, orders] = useQueries({
    queries: [
      { queryKey: queryKeys.adminSummary(user?.username ?? ''), queryFn: ({ signal }) => runProtectedRequest((scope) => adminApi.summary(AbortSignal.any([signal, scope]))), enabled: user?.role === 'ADMIN' && !isChangingSession },
      { queryKey: queryKeys.products({ q: '', inStockOnly: false }), queryFn: ({ signal }) => productApi.list({ q: '', inStockOnly: false }, signal) },
      { queryKey: queryKeys.adminOrders(user?.username ?? '', ''), queryFn: ({ signal }) => runProtectedRequest((scope) => orderApi.all('', AbortSignal.any([signal, scope]))), enabled: user?.role === 'ADMIN' && !isChangingSession },
    ],
  })

  const retryAll = () => { void Promise.all([summary.refetch(), products.refetch(), orders.refetch()]) }
  if (summary.isLoading || products.isLoading || orders.isLoading) return <><h1>{t('admin.dashboardTitle')}</h1><SkeletonRows rows={4} /></>
  if (summary.isError || products.isError || orders.isError || summary.data === undefined || products.data === undefined || orders.data === undefined) {
    return <><h1>{t('admin.dashboardTitle')}</h1><ErrorState message={t('admin.dashboardLoadError')} onRetry={retryAll} /></>
  }

  const lowStock = products.data.items.filter((product) => product.stock <= summary.data.lowStockThreshold)
  const latestOrders = orders.data.items.slice(-5).reverse()
  const metrics = [
    { id: 'products', label: t('admin.productCount'), value: formatNumber(summary.data.productCount), icon: Package },
    { id: 'stock', label: t('admin.totalStock'), value: formatNumber(summary.data.totalStock), icon: Boxes },
    { id: 'orders', label: t('admin.orderCount'), value: formatNumber(summary.data.orderCount), icon: ShoppingCart },
    { id: 'customers', label: t('admin.customerCount'), value: formatNumber(summary.data.customerCount), icon: Users },
    { id: 'low-stock', label: t('admin.lowStockCount'), value: formatNumber(summary.data.lowStockCount), icon: TriangleAlert },
    { id: 'value', label: t('admin.inventoryValue'), value: formatYen(summary.data.inventoryValueYen), icon: CircleDollarSign },
  ]

  return (
    <div>
      <div className={pageStyles.pageHeader}><div><h1>{t('admin.dashboardTitle')}</h1><p>{t('admin.dashboardIntro')}</p></div></div>
      <section className={styles.metricGrid} aria-label={t('admin.metricsLabel')}>
        {metrics.map(({ id, label, value, icon: Icon }) => (
          <article className={styles.metricCard} key={id}>
            <span className={styles.metricIcon}><Icon aria-hidden="true" /></span>
            <div><span>{label}</span><strong>{value}</strong></div>
          </article>
        ))}
      </section>
      <div className={styles.dashboardPanels}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><h2>{t('admin.latestOrders')}</h2><Link to="/admin/orders">{t('admin.viewAll')}</Link></header>
          {latestOrders.length === 0 ? (
            <div className={styles.emptyPanel}><Archive aria-hidden="true" /><span>{t('admin.noSavedOrders')}</span></div>
          ) : (
            <div className={styles.miniList}>
              {latestOrders.map((order) => <div className={styles.miniRow} key={order.orderId}><strong>{order.orderId}</strong><span>{order.customerName}</span><b>{formatYen(order.totalPriceYen)}</b></div>)}
            </div>
          )}
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><h2>{t('admin.lowStockProducts')}</h2><Link to="/admin/products">{t('admin.manage')}</Link></header>
          {lowStock.length === 0 ? (
            <div className={styles.emptyPanel}><Archive aria-hidden="true" /><span>{t('admin.noLowStock')}</span></div>
          ) : (
            <div className={styles.miniList}>
              {lowStock.map((product) => <div className={styles.miniRow} key={product.id}><strong>{product.name}</strong><span>{product.id}</span><b>{t('admin.stockLeft', { stock: formatNumber(product.stock) })}</b></div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
