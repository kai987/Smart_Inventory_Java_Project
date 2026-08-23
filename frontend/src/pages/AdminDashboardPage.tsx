import { useQueries } from '@tanstack/react-query'
import { Archive, Boxes, CircleDollarSign, Package, ShoppingCart, TriangleAlert, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { adminApi } from '../api/adminApi'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import { queryKeys } from '../app/queryClient'
import { ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { formatYen } from '../utils/currency'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

export default function AdminDashboardPage() {
  const [summary, products, orders] = useQueries({
    queries: [
      { queryKey: queryKeys.adminSummary, queryFn: adminApi.summary },
      { queryKey: queryKeys.products({ q: '', inStockOnly: false }), queryFn: ({ signal }) => productApi.list({ q: '', inStockOnly: false }, signal) },
      { queryKey: queryKeys.adminOrders(''), queryFn: ({ signal }) => orderApi.all('', signal) },
    ],
  })

  const retryAll = () => { void Promise.all([summary.refetch(), products.refetch(), orders.refetch()]) }
  if (summary.isLoading || products.isLoading || orders.isLoading) return <><h1>Inventory overview</h1><SkeletonRows rows={4} /></>
  if (summary.isError || products.isError || orders.isError || summary.data === undefined || products.data === undefined || orders.data === undefined) {
    return <><h1>Inventory overview</h1><ErrorState message="Dashboard data is unavailable." onRetry={retryAll} /></>
  }

  const lowStock = products.data.items.filter((product) => product.stock <= summary.data.lowStockThreshold)
  const latestOrders = orders.data.items.slice(-5).reverse()
  const metrics = [
    { label: 'Products', value: String(summary.data.productCount), icon: Package },
    { label: 'Total stock', value: String(summary.data.totalStock), icon: Boxes },
    { label: 'Orders', value: String(summary.data.orderCount), icon: ShoppingCart },
    { label: 'Customers', value: String(summary.data.customerCount), icon: Users },
    { label: 'Low stock', value: String(summary.data.lowStockCount), icon: TriangleAlert },
    { label: 'Inventory value', value: formatYen(summary.data.inventoryValueYen), icon: CircleDollarSign },
  ]

  return (
    <div>
      <div className={pageStyles.pageHeader}><div><h1>Inventory overview</h1><p>Current operational data from the saved inventory and orders.</p></div></div>
      <section className={styles.metricGrid} aria-label="Inventory metrics">
        {metrics.map(({ label, value, icon: Icon }) => (
          <article className={styles.metricCard} key={label}>
            <span className={styles.metricIcon}><Icon aria-hidden="true" /></span>
            <div><span>{label}</span><strong>{value}</strong></div>
          </article>
        ))}
      </section>
      <div className={styles.dashboardPanels}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><h2>Latest saved orders</h2><Link to="/admin/orders">View all</Link></header>
          {latestOrders.length === 0 ? (
            <div className={styles.emptyPanel}><Archive aria-hidden="true" /><span>No saved orders yet.</span></div>
          ) : (
            <div className={styles.miniList}>
              {latestOrders.map((order) => <div className={styles.miniRow} key={order.orderId}><strong>{order.orderId}</strong><span>{order.customerName}</span><b>{formatYen(order.totalPriceYen)}</b></div>)}
            </div>
          )}
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><h2>Low-stock products</h2><Link to="/admin/products">Manage</Link></header>
          {lowStock.length === 0 ? (
            <div className={styles.emptyPanel}><Archive aria-hidden="true" /><span>No products are below the threshold.</span></div>
          ) : (
            <div className={styles.miniList}>
              {lowStock.map((product) => <div className={styles.miniRow} key={product.id}><strong>{product.name}</strong><span>{product.id}</span><b>{product.stock} left</b></div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
