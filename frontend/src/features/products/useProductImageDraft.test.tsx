import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { productApi } from '../../api/productApi'
import { MAX_PRODUCT_IMAGE_BYTES, useProductImageDraft, validateProductImage } from './useProductImageDraft'

const NativeURL = URL
const imageUrl = '/api/product-images/12345678-1234-1234-1234-123456789abc.png'
const createObjectURL = vi.fn(() => 'blob:local-product-preview')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('product image drafts', () => {
  it('validates supported types, non-empty contents, and the inclusive 2 MiB limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateProductImage(new File(['bytes'], 'photo', { type }))).toBeNull()
    }
    expect(validateProductImage(new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }))).toBe('validation.productImageType')
    expect(validateProductImage(new File([], 'empty.png', { type: 'image/png' }))).toBe('validation.productImageEmpty')
    expect(validateProductImage(new File([new Uint8Array(MAX_PRODUCT_IMAGE_BYTES)], 'max.png', { type: 'image/png' }))).toBeNull()
    expect(validateProductImage(new File([new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' }))).toBe('validation.productImageSize')
  })

  it('previews locally without uploading and revokes replaced, removed, and unmounted previews', () => {
    const upload = vi.spyOn(productApi, 'uploadImage')
    const first = new File(['one'], 'one.png', { type: 'image/png' })
    const second = new File(['two'], 'two.webp', { type: 'image/webp' })
    const { result, unmount } = renderHook(() => useProductImageDraft())
    act(() => { result.current.selectFile(first) })
    expect(result.current.previewUrl).toBe('blob:local-product-preview')
    expect(upload).not.toHaveBeenCalled()
    act(() => { result.current.selectFile(second) })
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    act(() => { result.current.remove() })
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(result.current.previewUrl).toBeNull()
    act(() => { result.current.selectFile(first) })
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
    expect(upload).not.toHaveBeenCalled()
  })

  it('reuses the uploaded URL on JSON-save retries and does not upload a removed selection', async () => {
    const upload = vi.spyOn(productApi, 'uploadImage').mockResolvedValue({ imageUrl })
    const file = new File(['png'], 'cup.png', { type: 'image/png' })
    const { result } = renderHook(() => useProductImageDraft())
    act(() => { result.current.selectFile(file) })
    const signal = new AbortController().signal
    let first: string | null = null
    let retry: string | null = null
    await act(async () => { first = await result.current.resolveImageUrl(signal) })
    await act(async () => { retry = await result.current.resolveImageUrl(signal) })
    expect(first).toBe(imageUrl)
    expect(retry).toBe(imageUrl)
    expect(upload).toHaveBeenCalledTimes(1)
    act(() => { result.current.remove() })
    await expect(result.current.resolveImageUrl(signal)).resolves.toBeNull()
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('retains an existing safe image until removal and never accepts external persisted URLs', async () => {
    const signal = new AbortController().signal
    const existing = renderHook(() => useProductImageDraft(imageUrl))
    expect(existing.result.current.previewUrl).toBe(imageUrl)
    await expect(existing.result.current.resolveImageUrl(signal)).resolves.toBe(imageUrl)
    act(() => { existing.result.current.remove() })
    await expect(existing.result.current.resolveImageUrl(signal)).resolves.toBeNull()
    const unsafe = renderHook(() => useProductImageDraft('https://example.com/tracking.png'))
    expect(unsafe.result.current.previewUrl).toBeNull()
    await expect(unsafe.result.current.resolveImageUrl(signal)).resolves.toBeNull()
  })

  it('surfaces upload failures and refuses invalid server-provided image URLs', async () => {
    const upload = vi.spyOn(productApi, 'uploadImage').mockRejectedValueOnce(new Error('Upload failed'))
    const { result } = renderHook(() => useProductImageDraft())
    act(() => { result.current.selectFile(new File(['png'], 'cup.png', { type: 'image/png' })) })
    const signal = new AbortController().signal
    await act(async () => { await expect(result.current.resolveImageUrl(signal)).rejects.toThrow('Upload failed') })
    expect(result.current.isUploading).toBe(false)
    upload.mockResolvedValue({ imageUrl: 'https://example.com/tracking.png' })
    await act(async () => { await expect(result.current.resolveImageUrl(signal)).rejects.toThrow('invalid image URL') })
    expect(result.current.isUploading).toBe(false)
  })

  it('does not reuse a response that arrives after session cancellation', async () => {
    let resolveUpload: (value: { imageUrl: string }) => void = () => { throw new Error('Missing upload resolver') }
    const upload = vi.spyOn(productApi, 'uploadImage').mockReturnValue(new Promise((resolve) => { resolveUpload = resolve }))
    const { result } = renderHook(() => useProductImageDraft())
    act(() => { result.current.selectFile(new File(['png'], 'cup.png', { type: 'image/png' })) })
    const controller = new AbortController()
    let pending: Promise<string | null> = Promise.resolve(null)
    act(() => { pending = result.current.resolveImageUrl(controller.signal) })
    controller.abort()
    await act(async () => {
      resolveUpload({ imageUrl })
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    })
    upload.mockResolvedValue({ imageUrl })
    await act(async () => { await result.current.resolveImageUrl(new AbortController().signal) })
    expect(upload).toHaveBeenCalledTimes(2)
  })
})
