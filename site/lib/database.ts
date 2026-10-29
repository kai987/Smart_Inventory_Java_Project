import { env } from 'cloudflare:workers';

let databaseReady: Promise<void> | null = null;

// Schema belongs to immutable Drizzle migrations, never to request handling.
const emptyDatabase = ['users', 'products', 'orders', 'order_items', 'sessions', 'operation_guards']
  .map((table) => `NOT EXISTS (SELECT 1 FROM ${table})`).join(' AND ');

const seedUsers = [
  ['admin', '$2a$10$lwkKvL9uD7fiSsIWh20HUet/SUogG23uy0nBbhRtMn07OU0mMefrS', 'ADMIN'],
  ['customer', '$2a$10$qQyB2/rO7/Bm6iKSe9c2lO97mXe3M5KCvWNuL91N4l2yf57WDu6TK', 'CUSTOMER'],
  ['yqk', '$2a$10$X/DV3XJOiGCFSqQqOktq/.KblYc2n8VhQlH5J1Ur.NTt.NZTaQWFi', 'CUSTOMER'],
  ['job', '$2a$10$.x.Sp3v5Yhmwrff7Y5D08.8fYyQgAJCKmJLhWCY90HMC0ClEKB85y', 'CUSTOMER'],
] as const;

const seedProducts = [
  ['P001', 'Laptop', '120000', 8, 3],
  ['P002', 'Mouse', '2500', 30, 0.2],
  ['P003', 'Keyboard', '7000', 14, 0.8],
  ['P004', 'Monitor', '35000', 6, 5],
] as const;

async function initializeDatabase(): Promise<void> {
  const database = env.DB;
  const state = await database.prepare(`SELECT (${emptyDatabase}) AS is_empty`)
    .first<{ is_empty: number }>();
  if (state?.is_empty !== 1) return;

  // Recheck emptiness inside the atomic batch: another isolate may have seeded
  // or written data since the read above. Only this batch's guard enables seeds.
  const guardId = `bootstrap:${crypto.randomUUID()}`;
  const guarded = (sql: string, values: (string | number)[]) => database.prepare(
    `${sql} WHERE EXISTS (SELECT 1 FROM operation_guards WHERE id = ?)`,
  ).bind(...values, guardId);
  await database.batch([
    database.prepare(`INSERT INTO operation_guards(id, ok) SELECT ?, 1 WHERE ${emptyDatabase}`)
      .bind(guardId),
    ...seedUsers.map((user) => guarded(
      'INSERT OR IGNORE INTO users(username, password_hash, role) SELECT ?, ?, ?', [...user],
    )),
    ...seedProducts.map((product) => guarded(
      'INSERT OR IGNORE INTO products(id, name, price_yen, stock, weight_kg) SELECT ?, ?, ?, ?, ?', [...product],
    )),
    guarded(
      `INSERT OR IGNORE INTO orders(
        order_id, customer_name, total_price_yen, total_weight_kg, estimated_boxes, created_at
      ) SELECT ?, ?, ?, ?, ?, ?`,
      ['O1781293444114', 'yqk', '240000', 6, 1, '2026-01-01T00:00:00.000Z'],
    ),
    guarded(
      `INSERT OR IGNORE INTO orders(
        order_id, customer_name, total_price_yen, total_weight_kg, estimated_boxes, created_at
      ) SELECT ?, ?, ?, ?, ?, ?`,
      ['Od07161e7b3934455be3dc2437c3df472', 'customer', '247000', 6.8, 1, '2026-01-02T00:00:00.000Z'],
    ),
    guarded(
      `INSERT OR IGNORE INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?`,
      ['O1781293444114', 0, 'P001', 'Laptop', '120000', 3, 2, '240000', 6],
    ),
    guarded(
      `INSERT OR IGNORE INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?`,
      ['Od07161e7b3934455be3dc2437c3df472', 0, 'P001', 'Laptop', '120000', 3, 2, '240000', 6],
    ),
    guarded(
      `INSERT OR IGNORE INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?`,
      ['Od07161e7b3934455be3dc2437c3df472', 1, 'P003', 'Keyboard', '7000', 0.8, 1, '7000', 0.8],
    ),
    database.prepare('DELETE FROM operation_guards WHERE id = ?').bind(guardId),
  ]);
}

export async function ensureDatabase(): Promise<D1Database> {
  if (databaseReady === null) {
    databaseReady = initializeDatabase().catch((error: unknown) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
  return env.DB;
}
