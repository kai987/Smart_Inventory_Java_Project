'use client'

import { CanceledError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { productApi } from '../../api/productApi'
import { isUploadedProductImageUrl } from './productImages'

export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
export type ProductImageValidationKey = 'validation.productImageType' | 'validation.productImageSize' | 'validation.productImageEmpty'

export function validateProductImage(file: File): ProductImageValidationKey | null {
  if (!allowedImageTypes.has(file.type)) return 'validation.productImageType'
  if (file.size === 0) return 'validation.productImageEmpty'
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) return 'validation.productImageSize'
  return null
}

export function useProductImageDraft(initialImageUrl?: string) {
  const [file, setFile] = useState<File | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false)
  const [errorKey, setErrorKey] = useState<ProductImageValidationKey | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const previewRef = useRef<string | null>(null)
  const uploadedRef = useRef<{ file: File; imageUrl: string } | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  const discardPreview = () => {
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setLocalPreviewUrl(null)
  }

  const selectFile = (selected: File) => {
    const validation = validateProductImage(selected)
    setErrorKey(validation)
    if (validation !== null) return
    discardPreview()
    const nextPreviewUrl = URL.createObjectURL(selected)
    previewRef.current = nextPreviewUrl
    setLocalPreviewUrl(nextPreviewUrl)
    setFile(selected)
    setRemoved(false)
    uploadedRef.current = null
  }

  const remove = () => {
    discardPreview()
    setFile(null)
    setRemoved(true)
    setErrorKey(null)
    uploadedRef.current = null
  }

  const reset = () => {
    remove()
    setRemoved(false)
  }

  const resolveImageUrl = async (signal: AbortSignal): Promise<string | null> => {
    signal.throwIfAborted()
    if (file === null) return !removed && isUploadedProductImageUrl(initialImageUrl) ? initialImageUrl : null
    if (uploadedRef.current?.file === file) return uploadedRef.current.imageUrl
    setIsUploading(true)
    try {
      const uploaded = await productApi.uploadImage(file, signal)
      signal.throwIfAborted()
      if (!mountedRef.current) throw new CanceledError('Product image dialog was closed')
      if (!isUploadedProductImageUrl(uploaded.imageUrl)) throw new Error('The image upload returned an invalid image URL.')
      uploadedRef.current = { file, imageUrl: uploaded.imageUrl }
      return uploaded.imageUrl
    } finally {
      if (mountedRef.current) setIsUploading(false)
    }
  }

  const persistedPreviewUrl = !removed && isUploadedProductImageUrl(initialImageUrl) ? initialImageUrl : null
  return {
    previewUrl: localPreviewUrl ?? persistedPreviewUrl,
    errorKey,
    isUploading,
    selectFile,
    remove,
    reset,
    resolveImageUrl,
  }
}
