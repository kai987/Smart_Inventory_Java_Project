import { useQuery } from '@tanstack/react-query'
import { ShoppingBag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { orderApi } from '../api/orderApi'
import { queryKeys } from '../app/queryClient'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { Button } from '../components/ui/Button'
import { OrderCard } from '../features/orders/OrderCard'
import orderStyles from '../features/orders/orders.module.css'
import pageStyles from './pages.module.css'

export function OrdersPage() {
  const navigate = useNavigate()
  const orders = useQuery({ queryKey: queryKeys.myOrders, queryFn: orderApi.mine })

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>My orders</h1><p>Each order preserves the product details used when it was placed.</p></div>
      </div>
      {orders.isLoading ? <SkeletonRows rows={3} /> : null}
      {orders.isError ? <ErrorState message="Your order history is unavailable." onRetry={() => void orders.refetch()} /> : null}
      {orders.data?.items.length === 0 ? (
        <EmptyState title="No orders yet" description="Your completed orders will appear here." action={<Button type="button" icon={<ShoppingBag />} onClick={() => navigate('/products')}>Browse products</Button>} />
      ) : null}
      {orders.data !== undefined && orders.data.items.length > 0 ? (
        <section className={orderStyles.ordersList} aria-label="Your orders">
          {orders.data.items.map((order) => <OrderCard order={order} key={order.orderId} />)}
        </section>
      ) : null}
    </div>
  )
}
