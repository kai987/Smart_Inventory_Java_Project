import { describe, expect, it } from 'vitest';
import { calculateOrder, normalizedProductNames, normalizeRequestedItems, productDetailErrors, productErrors, productNameErrors, registrationErrors } from './domain';

describe('Sites domain rules', () => {
  it('merges duplicate order rows before calculation', () => {
    const normalized = normalizeRequestedItems({ items: [
      { productId: 'P001', quantity: 1 },
      { productId: 'P001', quantity: 2 },
    ] });
    expect(normalized).toEqual({ items: [{ productId: 'P001', quantity: 3 }], errors: [] });
  });

  it('calculates whole-yen totals, weight, and ten-kilogram boxes', () => {
    const order = calculateOrder([
      { id: 'P001', name: 'Laptop', price_yen: '120000', stock: 8, weight_kg: 3 },
      { id: 'P003', name: 'Keyboard', price_yen: '7000', stock: 14, weight_kg: 0.8 },
    ], [{ productId: 'P001', quantity: 2 }, { productId: 'P003', quantity: 6 }]);
    expect(order.totalPriceYen).toBe('282000');
    expect(order.totalWeightKg).toBe(10.8);
    expect(order.estimatedBoxes).toBe(2);
  });

  it('rejects insufficient stock without producing an order', () => {
    expect(() => calculateOrder(
      [{ id: 'P001', name: 'Laptop', price_yen: '120000', stock: 1, weight_kg: 3 }],
      [{ productId: 'P001', quantity: 2 }],
    )).toThrow('INSUFFICIENT_STOCK:P001');
  });

  it('validates registration and product fields', () => {
    expect(registrationErrors({ username: 'x', password: 'a,b' }).map((error) => error.field)).toEqual(['username', 'password']);
    expect(productErrors({ id: 'BAD', name: 'Bad,Name', priceYen: '1.5', stock: null, weightKg: 0 }).map((error) => error.field))
      .toEqual(['id', 'name', 'priceYen', 'stock', 'weightKg']);
  });

  it('matches the bcrypt 72-byte limit for ASCII and multibyte passwords', () => {
    for (const password of ['a'.repeat(72), '中'.repeat(24)]) {
      expect(registrationErrors({ username: 'customer', password })).toEqual([]);
    }
    for (const password of ['a'.repeat(73), '中'.repeat(25)]) {
      expect(registrationErrors({ username: 'customer', password })).toEqual([
        { field: 'password', message: 'Password must not exceed 72 UTF-8 bytes.' },
      ]);
    }
  });

  it('validates optional names without requiring translations for older clients', () => {
    expect(productNameErrors({ name: 'Mug' })).toEqual([]);
    expect(productNameErrors({ name: 'Mug', nameJa: '', nameZh: '   ' })).toEqual([]);
    expect(productNameErrors({ name: 'Mug', nameJa: null, nameZh: null })).toEqual([]);
    expect(productNameErrors({ name: 'Mug', nameJa: 'あ'.repeat(100), nameZh: '中'.repeat(100) })).toEqual([]);
    expect(productNameErrors({ name: 'Mug', nameJa: false, nameZh: 123 }).map((error) => error.field))
      .toEqual(['nameJa', 'nameZh']);
    expect(productNameErrors({ name: ' ', nameJa: 'あ'.repeat(101), nameZh: 'bad,name' }).map((error) => error.field))
      .toEqual(['name', 'nameJa', 'nameZh']);
    expect(normalizedProductNames({ name: ' Mug ', nameJa: ' マグ ', nameZh: ' ' }))
      .toEqual({ name: 'Mug', name_ja: 'マグ', name_zh: null });
  });

  it('copies available custom translations into order snapshots without adding empty fields', () => {
    const product = { id: 'P900', name: 'Mug', name_ja: 'マグ', name_zh: '杯子', price_yen: '900', stock: 3, weight_kg: 0.2 };
    expect(calculateOrder([product], [{ productId: 'P900', quantity: 1 }]).items[0])
      .toMatchObject({ productName: 'Mug', productNameJa: 'マグ', productNameZh: '杯子' });
    const untranslated = calculateOrder([{ ...product, name_ja: null, name_zh: '' }], [{ productId: 'P900', quantity: 1 }]).items[0];
    expect(untranslated).not.toHaveProperty('productNameJa');
    expect(untranslated).not.toHaveProperty('productNameZh');
  });

  it('validates explicit product categories and strictly internal image URLs', () => {
    const product = { id: 'P900', name: 'Mug', priceYen: '900', stock: 3, weightKg: 0.2 };
    expect(productErrors(product)).toEqual([]);
    expect(productErrors({ ...product, category: 'kitchen', imageUrl: null })).toEqual([]);
    const url = '/api/product-images/00000000-0000-4000-8000-000000000000.png';
    expect(productDetailErrors({ name: 'Mug', category: 'kitchen', imageUrl: url })).toEqual([]);
    expect(productDetailErrors({ name: 'Mug' }).map((error) => error.field)).toEqual(['category']);
    expect(productDetailErrors({ name: 'Mug', category: null, imageUrl: 'https://example.com/p.png' }).map((error) => error.field)).toEqual(['category', 'imageUrl']);
    expect(productDetailErrors({ name: 'Mug', category: 'home', imageUrl: {} }).map((error) => error.field)).toEqual(['imageUrl']);
  });

  it('copies a custom image into order snapshots without adding image fields to legacy items', () => {
    const image_url = '/api/product-images/00000000-0000-4000-8000-000000000000.webp';
    const product = { id: 'P900', name: 'Mug', price_yen: '900', stock: 3, weight_kg: 0.2, image_url };
    expect(calculateOrder([product], [{ productId: 'P900', quantity: 1 }]).items[0]).toMatchObject({ productImageUrl: image_url });
    expect(calculateOrder([{ ...product, image_url: null }], [{ productId: 'P900', quantity: 1 }]).items[0]).not.toHaveProperty('productImageUrl');
  });
});
