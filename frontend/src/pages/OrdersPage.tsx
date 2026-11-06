import { useQuery } from '@tanstack/react-query'
import { ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { orderApi } from '../api/orderApi'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { Button } from '../components/ui/Button'
import { OrderCard } from '../features/orders/OrderCard'
import { OrderPagination, ORDER_PAGE_SIZE, orderPageCount } from '../features/orders/OrderPagination'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import orderStyles from '../features/orders/orders.module.css'
import pageStyles from './pages.module.css'

export function OrdersPage() {
  const { user } = useAuth()
  return <CustomerOrderHistory key={JSON.stringify([user?.username, user?.role])} />
}

function CustomerOrderHistory() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, runProtectedRequest, isChangingSession } = useAuth()
  const [selection, setSelection] = useState<{ page: number; latestNavigation: string | null }>({ page: 1, latestNavigation: null })
  const navigationState: unknown = location.state
  const latestNavigation = user?.role === 'CUSTOMER' && typeof navigationState === 'object' && navigationState !== null
    && 'showLatest' in navigationState && navigationState.showLatest === true
    && 'username' in navigationState && navigationState.username === user.username ? location.key : null
  const selectingLatest = latestNavigation !== null && selection.latestNavigation !== latestNavigation
  const paging = { page: selection.page, size: ORDER_PAGE_SIZE, sort: 'asc' as const }
  useLocalizedDocumentTitle('orders.title')
  const orders = useQuery({
    queryKey: queryKeys.myOrders(user?.username ?? '', user?.role ?? 'CUSTOMER', paging),
    queryFn: ({ signal }) => runProtectedRequest((scope) => orderApi.mine(AbortSignal.any([signal, scope]), paging)),
    enabled: user !== null && !isChangingSession,
  })
  const settled = orders.data !== undefined && !orders.isFetching && !orders.isError
  const lastPage = orderPageCount(orders.data?.total ?? 0)
  const clamping = settled && selection.page > lastPage
  // Conditional same-component reconciliation avoids rendering an incorrect empty
  // page, and never selects from a stale response that is still being refreshed.
  if (settled && (selectingLatest || clamping)) {
    setSelection({ page: lastPage, latestNavigation: latestNavigation ?? selection.latestNavigation })
  }
  const resolving = !orders.isError && (selectingLatest || clamping)

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>{t('orders.title')}</h1><p>{t('orders.intro')}</p></div>
      </div>
      {orders.isLoading || resolving ? <SkeletonRows rows={3} /> : null}
      {orders.isError ? <ErrorState message={t('orders.loadError')} onRetry={() => void orders.refetch()} /> : null}
      {!resolving && !orders.isError && orders.data?.total === 0 ? (
        <EmptyState title={t('orders.noOrdersTitle')} description={t('orders.noOrdersDescription')} action={<Button type="button" icon={<ShoppingBag />} onClick={() => navigate('/products')}>{t('cart.browseProducts')}</Button>} />
      ) : null}
      {!resolving && !orders.isError && orders.data !== undefined && orders.data.items.length > 0 ? (
        <section className={orderStyles.ordersList} aria-label={t('orders.ordersLabel')}>
          {orders.data.items.map((order) => <OrderCard order={order} key={order.orderId} />)}
        </section>
      ) : null}
      <OrderPagination page={selection.page} total={orders.isError ? undefined : orders.data?.total}
        busy={orders.isFetching || resolving || isChangingSession}
        onPageChange={(page) => setSelection((current) => ({ ...current, page }))} />
    </div>
  )
}
