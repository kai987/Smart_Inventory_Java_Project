import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { productApi } from '../api/productApi'
import type { Product } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { useCart } from '../cart/CartProvider'
import { ErrorState, EmptyState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useToast } from '../components/feedback/ToastProvider'
import { Switch } from '../components/ui/Switch'
import { ProductList } from '../features/products/ProductList'
import styles from './pages.module.css'

export function ProductsPage() {
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const deferredSearch = useDeferredValue(search.trim())
  const { user } = useAuth()
  const { dispatch } = useCart()
  const { showToast } = useToast()
  const products = useQuery({
    queryKey: queryKeys.products({ q: deferredSearch, inStockOnly }),
    queryFn: ({ signal }) => productApi.list({ q: deferredSearch, inStockOnly }, signal),
    placeholderData: (previous) => previous,
  })

  const handleAdd = (product: Product) => {
    dispatch({ type: 'add', productId: product.id })
    showToast(`${product.name} added to your cart.`, 'success')
  }

  return (
    <div>
      <h1>Products</h1>
      <section className={styles.productFilters} aria-label="Product filters">
        <label className={styles.searchField}>
          <span className="srOnly">Search by ID or name</span>
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by ID or name"
          />
        </label>
        <Switch checked={inStockOnly} onChange={setInStockOnly} label="In stock only" />
      </section>

      {products.isLoading ? <SkeletonRows /> : null}
      {products.isError ? <ErrorState message="Product data is unavailable." onRetry={() => void products.refetch()} /> : null}
      {products.data?.items.length === 0 ? (
        <EmptyState title="No products found" description="Try a different product ID or name, or turn off the stock filter." />
      ) : null}
      {products.data !== undefined && products.data.items.length > 0 ? (
        <ProductList products={products.data.items} canAdd={user?.role !== 'ADMIN'} onAdd={handleAdd} />
      ) : null}
    </div>
  )
}
