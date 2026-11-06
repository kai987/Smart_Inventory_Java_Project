import { ApiFault } from './http';

export type OrderPagination = { page: number; size: number; sort: 'asc' | 'desc' };

// No paging parameters keeps the original, complete ascending response.
export function orderPagination(params: URLSearchParams): OrderPagination | null {
  const names = ['page', 'size', 'sort'] as const;
  if (!names.some((name) => params.has(name))) return null;
  const errors: { field: string; message: string }[] = [];
  for (const name of names) {
    if (params.getAll(name).length > 1) errors.push({ field: name, message: 'Only one value is allowed.' });
  }
  const integer = (name: 'page' | 'size', fallback: number, maximum: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
      errors.push({ field: name, message: `Must be an integer between 1 and ${maximum}.` });
    }
    return value;
  };
  const page = integer('page', 1, 1_000_000);
  const size = integer('size', 20, 100);
  const sort = params.get('sort') ?? 'asc';
  if (sort !== 'asc' && sort !== 'desc') errors.push({ field: 'sort', message: 'Must be asc or desc.' });
  if (errors.length > 0) throw new ApiFault(400, 'VALIDATION_ERROR', 'Validation failed.', errors);
  return { page, size, sort: sort as OrderPagination['sort'] };
}
