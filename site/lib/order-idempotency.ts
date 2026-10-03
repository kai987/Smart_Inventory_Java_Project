import type { RequestedItem } from './domain';

/** Encode the database's exact customer identity into the durable order ID. */
export async function keyedOrderId(username: string, key: string | null): Promise<string | null> {
  if (key === null) return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  // D1 currently permits distinct case-sensitive usernames. Unlike the local
  // backends, folding case here could make two real accounts share an order ID.
  const input = new TextEncoder().encode(`${username}\0${key}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return `OI${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function sameOrderIntent(existing: RequestedItem[], requested: RequestedItem[]): boolean {
  const quantities = (items: RequestedItem[]) => {
    const merged = new Map<string, number>();
    for (const item of items) merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
    return [...merged].sort(([a], [b]) => a.localeCompare(b));
  };
  return JSON.stringify(quantities(existing)) === JSON.stringify(quantities(requested));
}
