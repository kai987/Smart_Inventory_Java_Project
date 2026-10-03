import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { adminApi } from '../api/adminApi'
import { toApiError } from '../api/apiError'
import { productApi } from '../api/productApi'
import type { CreateProductRequest, Product } from '../api/types'
import { queryKeys } from '../app/queryClient'
import { useAuth } from '../auth/AuthProvider'
import { EmptyState, ErrorState, SkeletonRows } from '../components/feedback/QueryFeedback'
import { useToast } from '../components/feedback/ToastProvider'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Field } from '../components/ui/Field'
import { ProductImage } from '../features/products/ProductImage'
import { translateApiError, translateApiFieldError } from '../i18n/apiErrorLocalization'
import { useLocaleFormatters } from '../i18n/formatters'
import { useLocalizedDocumentTitle } from '../i18n/useLocalizedDocumentTitle'
import styles from '../features/admin/admin.module.css'
import pageStyles from './pages.module.css'

const csvReserved = /[,|:\r\n]/
const maxLong = 9_223_372_036_854_775_807n

export function createProductSchema(t: TFunction) {
  return z.object({
    id: z.string().regex(/^P\d{3}$/, t('validation.productIdPattern')),
    name: z.string().trim()
      .min(1, t('validation.productNameRequired'))
      .max(100, t('validation.productNameMax'))
      .refine((value) => !csvReserved.test(value), t('validation.productNameReservedCharacters')),
    priceYen: z.string().regex(/^[1-9]\d*$/, t('validation.pricePositive')).refine((value) => {
      try { return BigInt(value) <= maxLong } catch { return false }
    }, t('validation.priceRange')),
    stock: z.string().regex(/^\d+$/, t('validation.stockNonNegative'))
      .refine((value) => Number(value) <= 2_147_483_647, t('validation.stockRange')),
    weightKg: z.string().refine(
      (value) => Number.isFinite(Number(value)) && Number(value) > 0,
      t('validation.weightPositive'),
    ),
  })
}

export function createStockSchema(t: TFunction) {
  return z.object({
    stock: z.string().regex(/^\d+$/, t('validation.stockNonNegative'))
      .refine((value) => Number(value) <= 2_147_483_647, t('validation.stockRange')),
  })
}

type ProductFormValues = z.infer<ReturnType<typeof createProductSchema>>
type StockValues = z.infer<ReturnType<typeof createStockSchema>>
const productFields = ['id', 'name', 'priceYen', 'stock', 'weightKg'] as const
type ProductField = typeof productFields[number]

function isProductField(value: string): value is ProductField {
  return (productFields as readonly string[]).includes(value)
}

function AddProductDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t, i18n } = useTranslation()
  const { user, getSessionVersion, getSessionSignal, isCurrentSession, runProtectedRequest } = useAuth()
  const resolvedLanguage = i18n.resolvedLanguage
  const [submitError, setSubmitError] = useState<ReturnType<typeof toApiError> | null>(null)
  const schema = useMemo(() => {
    void resolvedLanguage
    return createProductSchema(t)
  }, [resolvedLanguage, t])
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { id: '', name: '', priceYen: '', stock: '0', weightKg: '' },
  })
  const { clearErrors } = form
  const mutation = useMutation({ mutationFn: (request: CreateProductRequest) => runProtectedRequest(() => productApi.create(request, getSessionSignal())) })

  useEffect(() => {
    clearErrors()
  }, [clearErrors, resolvedLanguage])

  const close = () => {
    if (mutation.isPending) return
    form.reset()
    setSubmitError(null)
    onClose()
  }

  const submit = form.handleSubmit(async (values) => {
    if (user?.role !== 'ADMIN') return
    const sessionVersion = getSessionVersion()
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
      if (!isCurrentSession(user, sessionVersion)) return
      form.reset()
      onCreated()
      onClose()
    } catch (error: unknown) {
      if (!isCurrentSession(user, sessionVersion)) return
      const apiError = toApiError(error)
      for (const fieldError of apiError.fieldErrors) {
        const field = fieldError.field.replace(/^request\./, '')
        if (isProductField(field)) {
          form.setError(field, { type: 'server', message: translateApiFieldError(fieldError, t) })
        }
      }
      setSubmitError(apiError)
    }
  })

  return (
    <Dialog open={open} title={t('admin.addProduct')} description={t('admin.addProductDescription')} onClose={close}>
      <form onSubmit={submit} noValidate>
        <div className={pageStyles.formGrid}>
          {submitError === null ? null : <p className={`${pageStyles.formMessage} ${pageStyles.formMessageWide}`} role="alert">{translateApiError(submitError, t)}</p>}
          <Field label={t('admin.productId')} placeholder="P005" error={form.formState.errors.id?.message} {...form.register('id')} />
          <Field label={t('admin.productName')} placeholder={t('admin.productNamePlaceholder')} error={form.formState.errors.name?.message} {...form.register('name')} />
          <Field label={t('admin.priceJpy')} inputMode="numeric" placeholder="9800" error={form.formState.errors.priceYen?.message} {...form.register('priceYen')} />
          <Field id="product-stock" label={t('admin.stock')} inputMode="numeric" placeholder="12" error={form.formState.errors.stock?.message} {...form.register('stock')} />
          <Field label={t('admin.weightKg')} inputMode="decimal" placeholder="0.35" error={form.formState.errors.weightKg?.message} {...form.register('weightKg')} />
        </div>
        <div className={pageStyles.dialogActions}>
          <Button type="button" variant="secondary" onClick={close} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? t('admin.addingProduct') : t('admin.addProduct')}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function StockDialog({ product, onClose, onUpdated }: { product: Product | null; onClose: () => void; onUpdated: () => void }) {
  const { t, i18n } = useTranslation()
  const { user, getSessionVersion, getSessionSignal, isCurrentSession, runProtectedRequest } = useAuth()
  const resolvedLanguage = i18n.resolvedLanguage
  const [submitError, setSubmitError] = useState<ReturnType<typeof toApiError> | null>(null)
  const schema = useMemo(() => {
    void resolvedLanguage
    return createStockSchema(t)
  }, [resolvedLanguage, t])
  const form = useForm<StockValues>({ resolver: zodResolver(schema), values: { stock: String(product?.stock ?? 0) } })
  const { clearErrors } = form
  const mutation = useMutation({ mutationFn: ({ id, stock }: { id: string; stock: number }) => runProtectedRequest(() => productApi.updateStock(id, stock, getSessionSignal())) })

  useEffect(() => {
    clearErrors()
  }, [clearErrors, resolvedLanguage])

  const submit = form.handleSubmit(async ({ stock }) => {
    if (product === null || user?.role !== 'ADMIN') return
    const sessionVersion = getSessionVersion()
    setSubmitError(null)
    try {
      await mutation.mutateAsync({ id: product.id, stock: Number(stock) })
      if (!isCurrentSession(user, sessionVersion)) return
      onUpdated()
      onClose()
    } catch (error: unknown) {
      if (!isCurrentSession(user, sessionVersion)) return
      const apiError = toApiError(error)
      for (const fieldError of apiError.fieldErrors) {
        if (fieldError.field.replace(/^request\./, '') === 'stock') {
          form.setError('stock', { type: 'server', message: translateApiFieldError(fieldError, t) })
        }
      }
      setSubmitError(apiError)
    }
  })

  return (
    <Dialog
      open={product !== null}
      title={t('admin.updateStock')}
      description={product === null ? undefined : t('admin.productIdentity', { productName: product.name, productId: product.id })}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className={pageStyles.dialogBody}>
          {submitError === null ? null : <p className={pageStyles.formMessage} role="alert">{translateApiError(submitError, t)}</p>}
          <Field id="updated-stock" label={t('admin.stock')} inputMode="numeric" error={form.formState.errors.stock?.message} {...form.register('stock')} />
        </div>
        <div className={pageStyles.dialogActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? t('admin.saving') : t('admin.saveStock')}</Button>
        </div>
      </form>
    </Dialog>
  )
}

