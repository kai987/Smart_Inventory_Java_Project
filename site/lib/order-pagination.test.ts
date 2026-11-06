import { describe, expect, it, vi } from 'vitest';
vi.mock('./database', () => ({}));
import { orderPagination } from './order-pagination';

describe('order pagination query contract', () => {
  it('keeps legacy callers unpaged and ignores unknown names', () => {
    expect(orderPagination(new URLSearchParams('customer=customer&other=1'))).toBeNull();
    expect(orderPagination(new URLSearchParams('size=2&other=1'))).toEqual({ page: 1, size: 2, sort: 'asc' });
  });
  it.each([
    ['page=1', { page: 1, size: 20, sort: 'asc' }],
    ['sort=desc', { page: 1, size: 20, sort: 'desc' }],
    ['page=0002&size=0100&sort=asc', { page: 2, size: 100, sort: 'asc' }],
    ['page=1000000&size=1', { page: 1_000_000, size: 1, sort: 'asc' }],
  ])('accepts %s', (query, expected) => {
    expect(orderPagination(new URLSearchParams(query))).toEqual(expected);
  });
  it.each([
    'page=', 'page=0', 'page=-1', 'page=%2B1', 'page=1.0', 'page=1e2', 'page=%201',
    'page=1000001', 'page=999999999999999999999999', 'page=NaN', 'page=１',
    'size=', 'size=0', 'size=101', 'size=1.5', 'sort=', 'sort=ASC', 'sort=newest',
    'page=1&page=1', 'size=20&size=20', 'sort=asc&sort=asc',
  ])('rejects %s with a field validation error', (query) => {
    expect(() => orderPagination(new URLSearchParams(query))).toThrow(expect.objectContaining({
      status: 400, code: 'VALIDATION_ERROR', fieldErrors: expect.arrayContaining([
        expect.objectContaining({ field: query.split('=')[0] }),
      ]),
    }));
  });
});
