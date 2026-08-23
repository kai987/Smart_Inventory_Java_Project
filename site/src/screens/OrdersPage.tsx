import { useQuery } from '@tanstack/react-query'
import { ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { orderApi } from '../api/orderApi'
import { queryKeys } from '../app/queryClient'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { Button } from '../components/ui/Button'
import { OrderCard } from '../features/orders/OrderCard'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import orderStyles from '../features/orders/orders.module.css'
import pageStyles from './pages.module.css'

export function OrdersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  useLocalizedDocumentTitle('orders.title')
  const orders = useQuery({ queryKey: queryKeys.myOrders, queryFn: orderApi.mine })

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>{t('orders.title')}</h1><p>{t('orders.intro')}</p></div>
      </div>
      {orders.isLoading ? <SkeletonRows rows={3} /> : null}
      {orders.isError ? <ErrorState message={t('orders.loadError')} onRetry={() => void orders.refetch()} /> : null}
      {orders.data?.items.length === 0 ? (
        <EmptyState title={t('orders.noOrdersTitle')} description={t('orders.noOrdersDescription')} action={<Button type="button" icon={<ShoppingBag />} onClick={() => navigate('/products')}>{t('cart.browseProducts')}</Button>} />
      ) : null}
      {orders.data !== undefined && orders.data.items.length > 0 ? (
        <section className={orderStyles.ordersList} aria-label={t('orders.ordersLabel')}>
          {orders.data.items.map((order) => <OrderCard order={order} key={order.orderId} />)}
        </section>
      ) : null}
    </div>
  )
}
