export const PRODUCT_IMAGE_PATHS = {
  P001: '/product-images/laptop.webp',
  P002: '/product-images/mouse.webp',
  P003: '/product-images/keyboard.webp',
  P004: '/product-images/monitor.webp',
} as const

export type ProductImageId = keyof typeof PRODUCT_IMAGE_PATHS

export function getProductImagePath(productId: string): string | null {
  if (!Object.hasOwn(PRODUCT_IMAGE_PATHS, productId)) return null
  return PRODUCT_IMAGE_PATHS[productId as ProductImageId]
}
