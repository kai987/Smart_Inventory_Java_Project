'use client'

import { useTranslation } from 'react-i18next'
import { useLocaleFormatters } from '../../i18n/formatters'
import { useProductNames } from './useProductNames'

type ProductToastMessageProps = {
  productId: string
  originalName: string
} & ({ kind: 'added' } | { kind: 'stockAdjusted'; stock: number })

export function ProductToastMessage(props: ProductToastMessageProps) {
  const { t } = useTranslation()
  const productName = useProductNames()
  const { formatNumber } = useLocaleFormatters()
  const localizedName = productName(props.productId, props.originalName)

  return <>{props.kind === 'added'
    ? t('products.addedToCart', { productName: localizedName })
    : t('cart.stockAdjusted', { productName: localizedName, stock: formatNumber(props.stock) })}</>
}
