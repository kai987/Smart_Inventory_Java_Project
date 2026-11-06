import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { useLocaleFormatters } from '../../i18n/formatters'
import styles from './orders.module.css'

export const ORDER_PAGE_SIZE = 20
export function orderPageCount(total: number, size = ORDER_PAGE_SIZE): number {
  return Math.max(1, Math.min(1_000_000, Math.ceil(total / size)))
}

export function OrderPagination({ page, total, busy, onPageChange }: {
  page: number
  total: number | undefined
  busy: boolean
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const { formatNumber } = useLocaleFormatters()
  const last = total === undefined ? undefined : orderPageCount(total)
  const firstItem = total === undefined || total === 0 ? 0 : (page - 1) * ORDER_PAGE_SIZE + 1
  const lastItem = total === undefined ? 0 : Math.min(page * ORDER_PAGE_SIZE, total)
  return (
    <nav className={styles.pagination} aria-label={t('pagination.label')} aria-busy={busy}>
      <p role="status" aria-live="polite">
        {total === undefined ? t('pagination.pageUnknown', { page: formatNumber(page) })
          : t('pagination.range', { start: formatNumber(firstItem), end: formatNumber(lastItem), total: formatNumber(total) })}
      </p>
      <div className={styles.paginationControls}>
        <Button type="button" variant="secondary" size="small" disabled={busy || page <= 1} onClick={() => onPageChange(1)}>{t('pagination.first')}</Button>
        <Button type="button" variant="secondary" size="small" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>{t('pagination.previous')}</Button>
        <span>{last === undefined ? t('pagination.pageUnknown', { page: formatNumber(page) })
          : t('pagination.page', { page: formatNumber(page), pages: formatNumber(last) })}</span>
        <Button type="button" variant="secondary" size="small" disabled={busy || last === undefined || page >= last} onClick={() => onPageChange(page + 1)}>{t('pagination.next')}</Button>
        <Button type="button" variant="secondary" size="small" disabled={busy || last === undefined || page >= last} onClick={() => { if (last !== undefined) onPageChange(last) }}>{t('pagination.last')}</Button>
      </div>
    </nav>
  )
}
