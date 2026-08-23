import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { productApi } from '../api/productApi'
import type { Product } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { useCart } from '../cart/CartProvider'
import { ErrorState, EmptyState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useToast } from '../components/feedback/ToastProvider'
import { Switch } from '../components/ui/Switch'
import { ProductList } from '../features/products/ProductList'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from './pages.module.css'

export function ProductsPage() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const deferredSearch = useDeferredValue(search.trim())
  const { user } = useAuth()
  const { dispatch } = useCart()
  const { showToast } = useToast()
  useLocalizedDocumentTitle('products.title')
  const products = useQuery({
    queryKey: queryKeys.products({ q: deferredSearch, inStockOnly }),
    queryFn: ({ signal }) => productApi.list({ q: deferredSearch, inStockOnly }, signal),
    placeholderData: (previous) => previous,
  })

  const handleAdd = (product: Product) => {
    dispatch({ type: 'add', productId: product.id })
    showToast(t('products.addedToCart', { productName: product.name }), 'success')
  }

  return (
    <div>
      <h1>{t('products.title')}</h1>
      <section className={styles.productFilters} aria-label={t('products.filtersLabel')}>
        <label className={styles.searchField}>
          <span className="srOnly">{t('products.searchLabel')}</span>
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('products.searchPlaceholder')}
          />
        </label>
        <Switch checked={inStockOnly} onChange={setInStockOnly} label={t('products.inStockOnly')} />
      </section>

      {products.isLoading ? <SkeletonRows /> : null}
      {products.isError ? <ErrorState message={t('products.loadError')} onRetry={() => void products.refetch()} /> : null}
      {products.data?.items.length === 0 ? (
        <EmptyState title={t('products.noResultsTitle')} description={t('products.noResultsDescription')} />
      ) : null}
      {products.data !== undefined && products.data.items.length > 0 ? (
        <ProductList products={products.data.items} canAdd={user?.role !== 'ADMIN'} onAdd={handleAdd} />
      ) : null}
    </div>
  )
}
