import { httpClient } from './httpClient'
import type { CreateProductRequest, Product, ProductFilters, ProductList, UpdateProductDetailsRequest } from './types'

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
  create: async (request: CreateProductRequest, signal?: AbortSignal): Promise<Product> => (await httpClient.post<Product>('/products', request, signal === undefined ? {} : { signal })).data,
  updateNames: async (id: string, names: Pick<CreateProductRequest, 'name' | 'nameJa' | 'nameZh'>, signal?: AbortSignal): Promise<Product> =>
    (await httpClient.patch<Product>(`/products/${encodeURIComponent(id)}/names`, names, signal === undefined ? {} : { signal })).data,
  updateDetails: async (id: string, details: UpdateProductDetailsRequest, signal?: AbortSignal): Promise<Product> =>
    (await httpClient.patch<Product>(`/products/${encodeURIComponent(id)}/details`, details, signal === undefined ? {} : { signal })).data,
  uploadImage: async (file: File, signal?: AbortSignal): Promise<{ imageUrl: string }> =>
    (await httpClient.post<{ imageUrl: string }>('/product-images', file, {
      headers: { 'Content-Type': file.type },
      ...(signal === undefined ? {} : { signal }),
    })).data,
  updateStock: async (id: string, stock: number, signal?: AbortSignal): Promise<Product> =>
    (await httpClient.patch<Product>(`/products/${encodeURIComponent(id)}/stock`, { stock }, signal === undefined ? {} : { signal })).data,
  remove: async (id: string, signal?: AbortSignal): Promise<void> => {
    await httpClient.delete(`/products/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal })
  },
}
