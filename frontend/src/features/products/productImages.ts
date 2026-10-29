import { getProductCategory } from './productCatalog'

export const PRODUCT_IMAGE_PATHS = {
  P001: '/product-images/laptop.webp',
  P002: '/product-images/mouse.webp',
  P003: '/product-images/keyboard.webp',
  P004: '/product-images/monitor.webp',
  P005: '/product-images/desk-lamp.webp',
  P006: '/product-images/robot-vacuum.webp',
  P007: '/product-images/desk-fan.webp',
  P008: '/product-images/digital-alarm-clock.webp',
  P009: '/product-images/electric-kettle.webp',
  P010: '/product-images/frying-pan.webp',
  P011: '/product-images/stainless-steel-bottle.webp',
  P012: '/product-images/digital-kitchen-scale.webp',
  P013: '/product-images/travel-backpack.webp',
  P014: '/product-images/cabin-suitcase.webp',
  P015: '/product-images/compact-umbrella.webp',
  P016: '/product-images/toiletry-bag.webp',
  P017: '/product-images/yoga-mat.webp',
  P018: '/product-images/dumbbell-set.webp',
  P019: '/product-images/jump-rope.webp',
  P020: '/product-images/basketball.webp',
  P021: '/product-images/notebook-set.webp',
  P022: '/product-images/gel-pen-set.webp',
  P023: '/product-images/desk-organizer.webp',
  P024: '/product-images/pencil-case.webp',
} as const

export type ProductImageId = keyof typeof PRODUCT_IMAGE_PATHS

export function getProductImagePath(productId: string, productName?: string): string | null {
  if (productName !== undefined && getProductCategory({ id: productId, name: productName }) === 'other') return null
  const canonicalId = productId.trim().toUpperCase()
  if (!Object.hasOwn(PRODUCT_IMAGE_PATHS, canonicalId)) return null
  return PRODUCT_IMAGE_PATHS[canonicalId as ProductImageId]
}
