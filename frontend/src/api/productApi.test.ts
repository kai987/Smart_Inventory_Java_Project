import { AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { httpClient } from './httpClient'
import { productApi } from './productApi'
import type { Product, UpdateProductDetailsRequest } from './types'

describe('product media API client', () => {
  it('uploads the raw file through the authenticated client with its image Content-Type and abort signal', async () => {
    const imageUrl = '/api/product-images/12345678-1234-1234-1234-123456789abc.webp'
    const post = vi.spyOn(httpClient, 'post').mockResolvedValue({
      data: { imageUrl }, status: 201, statusText: 'Created', headers: {}, config: { headers: new AxiosHeaders() },
    })
    const file = new File(['webp'], 'cup.webp', { type: 'image/webp' })
    const signal = new AbortController().signal
    await expect(productApi.uploadImage(file, signal)).resolves.toEqual({ imageUrl })
    expect(post).toHaveBeenCalledWith('/product-images', file, { headers: { 'Content-Type': 'image/webp' }, signal })
  })

  it('sends category and explicit image removal to the details endpoint, leaving the names endpoint compatible', async () => {
    const product: Product = { id: 'P900', name: 'Cup', category: 'kitchen', priceYen: '1000', stock: 3, weightKg: 0.4, available: true }
    const patch = vi.spyOn(httpClient, 'patch').mockResolvedValue({
      data: product, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
    })
    const signal = new AbortController().signal
    const request: UpdateProductDetailsRequest = { name: 'Cup', nameJa: 'カップ', nameZh: '杯子', category: 'kitchen', imageUrl: null }
    await expect(productApi.updateDetails('P900', request, signal)).resolves.toEqual(product)
    expect(patch).toHaveBeenCalledWith('/products/P900/details', request, { signal })
    await productApi.updateNames('P900', { name: 'Cup' }, signal)
    expect(patch).toHaveBeenLastCalledWith('/products/P900/names', { name: 'Cup' }, { signal })
  })
})
