import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getProductCategory } from '../src/features/products/productCatalog';
import { getProductImagePath } from '../src/features/products/productImages';
import { catalogExpansionProducts } from './catalog-seed';
import { productErrors } from './domain';

describe('expanded storefront catalog contract', () => {
  it('has twenty unique additive product IDs outside the original catalog', () => {
    const ids = catalogExpansionProducts.map(([id]) => id);
    expect(new Set(ids).size).toBe(20);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, index) => `P${String(index + 5).padStart(3, '0')}`));
  });

  it.each(catalogExpansionProducts)('%s has valid API data, category metadata, and a bundled photograph', (id, name, priceYen, stock, weightKg) => {
    expect(productErrors({ id, name, priceYen, stock, weightKg })).toEqual([]);
    expect(getProductCategory({ id, name })).not.toBe('other');
    const image = getProductImagePath(id);
    expect(image).not.toBeNull();
    expect(existsSync(new URL(`../public${image}`, import.meta.url))).toBe(true);
  });
});
