import { env } from 'cloudflare:workers';
import { isProductImageUrl } from './domain';
import { ApiFault, json, requireCsrf, requireUser, withSession } from './http';

export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
type ImageType = { contentType: string; extension: 'png' | 'jpg' | 'webp' };
const allowedTypes: Record<string, ImageType> = {
  'image/png': { contentType: 'image/png', extension: 'png' },
  'image/jpeg': { contentType: 'image/jpeg', extension: 'jpg' },
  'image/webp': { contentType: 'image/webp', extension: 'webp' },
};

function textAt(bytes: Uint8Array, position: number, expected: string): boolean {
  return [...expected].every((character, index) => bytes[position + index] === character.charCodeAt(0));
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return false;
    if (offset === 8) {
      if (length !== 13 || !textAt(bytes, offset + 4, 'IHDR') || view.getUint32(offset + 8) === 0 || view.getUint32(offset + 12) === 0) return false;
    } else if (textAt(bytes, offset + 4, 'IHDR')) return false;
    if (textAt(bytes, offset + 4, 'IDAT') && length > 0) imageData = true;
    if (textAt(bytes, offset + 4, 'IEND')) return length === 0 && imageData && offset + 12 === bytes.length;
    offset += length + 12;
  }
  return false;
}

function isJpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let scan = false;
  let frame = false;
  let sawScan = false;
  let entropy = false;
  while (offset < bytes.length) {
    if (scan) {
      const start = offset;
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      entropy ||= offset > start;
    }
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) return false;
    if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0xd9) return frame && sawScan && entropy && offset === bytes.length;
    if (marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || view.getUint16(offset + 3) === 0 || view.getUint16(offset + 5) === 0
        || bytes[offset + 7] === 0 || length < 8 + 3 * bytes[offset + 7]) return false;
      frame = true;
    }
    scan = marker === 0xda;
    if (scan) {
      if (length < 6 || !frame) return false;
      sawScan = true;
    }
    offset += length;
  }
  return false;
}

function webpFrames(bytes: Uint8Array, start: number, end: number, allowAnimation: boolean): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  let imageData = false;
  while (offset + 8 <= end) {
    const length = view.getUint32(offset + 4, true);
    if (length > end - offset - 8) return false;
    if (textAt(bytes, offset, 'VP8 ')) {
      if (length < 11 || ![0x9d, 0x01, 0x2a].every((value, index) => bytes[offset + 11 + index] === value)
        || (view.getUint16(offset + 14, true) & 0x3fff) === 0 || (view.getUint16(offset + 16, true) & 0x3fff) === 0) return false;
      imageData = true;
    } else if (textAt(bytes, offset, 'VP8L')) {
      if (length < 6 || bytes[offset + 8] !== 0x2f || (bytes[offset + 12] & 0xe0) !== 0) return false;
      imageData = true;
    } else if (textAt(bytes, offset, 'ANMF')) {
      if (!allowAnimation || length < 30 || !webpFrames(bytes, offset + 24, offset + 8 + length, false)) return false;
      imageData = true;
    } else if (textAt(bytes, offset, 'VP8X') && length !== 10) return false;
    offset += 8 + length + (length % 2);
  }
  return imageData && offset === end;
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 26 || !textAt(bytes, 0, 'RIFF') || !textAt(bytes, 8, 'WEBP')) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true) === bytes.length - 8 && webpFrames(bytes, 12, bytes.length, true);
}

export function sniffProductImage(bytes: Uint8Array): ImageType | null {
  if (isPng(bytes)) return allowedTypes['image/png'];
  if (isJpeg(bytes)) return allowedTypes['image/jpeg'];
  if (isWebp(bytes)) return allowedTypes['image/webp'];
  return null;
}

async function readBoundedImage(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ApiFault(413, 'IMAGE_SIZE', 'Product images must not exceed 2 MiB.');
  }
  if (request.body === null) throw new ApiFault(400, 'IMAGE_EMPTY', 'Choose a product image.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_PRODUCT_IMAGE_BYTES) {
        await reader.cancel();
        throw new ApiFault(413, 'IMAGE_SIZE', 'Product images must not exceed 2 MiB.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new ApiFault(400, 'IMAGE_EMPTY', 'Choose a product image.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function imageKey(imageUrl: string): string {
  return `product-images/${imageUrl.slice('/api/product-images/'.length)}`;
}

export async function requireStoredProductImage(imageUrl: string | null | undefined): Promise<void> {
  if (imageUrl == null) return;
  if (!isProductImageUrl(imageUrl) || await env.BUCKET.head(imageKey(imageUrl)) === null) {
    throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', [{ field: 'imageUrl', message: 'Use an uploaded product image.' }]);
  }
}

export async function uploadProductImage(request: Request): Promise<Response> {
  const csrf = await requireCsrf(request);
  await requireUser(request, 'ADMIN');
  const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!Object.hasOwn(allowedTypes, contentType)) throw new ApiFault(415, 'IMAGE_TYPE', 'Use a PNG, JPEG, or WebP image.');
  const bytes = await readBoundedImage(request);
  const type = sniffProductImage(bytes);
  if (type === null || type.contentType !== contentType) throw new ApiFault(400, 'IMAGE_TYPE', 'The file is not a complete PNG, JPEG, or WebP image matching its content type.');
  const imageUrl = `/api/product-images/${crypto.randomUUID()}.${type.extension}`;
  await env.BUCKET.put(imageKey(imageUrl), bytes, { httpMetadata: { contentType: type.contentType } });
  return withSession(json({ imageUrl }, 201), csrf);
}

export async function getProductImage(filename: string): Promise<Response> {
  const imageUrl = `/api/product-images/${filename}`;
  if (!isProductImageUrl(imageUrl)) throw new ApiFault(404, 'NOT_FOUND', 'Product image was not found.');
  const image = await env.BUCKET.get(imageKey(imageUrl));
  if (image === null) throw new ApiFault(404, 'NOT_FOUND', 'Product image was not found.');
  const extension = filename.split('.').at(-1);
  const contentType = extension === 'jpg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : 'image/webp';
  return new Response(image.body, { headers: {
    'Content-Type': contentType,
    'Content-Length': String(image.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': `inline; filename="${filename}"`,
    ETag: image.httpEtag,
  } });
}
