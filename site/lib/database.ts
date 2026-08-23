import { env } from 'cloudflare:workers';

let databaseReady: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN', 'CUSTOMER'))
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    price_yen TEXT NOT NULL,
    stock INTEGER NOT NULL CHECK(stock >= 0),
    weight_kg REAL NOT NULL CHECK(weight_kg > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY NOT NULL,
    customer_name TEXT NOT NULL REFERENCES users(username),
    total_price_yen TEXT NOT NULL,
    total_weight_kg REAL NOT NULL,
    estimated_boxes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    item_order INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    unit_price_yen TEXT NOT NULL,
    unit_weight_kg REAL NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    subtotal_yen TEXT NOT NULL,
    total_weight_kg REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    username TEXT REFERENCES users(username) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS operation_guards (
    id TEXT PRIMARY KEY NOT NULL,
    ok INTEGER NOT NULL CHECK(ok = 1)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_name, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_order_position ON order_items(order_id, item_order)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)',
];

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
  await database.batch(schemaStatements.map((sql) => database.prepare(sql)));
  await database.batch([
    ...seedUsers.map((user) => database.prepare(
      'INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)',
    ).bind(...user)),
    ...seedProducts.map((product) => database.prepare(
      'INSERT OR IGNORE INTO products(id, name, price_yen, stock, weight_kg) VALUES (?, ?, ?, ?, ?)',
    ).bind(...product)),
    database.prepare(
      `INSERT OR IGNORE INTO orders(
        order_id, customer_name, total_price_yen, total_weight_kg, estimated_boxes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind('O1781293444114', 'yqk', '240000', 6, 1, '2026-01-01T00:00:00.000Z'),
    database.prepare(
      `INSERT OR IGNORE INTO orders(
        order_id, customer_name, total_price_yen, total_weight_kg, estimated_boxes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind('Od07161e7b3934455be3dc2437c3df472', 'customer', '247000', 6.8, 1, '2026-01-02T00:00:00.000Z'),
    database.prepare(
      `INSERT OR IGNORE INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind('O1781293444114', 0, 'P001', 'Laptop', '120000', 3, 2, '240000', 6),
    database.prepare(
      `INSERT OR IGNORE INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind('Od07161e7b3934455be3dc2437c3df472', 0, 'P001', 'Laptop', '120000', 3, 2, '240000', 6),
    database.prepare(
      `INSERT OR IGNORE INTO order_items(
        order_id, item_order, product_id, product_name, unit_price_yen,
        unit_weight_kg, quantity, subtotal_yen, total_weight_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind('Od07161e7b3934455be3dc2437c3df472', 1, 'P003', 'Keyboard', '7000', 0.8, 1, '7000', 0.8),
  ]);
  await database.prepare('PRAGMA optimize').run();
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
