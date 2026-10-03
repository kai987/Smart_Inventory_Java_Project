import { describe, expect, it } from 'vitest';
import { calculateOrder, normalizeRequestedItems, productErrors, registrationErrors } from './domain';

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
});
