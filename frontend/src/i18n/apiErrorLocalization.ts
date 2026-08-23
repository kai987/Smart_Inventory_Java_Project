import type { TFunction } from 'i18next'
import { ApiError, toApiError } from '../api/apiError'
import type { FieldError } from '../api/types'

const errorTranslationKeys = {
  NETWORK_ERROR: 'errors.NETWORK_ERROR',
  INVALID_CREDENTIALS: 'errors.INVALID_CREDENTIALS',
  UNAUTHENTICATED: 'errors.UNAUTHENTICATED',
  FORBIDDEN: 'errors.FORBIDDEN',
  CSRF_INVALID: 'errors.CSRF_INVALID',
  USERNAME_EXISTS: 'errors.USERNAME_EXISTS',
  PRODUCT_EXISTS: 'errors.PRODUCT_EXISTS',
  PRODUCT_NOT_FOUND: 'errors.PRODUCT_NOT_FOUND',
  EMPTY_ORDER: 'errors.EMPTY_ORDER',
  INSUFFICIENT_STOCK: 'errors.INSUFFICIENT_STOCK',
  VALIDATION_ERROR: 'errors.VALIDATION_ERROR',
  PERSISTENCE_ERROR: 'errors.PERSISTENCE_ERROR',
  INTERNAL_ERROR: 'errors.INTERNAL_ERROR',
} as const

const fieldTranslationKeys = {
  username: 'validation.invalidUsername',
  password: 'validation.invalidPassword',
  id: 'validation.invalidProductId',
  productId: 'validation.invalidProductId',
  name: 'validation.invalidProductName',
  productName: 'validation.invalidProductName',
  price: 'validation.invalidPrice',
  priceYen: 'validation.invalidPrice',
  stock: 'validation.invalidStock',
  weight: 'validation.invalidWeight',
  weightKg: 'validation.invalidWeight',
  quantity: 'validation.invalidQuantity',
} as const

function ownValue<ObjectType extends object>(object: ObjectType, key: string): ObjectType[keyof ObjectType] | undefined {
  return Object.prototype.hasOwnProperty.call(object, key)
    ? object[key as keyof ObjectType]
    : undefined
}

export function translateApiError(error: unknown, t: TFunction): string {
  const apiError = error instanceof ApiError ? error : toApiError(error)
  const translationKey = ownValue(errorTranslationKeys, apiError.code)
  return translationKey === undefined ? t('errors.generic') : t(translationKey)
}

export function translateApiFieldError(
  fieldError: Pick<FieldError, 'field'>,
  t: TFunction,
): string {
  const normalizedField = fieldError.field
    .replace(/^request\./, '')
    .replace(/\[\d+\]/g, '')
    .split('.')
    .at(-1) ?? ''
  const translationKey = ownValue(fieldTranslationKeys, normalizedField)
  return translationKey === undefined ? t('validation.invalidValue') : t(translationKey)
}
