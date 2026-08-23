import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ProductImage } from '../features/products/ProductImage'
import { translateApiError } from '../i18n/apiErrorLocalization'
import { useLocaleFormatters } from '../i18n/formatters'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import { multiplyYen } from '../utils/currency'
import orderStyles from '../features/orders/orders.module.css'
import pageStyles from './pages.module.css'

type CartError =
  | { type: 'translation'; key: 'cart.stockChanged' | 'cart.customerOnly' }
  | { type: 'api'; error: ReturnType<typeof toApiError> }

export function CartPage() {
  const { t } = useTranslation()
  const { formatYen, formatNumber, formatWeight } = useLocaleFormatters()
  const { state, dispatch } = useCart()
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [orderError, setOrderError] = useState<CartError | null>(null)
  const [quantityDrafts, setQuantityDrafts] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [invalidQuantityIds, setInvalidQuantityIds] = useState<ReadonlySet<string>>(() => new Set())
  useLocalizedDocumentTitle('cart.title')
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
        showToast(t('cart.stockAdjusted', {
          productName: product.name,
          stock: formatNumber(product.stock),
        }), 'info')
      }
    }
  }, [dispatch, formatNumber, productMap, products.data, showToast, state.items, t])

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
  const hasQuantityErrors = state.items.some((item) => invalidQuantityIds.has(item.productId))

  const clearQuantityInputState = (productId: string) => {
    setQuantityDrafts((current) => {
      if (!current.has(productId)) return current
      const next = new Map(current)
      next.delete(productId)
      return next
    })
    setInvalidQuantityIds((current) => {
      if (!current.has(productId)) return current
      const next = new Set(current)
      next.delete(productId)
      return next
    })
  }

  const handleQuantityChange = (productId: string, rawValue: string, stock: number | undefined) => {
    const requested = Number(rawValue)
    if (rawValue.trim() === '' || !Number.isSafeInteger(requested) || requested < 1) {
      setQuantityDrafts((current) => new Map(current).set(productId, rawValue))
      setInvalidQuantityIds((current) => new Set(current).add(productId))
      return
    }

    clearQuantityInputState(productId)
    const quantity = stock === undefined ? requested : Math.min(requested, stock)
    dispatch({ type: 'setQuantity', productId, quantity })
  }

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
      showToast(t('cart.orderSuccess'), 'success')
      void navigate('/orders')
    },
    onError: (error) => {
      const apiError = toApiError(error)
      setOrderError(
        apiError.code === 'INSUFFICIENT_STOCK'
          ? { type: 'translation', key: 'cart.stockChanged' }
          : { type: 'api', error: apiError },
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
      setOrderError({ type: 'translation', key: 'cart.customerOnly' })
      return
    }
    placeOrder.mutate()
  }

  if (state.items.length === 0) {
    return (
      <div>
        <h1>{t('cart.title')}</h1>
        <EmptyState
          title={t('cart.emptyTitle')}
          description={t('cart.emptyDescription')}
          action={<Button type="button" icon={<ShoppingBag />} onClick={() => void navigate('/products')}>{t('cart.browseProducts')}</Button>}
        />
      </div>
    )
  }

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>{t('cart.title')}</h1><p>{t('cart.intro')}</p></div>
      </div>
      {products.isLoading ? <SkeletonRows rows={3} /> : null}
      {products.isError ? <ErrorState message={t('cart.loadError')} onRetry={() => void products.refetch()} /> : null}
      {products.data === undefined ? null : (
        <div className={orderStyles.cartLayout}>
          <section className={orderStyles.cartList} aria-label={t('cart.itemsLabel')}>
            {resolvedItems.map(({ cartItem, product }, itemIndex) => {
              const unavailable = product === undefined || product.stock === 0
              const hasQuantityError = invalidQuantityIds.has(cartItem.productId)
              const quantityErrorId = `cart-quantity-error-${itemIndex}`
              return (
                <article className={`${orderStyles.cartRow} ${unavailable ? orderStyles.unavailable : ''}`} key={cartItem.productId}>
                  <div className={orderStyles.cartIdentity}>
                    <ProductImage
                      productId={cartItem.productId}
                      productName={product?.name ?? cartItem.productId}
                      variant="cart"
                      alt=""
                    />
                    <div>
                      <strong>{product?.name ?? t('cart.unavailableProduct')}</strong>
                      <span>{cartItem.productId}</span>
                      {unavailable
                        ? <span className={orderStyles.unavailableText}>{t('cart.removeUnavailable')}</span>
                        : <span>{t('cart.currentStock', { stock: formatNumber(product.stock) })}</span>}
                    </div>
                  </div>
                  <div className={orderStyles.quantityField}>
                    <div className={orderStyles.quantityControl} aria-label={t('cart.quantityFor', { productName: product?.name ?? cartItem.productId })}>
                      <button type="button" onClick={() => { clearQuantityInputState(cartItem.productId); dispatch({ type: 'decrement', productId: cartItem.productId }) }} aria-label={t('cart.decreaseQuantity')}><Minus /></button>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        max={product?.stock}
                        value={quantityDrafts.get(cartItem.productId) ?? cartItem.quantity}
                        disabled={unavailable}
                        onChange={(event) => handleQuantityChange(cartItem.productId, event.target.value, product?.stock)}
                        aria-label={t('cart.quantityFor', { productName: product?.name ?? cartItem.productId })}
                        aria-invalid={hasQuantityError || undefined}
                        aria-describedby={hasQuantityError ? quantityErrorId : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => { clearQuantityInputState(cartItem.productId); dispatch({ type: 'increment', productId: cartItem.productId }) }}
                        disabled={product === undefined || cartItem.quantity >= product.stock}
                        aria-label={t('cart.increaseQuantity')}
                      ><Plus /></button>
                    </div>
                    {hasQuantityError ? <p className={orderStyles.quantityError} id={quantityErrorId} role="alert">{t('cart.quantityPositiveInteger')}</p> : null}
                  </div>
                  <div className={orderStyles.lineTotal}>
                    <span>{t('cart.subtotal')}</span>
                    <strong>{product === undefined ? '—' : formatYen(multiplyYen(product.priceYen, cartItem.quantity))}</strong>
                  </div>
                  <button className={orderStyles.removeButton} type="button" onClick={() => { clearQuantityInputState(cartItem.productId); dispatch({ type: 'remove', productId: cartItem.productId }) }} aria-label={t('cart.removeItem', { productName: product?.name ?? cartItem.productId })}><Trash2 /></button>
                </article>
              )
            })}
          </section>

          <aside className={orderStyles.cartSummary} aria-labelledby="order-summary-title">
            <h2 id="order-summary-title">{t('cart.summaryTitle')}</h2>
            {hasUnavailable ? <p className={orderStyles.cartAlert}>{t('cart.unavailableItems')}</p> : null}
            {orderError === null ? null : (
              <p className={orderStyles.cartError} role="alert">
                {orderError.type === 'translation' ? t(orderError.key) : translateApiError(orderError.error, t)}
              </p>
            )}
            <dl className={orderStyles.totals}>
              <div><dt>{t('cart.totalWeight')}</dt><dd>{formatWeight(totalWeight)}</dd></div>
              <div><dt>{t('cart.estimatedBoxes')}</dt><dd>{formatNumber(estimatedBoxes)}</dd></div>
              <div className={orderStyles.grandTotal}><dt>{t('cart.totalPrice')}</dt><dd>{formatYen(totalPrice)}</dd></div>
            </dl>
            <Button type="button" disabled={hasUnavailable || hasQuantityErrors || placeOrder.isPending} onClick={handleCheckout}>
              {placeOrder.isPending ? t('cart.placingOrder') : user === null ? t('cart.loginRequired') : t('cart.placeOrder')}
            </Button>
            <p className={orderStyles.cartNote}>{t('cart.serverValidationNote')}</p>
          </aside>
        </div>
      )}
    </div>
  )
}