export default function AdminProductsPage() {
  const { t } = useTranslation()
  const { user, isChangingSession, getSessionVersion, getSessionSignal, isCurrentSession, runProtectedRequest } = useAuth()
  const { formatNumber, formatWeight, formatYen } = useLocaleFormatters()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null)
  const deferredSearch = useDeferredValue(search.trim())
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  useLocalizedDocumentTitle('admin.productManagementTitle')
  const products = useQuery({
    queryKey: queryKeys.products({ q: deferredSearch, inStockOnly: false }),
    queryFn: ({ signal }) => productApi.list({ q: deferredSearch, inStockOnly: false }, signal),
    placeholderData: (previous) => previous,
  })
  const summary = useQuery({
    queryKey: queryKeys.adminSummary(user?.username ?? ''),
    queryFn: ({ signal }) => runProtectedRequest((scope) => adminApi.summary(AbortSignal.any([signal, scope]))),
    enabled: user?.role === 'ADMIN' && !isChangingSession,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => runProtectedRequest(() => productApi.remove(id, getSessionSignal())),
    onMutate: () => ({ user, sessionVersion: getSessionVersion() }),
    onSuccess: async (_result, _id, context) => {
      if (context.user === null || !isCurrentSession(context.user, context.sessionVersion)) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminSummary(context.user.username) }),
      ])
      if (!isCurrentSession(context.user, context.sessionVersion)) return
      showToast(t('admin.productDeleted'), 'success')
      setDeleteProduct(null)
    },
    onError: (error, _id, context) => {
      if (context?.user !== null && context?.user !== undefined && isCurrentSession(context.user, context.sessionVersion)) {
        showToast(translateApiError(toApiError(error), t), 'error')
      }
    },
  })

  const refreshProducts = async (message: string) => {
    if (user?.role !== 'ADMIN') return
    const sessionVersion = getSessionVersion()
    if (!isCurrentSession(user, sessionVersion)) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adminSummary(user.username) }),
    ])
    if (!isCurrentSession(user, sessionVersion)) return
    showToast(message, 'success')
  }

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <div><h1>{t('admin.productManagementTitle')}</h1><p>{t('admin.productManagementIntro')}</p></div>
        <Button type="button" icon={<Plus />} onClick={() => setAddOpen(true)}>{t('admin.addProduct')}</Button>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.toolbarSearch}><span className="srOnly">{t('admin.searchProductsLabel')}</span><Search aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('admin.searchProductsPlaceholder')} /></label>
      </div>
      {products.isLoading ? <SkeletonRows /> : null}
      {products.isError ? <ErrorState message={t('admin.productLoadError')} onRetry={() => void products.refetch()} /> : null}
      {products.data?.items.length === 0 ? <EmptyState title={t('admin.noProductsTitle')} description={t('admin.noProductsDescription')} /> : null}
      {products.data !== undefined && products.data.items.length > 0 ? (
        <div className={styles.tableSurface}>
          <table className={styles.table}>
            <thead><tr><th>{t('admin.productId')}</th><th>{t('admin.productName')}</th><th>{t('admin.price')}</th><th>{t('admin.stock')}</th><th>{t('admin.weight')}</th><th>{t('admin.status')}</th><th>{t('admin.actions')}</th></tr></thead>
            <tbody>
              {products.data.items.map((product) => {
                const lowStockThreshold = summary.data?.lowStockThreshold ?? 5
                const status = product.stock === 0 ? t('admin.outOfStock') : product.stock <= lowStockThreshold ? t('admin.lowStock') : t('admin.inStock')
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
                    <td>{formatNumber(product.stock)}</td>
                    <td>{formatWeight(product.weightKg)}</td>
                    <td><span className={`${styles.status} ${statusClass}`}>{status}</span></td>
                    <td><div className={styles.rowActions}>
                      <button type="button" onClick={() => setStockProduct(product)} aria-label={t('admin.updateStockFor', { productName: product.name })}><Pencil /></button>
                      <button type="button" onClick={() => setDeleteProduct(product)} aria-label={t('admin.deleteProductNamed', { productName: product.name })}><Trash2 /></button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <AddProductDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void refreshProducts(t('admin.productAdded'))} />
      <StockDialog product={stockProduct} onClose={() => setStockProduct(null)} onUpdated={() => void refreshProducts(t('admin.stockUpdated'))} />
      <Dialog
        open={deleteProduct !== null}
        title={t('admin.deleteProductTitle')}
        description={t('admin.deleteProductDescription')}
        onClose={() => setDeleteProduct(null)}
      >
        <div className={pageStyles.dialogBody}><p>{t('admin.deleteProductQuestion', { productName: deleteProduct?.name ?? '', productId: deleteProduct?.id ?? '' })}</p></div>
        <div className={pageStyles.dialogActions}>
          <Button type="button" variant="secondary" onClick={() => setDeleteProduct(null)} disabled={deleteMutation.isPending}>{t('common.cancel')}</Button>
          <Button type="button" variant="danger" onClick={() => { if (deleteProduct !== null) deleteMutation.mutate(deleteProduct.id) }} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? t('admin.deleting') : t('admin.deleteProduct')}</Button>
        </div>
      </Dialog>
    </div>
  )
}
