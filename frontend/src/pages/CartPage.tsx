import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Package, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { orderApi } from '../api/orderApi'
import { productApi } from '../api/productApi'
import { toApiError } from '../api/apiError'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { useCart } from '../cart/CartProvider'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useToast } from '../components/feedback/ToastProvider'
import { Button } from '../components/ui/Button'
import { formatYen, multiplyYen } from '../utils/currency'
import orderStyles from '../features/orders/orders.module.css'
import pageStyles from './pages.module.css'

export function CartPage() {
  const { state, dispatch } = useCart()
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [orderError, setOrderError] = useState<string | null>(null)
  const products = useQuery({
    queryKey: queryKeys.products({ q: '', inStockOnly: false }),
    queryFn: ({ signal }) => productApi.list({ q: '', inStockOnly: false }, signal),
    enabled: state.items.length > 0,
  })

  const productMap = useMemo(
    () => new Map(products.data?.items.map((product) => [product.id, product]) ?? []),
    [products.data],
  )

  useEffect(() => {
    if (products.data === undefined) return
    for (const item of state.items) {
      const product = productMap.get(item.productId)
      if (product !== undefined && product.stock > 0 && item.quantity > product.stock) {
        dispatch({ type: 'setQuantity', productId: item.productId, quantity: product.stock })
        showToast(`${product.name} was adjusted to the available stock (${product.stock}).`, 'info')
      }
    }
  }, [dispatch, productMap, products.data, showToast, state.items])

  const resolvedItems = state.items.map((cartItem) => ({ cartItem, product: productMap.get(cartItem.productId) }))
  const hasUnavailable = resolvedItems.some(({ product }) => product === undefined || product.stock === 0)
  const totalPrice = resolvedItems.reduce(
    (total, { cartItem, product }) => total + (product === undefined ? 0n : multiplyYen(product.priceYen, cartItem.quantity)),
    0n,
  )
  const totalWeight = resolvedItems.reduce(
    (total, { cartItem, product }) => total + (product === undefined ? 0 : product.weightKg * cartItem.quantity),
    0,
  )
  const estimatedBoxes = totalWeight === 0 ? 0 : Math.ceil(totalWeight / 10)

  const placeOrder = useMutation({
    mutationFn: () => orderApi.create({ items: state.items }),
    onSuccess: async () => {
      dispatch({ type: 'clear' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.myOrders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminOrdersRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminSummary }),
      ])
      showToast('Order placed successfully.', 'success')
      void navigate('/orders')
    },
    onError: (error) => {
      const apiError = toApiError(error)
      setOrderError(
        apiError.code === 'INSUFFICIENT_STOCK'
          ? 'Stock changed before checkout. Review your cart and try again.'
          : apiError.message,
      )
      void products.refetch()
    },
  })

  const handleCheckout = () => {
    setOrderError(null)
    if (user === null) {
      void navigate('/login?next=/cart')
      return
    }
    if (user.role !== 'CUSTOMER') {
      setOrderError('Only customer accounts can place orders.')
      return
    }
    placeOrder.mutate()
  }

  if (state.items.length === 0) {
    return (
      <div>
        <h1>Your cart</h1>
        <EmptyState
          title="Your cart is empty"
          description="Add products from the catalog to prepare an order."
          action={<Button type="button" icon={<ShoppingBag />} onClick={() => void navigate('/products')}>Browse products</Button>}
        />
      </div>
    )
  }

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>Your cart</h1><p>Product details are refreshed from the current inventory before checkout.</p></div>
      </div>
      {products.isLoading ? <SkeletonRows rows={3} /> : null}
      {products.isError ? <ErrorState message="Current inventory could not be loaded." onRetry={() => void products.refetch()} /> : null}
      {products.data === undefined ? null : (
        <div className={orderStyles.cartLayout}>
          <section className={orderStyles.cartList} aria-label="Cart items">
            {resolvedItems.map(({ cartItem, product }) => {
              const unavailable = product === undefined || product.stock === 0
              return (
                <article className={`${orderStyles.cartRow} ${unavailable ? orderStyles.unavailable : ''}`} key={cartItem.productId}>
                  <div className={orderStyles.cartIdentity}>
                    <span className={orderStyles.cartIcon}><Package aria-hidden="true" /></span>
                    <div>
                      <strong>{product?.name ?? 'Product no longer available'}</strong>
                      <span>{cartItem.productId}</span>
                      {unavailable ? <span className={orderStyles.unavailableText}>Remove this item to continue.</span> : <span>{product.stock} currently in stock</span>}
                    </div>
                  </div>
                  <div className={orderStyles.quantityControl} aria-label={`Quantity for ${product?.name ?? cartItem.productId}`}>
                    <button type="button" onClick={() => dispatch({ type: 'decrement', productId: cartItem.productId })} aria-label="Decrease quantity"><Minus /></button>
                    <input
                      type="number"
                      min="1"
                      max={product?.stock}
                      value={cartItem.quantity}
                      onChange={(event) => {
                        const requested = Number(event.target.value)
                        const quantity = product === undefined ? requested : Math.min(requested, product.stock)
                        dispatch({ type: 'setQuantity', productId: cartItem.productId, quantity })
                      }}
                      aria-label={`Quantity for ${product?.name ?? cartItem.productId}`}
                    />
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'increment', productId: cartItem.productId })}
                      disabled={product === undefined || cartItem.quantity >= product.stock}
                      aria-label="Increase quantity"
                    ><Plus /></button>
                  </div>
                  <div className={orderStyles.lineTotal}>
                    <span>Subtotal</span>
                    <strong>{product === undefined ? '—' : formatYen(multiplyYen(product.priceYen, cartItem.quantity))}</strong>
                  </div>
                  <button className={orderStyles.removeButton} type="button" onClick={() => dispatch({ type: 'remove', productId: cartItem.productId })} aria-label={`Remove ${product?.name ?? cartItem.productId}`}><Trash2 /></button>
                </article>
              )
            })}
          </section>

          <aside className={orderStyles.cartSummary} aria-labelledby="order-summary-title">
            <h2 id="order-summary-title">Order summary</h2>
            {hasUnavailable ? <p className={orderStyles.cartAlert}>One or more items cannot be ordered with the current inventory.</p> : null}
            {orderError === null ? null : <p className={orderStyles.cartError} role="alert">{orderError}</p>}
            <dl className={orderStyles.totals}>
              <div><dt>Total weight</dt><dd>{totalWeight.toFixed(2)} kg</dd></div>
              <div><dt>Estimated boxes</dt><dd>{estimatedBoxes}</dd></div>
              <div className={orderStyles.grandTotal}><dt>Total</dt><dd>{formatYen(totalPrice)}</dd></div>
            </dl>
            <Button type="button" disabled={hasUnavailable || placeOrder.isPending} onClick={handleCheckout}>
              {placeOrder.isPending ? 'Placing order…' : user === null ? 'Sign in to place order' : 'Place order'}
            </Button>
            <p className={orderStyles.cartNote}>The server validates stock and calculates final packing details.</p>
          </aside>
        </div>
      )}
    </div>
  )
}
