import { httpClient } from './httpClient'
import type { CreateProductRequest, Product, ProductFilters, ProductList } from './types'

export const productApi = {
  list: async (filters: ProductFilters, signal?: AbortSignal): Promise<ProductList> => {
    const { data } = await httpClient.get<ProductList>('/products', {
      params: {
        ...(filters.q === undefined || filters.q === '' ? {} : { q: filters.q }),
        ...(filters.inStockOnly === undefined ? {} : { inStockOnly: filters.inStockOnly }),
      },
      ...(signal === undefined ? {} : { signal }),
    })
    return data
  },
  get: async (id: string): Promise<Product> => (await httpClient.get<Product>(`/products/${encodeURIComponent(id)}`)).data,
  create: async (request: CreateProductRequest): Promise<Product> => (await httpClient.post<Product>('/products', request)).data,
  updateStock: async (id: string, stock: number): Promise<Product> =>
    (await httpClient.patch<Product>(`/products/${encodeURIComponent(id)}/stock`, { stock })).data,
  remove: async (id: string): Promise<void> => {
    await httpClient.delete(`/products/${encodeURIComponent(id)}`)
  },
}
