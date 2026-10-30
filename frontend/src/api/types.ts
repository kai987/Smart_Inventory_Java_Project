export type Role = 'ADMIN' | 'CUSTOMER'

export type YenAmount = string
export type ProductCategory = 'electronics' | 'home' | 'kitchen' | 'travel' | 'sports' | 'stationery' | 'other'

export type User = {
  username: string
  role: Role
}

export type CsrfToken = {
  token: string
  headerName: string
  parameterName: string
}

export type Product = {
  id: string
  name: string
  nameJa?: string
  nameZh?: string
  category?: ProductCategory
  imageUrl?: string
  priceYen: YenAmount
  stock: number
  weightKg: number
  available: boolean
}

export type ProductList = {
  items: Product[]
  total: number
}

export type OrderItem = {
  productId: string
  productName: string
  productNameJa?: string
  productNameZh?: string
  productImageUrl?: string
  unitPriceYen: YenAmount
  unitWeightKg: number
  quantity: number
  subtotalYen: YenAmount
  totalWeightKg: number
}

export type Order = {
  orderId: string
  customerName: string
  items: OrderItem[]
  totalPriceYen: YenAmount
  totalWeightKg: number
  estimatedBoxes: number
}

export type OrderList = {
  items: Order[]
  total: number
}

export type DashboardSummary = {
  productCount: number
  totalStock: number
  orderCount: number
  customerCount: number
  lowStockCount: number
  lowStockThreshold: number
  inventoryValueYen: YenAmount
}

export type FieldError = {
  field: string
  message: string
}

export type ApiErrorBody = {
  timestamp: string
  status: number
  code: string
  message: string
  path: string
  fieldErrors: FieldError[]
}

export type LoginRequest = {
  username: string
  password: string
}

export type RegisterRequest = LoginRequest

export type ProductFilters = {
  q?: string
  inStockOnly?: boolean
}

export type CreateProductRequest = {
  id: string
  name: string
  nameJa?: string
  nameZh?: string
  category?: ProductCategory
  imageUrl?: string
  priceYen: YenAmount
  stock: number
  weightKg: number
}

export type UpdateProductDetailsRequest = Pick<CreateProductRequest, 'name' | 'nameJa' | 'nameZh'> & {
  category: ProductCategory
  imageUrl?: string | null
}

export type CreateOrderRequest = {
  items: {
    productId: string
    quantity: number
  }[]
}
