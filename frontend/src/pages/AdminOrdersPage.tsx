import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { orderApi } from '../api/orderApi'
import { queryKeys } from '../app/queryClient'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { formatYen } from '../utils/currency'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

export default function AdminOrdersPage() {
  const [customer, setCustomer] = useState('')
  const deferredCustomer = useDeferredValue(customer.trim())
  const orders = useQuery({
    queryKey: queryKeys.adminOrders(deferredCustomer),
    queryFn: ({ signal }) => orderApi.all(deferredCustomer, signal),
    placeholderData: (previous) => previous,
  })

  return (
    <div>
      <div className={pageStyles.pageHeader}><div><h1>Orders</h1><p>Review every saved order and its original product snapshots.</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.toolbarSearch}>
          <span className="srOnly">Filter by customer</span><Search aria-hidden="true" />
          <input type="search" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Filter by customer" />
        </label>
      </div>
      {orders.isLoading ? <SkeletonRows rows={4} /> : null}
      {orders.isError ? <ErrorState message="Order data is unavailable." onRetry={() => void orders.refetch()} /> : null}
      {orders.data?.items.length === 0 ? <EmptyState title="No orders found" description={customer.trim() === '' ? 'Completed orders will appear here.' : 'No saved orders match this customer.'} /> : null}
      {orders.data !== undefined && orders.data.items.length > 0 ? (
        <section className={styles.adminOrderList} aria-label="Saved orders">
          {orders.data.items.map((order) => (
            <details className={styles.adminOrder} key={order.orderId}>
              <summary>
                <div><span>Order ID</span><strong>{order.orderId}</strong></div>
                <div><span>Customer</span><strong>{order.customerName}</strong></div>
                <div><span>Total</span><strong>{formatYen(order.totalPriceYen)}</strong></div>
                <div><span>Weight</span><strong>{order.totalWeightKg.toFixed(2)} kg</strong></div>
                <div><span>Boxes</span><strong>{order.estimatedBoxes}</strong></div>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className={styles.adminOrderItems}>
                {order.items.map((item) => (
                  <div className={styles.adminOrderItem} key={item.productId}>
                    <div><span>Product</span><strong>{item.productName} · {item.productId}</strong></div>
                    <div><span>Unit price</span><strong>{formatYen(item.unitPriceYen)}</strong></div>
                    <div><span>Quantity</span><strong>{item.quantity}</strong></div>
                    <div><span>Subtotal</span><strong>{formatYen(item.subtotalYen)}</strong></div>
                    <div><span>Weight</span><strong>{item.totalWeightKg.toFixed(2)} kg</strong></div>
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
