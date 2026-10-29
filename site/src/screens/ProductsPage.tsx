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
import { Button } from '../components/ui/Button'
import { Switch } from '../components/ui/Switch'
import { ProductList } from '../features/products/ProductList'
import { productCategories, productCategoryLabelKeys, selectCatalogProducts, type ProductCategoryFilter, type ProductSort } from '../features/products/productCatalog'
import { useLocaleFormatters } from '../i18n/formatters'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from './pages.module.css'

export function ProductsPage() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [category, setCategory] = useState<ProductCategoryFilter>('all')
  const [sort, setSort] = useState<ProductSort>('default')
  const { formatNumber } = useLocaleFormatters()
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
  const visibleProducts = selectCatalogProducts(products.data?.items ?? [], category, sort)
  const hasFilters = search !== '' || inStockOnly || category !== 'all' || sort !== 'default'

  const resetFilters = () => {
    setSearch('')
    setInStockOnly(false)
    setCategory('all')
    setSort('default')
  }

  const handleAdd = (product: Product) => {
    dispatch({ type: 'add', productId: product.id })
    showToast(t('products.addedToCart', { productName: product.name }), 'success')
  }

  return (
    <div>
      <header className={styles.catalogHeader}>
        <h1>{t('products.title')}</h1>
        <p>{t('products.catalogIntro')}</p>
      </header>
      <section className={styles.productFilters} aria-label={t('products.filtersLabel')}>
        <div className={styles.filterControls}>
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
        </div>
        <div className={styles.categoryFilters} role="group" aria-label={t('products.categoriesLabel')}>
          {productCategories.map((value) => (
            <button
              type="button"
              key={value}
              className={styles.categoryChip}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {t(productCategoryLabelKeys[value])}
            </button>
          ))}
        </div>
      </section>

      <div className={styles.catalogToolbar}>
        <p className={styles.resultCount} role="status" aria-live="polite">
          {products.data !== undefined ? t('products.resultsCount', { count: visibleProducts.length, formattedCount: formatNumber(visibleProducts.length) }) : null}
        </p>
        <div className={styles.catalogActions}>
          {hasFilters && (products.data === undefined || visibleProducts.length > 0) ? <Button type="button" variant="ghost" size="small" onClick={resetFilters}>{t('products.resetFilters')}</Button> : null}
          <label className={styles.sortField}>
            <span>{t('products.sortLabel')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}>
              <option value="default">{t('products.sortDefault')}</option>
              <option value="priceAsc">{t('products.sortPriceAsc')}</option>
              <option value="priceDesc">{t('products.sortPriceDesc')}</option>
            </select>
          </label>
        </div>
      </div>

      {products.isLoading ? <SkeletonRows /> : null}
      {products.isError ? <ErrorState message={t('products.loadError')} onRetry={() => void products.refetch()} /> : null}
      {products.data !== undefined && visibleProducts.length === 0 ? (
        <EmptyState
          title={t('products.noResultsTitle')}
          description={t('products.noResultsDescription')}
          action={hasFilters ? <Button type="button" variant="secondary" onClick={resetFilters}>{t('products.resetFilters')}</Button> : undefined}
        />
      ) : null}
      {products.data !== undefined && visibleProducts.length > 0 ? (
        <ProductList products={visibleProducts} canAdd={user?.role !== 'ADMIN'} onAdd={handleAdd} />
      ) : null}
      <footer className={styles.catalogFooter}>
        <a href="/product-images/CREDITS.md" target="_blank" rel="noreferrer">{t('products.imageCredits')}</a>
      </footer>
    </div>
  )
}
