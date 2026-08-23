import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { adminApi } from '../api/adminApi'
import { applyFieldErrors, toApiError } from '../api/apiError'
import { productApi } from '../api/productApi'
import type { CreateProductRequest, Product } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useToast } from '../components/feedback/ToastProvider'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Field } from '../components/ui/Field'
import { ProductImage } from '../features/products/ProductImage'
import { formatYen } from '../utils/currency'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

const csvReserved = /[,|:\r\n]/
const maxLong = 9_223_372_036_854_775_807n

const productSchema = z.object({
  id: z.string().regex(/^P\d{3}$/, 'Use the format P followed by three digits.'),
  name: z.string().trim().min(1, 'Enter a product name.').max(100, 'Name must be at most 100 characters.').refine((value) => !csvReserved.test(value), 'Name contains a reserved character.'),
  priceYen: z.string().regex(/^[1-9]\d*$/, 'Enter a positive whole-yen amount.').refine((value) => {
    try { return BigInt(value) <= maxLong } catch { return false }
  }, 'Price exceeds the supported range.'),
  stock: z.string().regex(/^\d+$/, 'Enter zero or a positive whole number.').refine((value) => Number(value) <= 2_147_483_647, 'Stock exceeds the supported range.'),
  weightKg: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, 'Enter a positive finite weight.'),
})

type ProductFormValues = z.infer<typeof productSchema>
const productFields = ['id', 'name', 'priceYen', 'stock', 'weightKg'] as const

function AddProductDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { id: '', name: '', priceYen: '', stock: '0', weightKg: '' },
  })
  const mutation = useMutation({ mutationFn: productApi.create })

  const close = () => {
    if (mutation.isPending) return
    form.reset()
    setSubmitError(null)
    onClose()
  }

  const submit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    const request: CreateProductRequest = {
      id: values.id,
      name: values.name.trim(),
      priceYen: values.priceYen,
      stock: Number(values.stock),
      weightKg: Number(values.weightKg),
    }
    try {
      await mutation.mutateAsync(request)
      form.reset()
      onCreated()
      onClose()
    } catch (error: unknown) {
      const apiError = toApiError(error)
      applyFieldErrors(apiError, form.setError, productFields)
      setSubmitError(apiError.code === 'PRODUCT_EXISTS' ? 'A product with this ID already exists.' : apiError.message)
    }
  })

  return (
    <Dialog open={open} title="Add product" description="Create a product using the same rules as the saved inventory." onClose={close}>
      <form onSubmit={submit} noValidate>
        <div className={pageStyles.formGrid}>
          {submitError === null ? null : <p className={`${pageStyles.formMessage} ${pageStyles.formMessageWide}`} role="alert">{submitError}</p>}
          <Field label="Product ID" placeholder="P005" error={form.formState.errors.id?.message} {...form.register('id')} />
          <Field label="Name" placeholder="Webcam" error={form.formState.errors.name?.message} {...form.register('name')} />
          <Field label="Price (JPY)" inputMode="numeric" placeholder="9800" error={form.formState.errors.priceYen?.message} {...form.register('priceYen')} />
          <Field id="product-stock" label="Stock" inputMode="numeric" placeholder="12" error={form.formState.errors.stock?.message} {...form.register('stock')} />
          <Field label="Weight (kg)" inputMode="decimal" placeholder="0.35" error={form.formState.errors.weightKg?.message} {...form.register('weightKg')} />
        </div>
        <div className={pageStyles.dialogActions}>
          <Button type="button" variant="secondary" onClick={close} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Adding…' : 'Add product'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function StockDialog({ product, onClose, onUpdated }: { product: Product | null; onClose: () => void; onUpdated: () => void }) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const schema = z.object({ stock: z.string().regex(/^\d+$/, 'Enter zero or a positive whole number.').refine((value) => Number(value) <= 2_147_483_647, 'Stock exceeds the supported range.') })
  type StockValues = z.infer<typeof schema>
  const form = useForm<StockValues>({ resolver: zodResolver(schema), values: { stock: String(product?.stock ?? 0) } })
  const mutation = useMutation({ mutationFn: ({ id, stock }: { id: string; stock: number }) => productApi.updateStock(id, stock) })

  const submit = form.handleSubmit(async ({ stock }) => {
    if (product === null) return
    setSubmitError(null)
    try {
      await mutation.mutateAsync({ id: product.id, stock: Number(stock) })
      onUpdated()
      onClose()
    } catch (error: unknown) {
      const apiError = toApiError(error)
      applyFieldErrors(apiError, form.setError, ['stock'])
      setSubmitError(apiError.message)
    }
  })

  return (
    <Dialog open={product !== null} title="Update stock" description={product === null ? undefined : `${product.name} (${product.id})`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className={pageStyles.dialogBody}>
          {submitError === null ? null : <p className={pageStyles.formMessage} role="alert">{submitError}</p>}
          <Field id="updated-stock" label="Stock" inputMode="numeric" error={form.formState.errors.stock?.message} {...form.register('stock')} />
        </div>
        <div className={pageStyles.dialogActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save stock'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

export default function AdminProductsPage() {
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null)
  const deferredSearch = useDeferredValue(search.trim())
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const products = useQuery({
    queryKey: queryKeys.products({ q: deferredSearch, inStockOnly: false }),
    queryFn: ({ signal }) => productApi.list({ q: deferredSearch, inStockOnly: false }, signal),
    placeholderData: (previous) => previous,
  })
  const summary = useQuery({ queryKey: queryKeys.adminSummary, queryFn: adminApi.summary })
  const deleteMutation = useMutation({
    mutationFn: productApi.remove,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminSummary }),
      ])
      showToast('Product deleted. Historical order snapshots are unchanged.', 'success')
      setDeleteProduct(null)
    },
    onError: (error) => showToast(toApiError(error).message, 'error'),
  })

  const refreshProducts = async (message: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adminSummary }),
    ])
    showToast(message, 'success')
  }

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>Products</h1><p>Add products, update current stock, and remove items from the catalog.</p></div>
        <Button type="button" icon={<Plus />} onClick={() => setAddOpen(true)}>Add product</Button>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.toolbarSearch}><span className="srOnly">Search products</span><Search aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by ID or name" /></label>
      </div>
      {products.isLoading ? <SkeletonRows /> : null}
      {products.isError ? <ErrorState message="Product data is unavailable." onRetry={() => void products.refetch()} /> : null}
      {products.data?.items.length === 0 ? <EmptyState title="No products found" description="Try a different ID or name, or add a new product." /> : null}
      {products.data !== undefined && products.data.items.length > 0 ? (
        <div className={styles.tableSurface}>
          <table className={styles.table}>
            <thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Stock</th><th>Weight</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {products.data.items.map((product) => {
                const lowStockThreshold = summary.data?.lowStockThreshold ?? 5
                const status = product.stock === 0 ? 'Out of stock' : product.stock <= lowStockThreshold ? 'Low stock' : 'In stock'
                const statusClass = product.stock === 0 ? styles.statusOut : product.stock <= lowStockThreshold ? styles.statusLow : ''
                return (
                  <tr key={product.id}>
                    <td className={styles.mono}>{product.id}</td>
                    <td className={styles.nameCell}>
                      <div className={styles.productIdentity}>
                        <ProductImage productId={product.id} productName={product.name} variant="admin" alt="" />
                        <span>{product.name}</span>
                      </div>
                    </td>
                    <td>{formatYen(product.priceYen)}</td>
                    <td>{product.stock}</td>
                    <td>{product.weightKg} kg</td>
                    <td><span className={`${styles.status} ${statusClass}`}>{status}</span></td>
                    <td><div className={styles.rowActions}>
                      <button type="button" onClick={() => setStockProduct(product)} aria-label={`Update stock for ${product.name}`}><Pencil /></button>
                      <button type="button" onClick={() => setDeleteProduct(product)} aria-label={`Delete ${product.name}`}><Trash2 /></button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <AddProductDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void refreshProducts('Product added.')} />
      <StockDialog product={stockProduct} onClose={() => setStockProduct(null)} onUpdated={() => void refreshProducts('Stock updated.')} />
      <Dialog
        open={deleteProduct !== null}
        title="Delete product?"
        description="The product will be removed from the catalog. Existing order snapshots will remain available."
        onClose={() => setDeleteProduct(null)}
      >
        <div className={pageStyles.dialogBody}><p>Delete <strong>{deleteProduct?.name}</strong> ({deleteProduct?.id})?</p></div>
        <div className={pageStyles.dialogActions}>
          <Button type="button" variant="secondary" onClick={() => setDeleteProduct(null)} disabled={deleteMutation.isPending}>Cancel</Button>
          <Button type="button" variant="danger" onClick={() => { if (deleteProduct !== null) deleteMutation.mutate(deleteProduct.id) }} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? 'Deleting…' : 'Delete product'}</Button>
        </div>
      </Dialog>
    </div>
  )
}
