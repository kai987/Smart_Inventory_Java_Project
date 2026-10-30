import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyedOrderId } from './order-idempotency';

const context = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock('./database', () => ({ ensureDatabase: async () => context.database! }));
import { handleApiRequest } from './api-handler';

let sqlite: DatabaseSync;
class Prepared {
  constructor(readonly sql: string, readonly values: (string | number | null)[] = []) { }
  bind(...values: (string | number | null)[]) { return new Prepared(this.sql, values); }
  async first<T>() { return (sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.values) as T[], success: true }; }
  async run() {
    const result = sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, price_yen TEXT, stock INTEGER CHECK(stock>=0), weight_kg REAL);
    CREATE TABLE orders(order_id TEXT PRIMARY KEY, customer_name TEXT REFERENCES users(username),
      total_price_yen TEXT, total_weight_kg REAL, estimated_boxes INTEGER, created_at TEXT);
    CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id TEXT REFERENCES orders(order_id), item_order INTEGER,
      product_id TEXT, product_name TEXT, unit_price_yen TEXT, unit_weight_kg REAL, quantity INTEGER,
      subtotal_yen TEXT, total_weight_kg REAL);
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY, username TEXT REFERENCES users(username), csrf_token TEXT, expires_at INTEGER);
    CREATE TABLE operation_guards(id TEXT PRIMARY KEY, ok INTEGER CHECK(ok=1));
    INSERT INTO users VALUES ('customer','unused','CUSTOMER'),('other','unused','CUSTOMER');
    INSERT INTO products VALUES ('P001','Laptop','120000',8,3),('P002','Mouse','2500',30,0.2);
    ALTER TABLE products ADD COLUMN name_ja TEXT;
    ALTER TABLE products ADD COLUMN name_zh TEXT;
    ALTER TABLE order_items ADD COLUMN product_name_ja TEXT;
    ALTER TABLE order_items ADD COLUMN product_name_zh TEXT;
    INSERT INTO users VALUES ('admin','unused','ADMIN');
  `);
  for (const [id, user] of [['customer-session', 'customer'], ['other-session', 'other'], ['anonymous-session', null], ['admin-session', 'admin']]) {
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(id, user, 'test-token', Math.floor(Date.now() / 1000) + 1800);
  }
  context.database = {
    prepare: (sql: string) => new Prepared(sql),
    batch: async (statements: Prepared[]) => {
      // Exercise a lookup/commit race, then run the same all-or-nothing SQL batch as D1.
      await Promise.resolve();
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const result = sqlite.prepare(statement.sql).run(...statement.values);
          results.push({ success: true, meta: { changes: Number(result.changes) } });
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
});
afterEach(() => sqlite.close());

function post(path: string, body: unknown, key: string | null = 'checkout_1234567890', session = 'customer-session', method = 'POST') {
  return handleApiRequest(new Request(`http://localhost/api/${path}`, {
    method, headers: {
      'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'test-token',
      Cookie: `SMART_INVENTORY_SESSION=${session}`,
      ...(key === null ? {} : { 'Idempotency-Key': key }),
    }, body: JSON.stringify(body),
  }));
}
const intent = { items: [{ productId: 'P002', quantity: 2 }] };
type OrderResponse = { orderId: string };
type ErrorResponse = { code: string };
const orderJson = async (response: Response) => await response.json() as OrderResponse;
const stock = () => sqlite.prepare("SELECT stock FROM products WHERE id='P002'").get()!.stock;
const count = () => sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()!.count;

describe('Site administrator multilingual product names', () => {
  const product = { id: 'P900', name: 'Travel Mug', priceYen: '1900', stock: 12, weightKg: 0.4 };
  const get = (path: string, session?: string) => handleApiRequest(new Request(`http://localhost/api/${path}`, {
    ...(session ? { headers: { Cookie: `SMART_INVENTORY_SESSION=${session}` } } : {}),
  }));

  it('keeps legacy product responses unchanged when optional names are omitted or blank', async () => {
    const created = await post('products', { ...product, nameJa: ' ', nameZh: null }, null, 'admin-session');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ...product, available: true });
    expect(await (await get('products/P900')).json()).toEqual({ ...product, available: true });
    expect(sqlite.prepare("SELECT name_ja, name_zh FROM products WHERE id='P900'").get())
      .toEqual({ name_ja: null, name_zh: null });
  });

  it('persists and returns trimmed translations on create, detail and filtered lists', async () => {
    const names = { nameJa: 'トラベルマグ', nameZh: '旅行杯' };
    const created = await post('products', { ...product, name: ' Travel Mug ', nameJa: ' トラベルマグ ', nameZh: ' 旅行杯 ' }, null, 'admin-session');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ...product, ...names, available: true });
    expect(await (await get('products/P900')).json()).toEqual({ ...product, ...names, available: true });
    for (const query of ['P900', 'TRAVEL', 'マグ', '旅行']) {
      expect(await (await get(`products?q=${encodeURIComponent(query)}`)).json())
        .toEqual({ items: [{ ...product, ...names, available: true }], total: 1 });
    }
    expect(await (await get('products?q=%25')).json()).toEqual({ items: [], total: 0 });
  });

  it('edits and clears names without changing stock, price, weight, or identity', async () => {
    await post('products', { ...product, nameJa: 'トラベルマグ', nameZh: '旅行杯' }, null, 'admin-session');
    const changed = await post('products/P900/names', { name: ' Insulated Mug ', nameJa: ' 保温マグ ', nameZh: ' 保温杯 ' }, null, 'admin-session', 'PATCH');
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ ...product, name: 'Insulated Mug', nameJa: '保温マグ', nameZh: '保温杯', available: true });
    const cleared = await post('products/P900/names', { name: 'Insulated Mug', nameJa: ' ' }, null, 'admin-session', 'PATCH');
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ...product, name: 'Insulated Mug', available: true });
    const absent = await post('products/P999/names', { name: 'Missing' }, null, 'admin-session', 'PATCH');
    expect(absent.status).toBe(404);
  });

  it('requires administrator identity and a matching CSRF token for name updates', async () => {
    const body = { name: 'Changed Laptop', nameJa: '変更済み', nameZh: '已修改' };
    expect((await post('products/P001/names', body, null, 'customer-session', 'PATCH')).status).toBe(403);
    expect((await post('products/P001/names', body, null, 'anonymous-session', 'PATCH')).status).toBe(401);
    expect((await handleApiRequest(new Request('http://localhost/api/products/P001/names', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'SMART_INVENTORY_SESSION=admin-session' },
      body: JSON.stringify(body),
    }))).status).toBe(403);
    expect(sqlite.prepare("SELECT name FROM products WHERE id='P001'").get()!.name).toBe('Laptop');
  });

  it.each([42, {}, 'x'.repeat(101), 'bad,name', 'bad|name', 'bad:name', 'bad\nname'])('rejects invalid optional translations: %j', async (invalid) => {
    const created = await post('products', { ...product, nameJa: invalid }, null, 'admin-session');
    expect(created.status).toBe(400);
    expect(await created.json()).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: [{ field: 'nameJa' }] });
    const changed = await post('products/P001/names', { name: 'Laptop', nameZh: invalid }, null, 'admin-session', 'PATCH');
    expect(changed.status).toBe(400);
    expect(await changed.json()).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: [{ field: 'nameZh' }] });
    expect(sqlite.prepare("SELECT id FROM products WHERE id='P900'").get()).toBeUndefined();
  });

  it('snapshots translations into customer and admin orders and durable retries after rename or deletion', async () => {
    await post('products', { ...product, nameJa: 'トラベルマグ', nameZh: '旅行杯' }, null, 'admin-session');
    const request = { items: [{ productId: 'P900', quantity: 2 }] };
    const created = await post('orders', request);
    expect(created.status).toBe(201);
    const original = await created.json();
    expect(original).toMatchObject({ items: [{ productId: 'P900', productName: 'Travel Mug', productNameJa: 'トラベルマグ', productNameZh: '旅行杯', quantity: 2 }] });
    await post('products/P900/names', { name: 'Renamed Mug', nameJa: '新しい名前', nameZh: '新名称' }, null, 'admin-session', 'PATCH');
    expect(await (await post('orders', request)).json()).toEqual(original);
    sqlite.exec("DELETE FROM products WHERE id='P900'");
    expect(await (await get('orders/me', 'customer-session')).json()).toEqual({ items: [original], total: 1 });
    expect(await (await get('orders', 'admin-session')).json()).toEqual({ items: [original], total: 1 });
    expect(await (await post('orders', request)).json()).toEqual(original);
    expect(sqlite.prepare('SELECT product_name_ja, product_name_zh FROM order_items').get())
      .toEqual({ product_name_ja: 'トラベルマグ', product_name_zh: '旅行杯' });
  });
});

describe('Site authenticated order retries', () => {
  it('uses the same durable keyed ID as Java and Rust', async () => {
    expect(await keyedOrderId('customer', 'checkout_1234567890'))
      .toBe('OI9582a2e4820a8f4d099338f727ce30d03d14583aace592e11346b43066c6e43d');
  });
  it('does not collide for distinct case-sensitive D1 customer accounts', async () => {
    sqlite.exec("INSERT INTO users VALUES ('Customer','unused','CUSTOMER')");
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('upper-session', 'Customer', 'test-token', Math.floor(Date.now() / 1000) + 1800);
    const lower = await post('orders', intent);
    const upper = await post('orders', intent, 'checkout_1234567890', 'upper-session');
    expect([lower.status, upper.status]).toEqual([201, 201]);
    expect((await orderJson(lower)).orderId).not.toBe((await orderJson(upper)).orderId);
    expect(count()).toBe(2);
    expect(stock()).toBe(26);
  });
  it('replays a normalized retry without decrementing stock twice, including deleted products', async () => {
    const first = await post('orders', intent);
    expect(first.status).toBe(201);
    const original = await first.json();
    const duplicate = await post('orders', { items: [{ productId: 'P002', quantity: 1 }, { productId: 'P002', quantity: 1 }] });
    expect(await duplicate.json()).toEqual(original);
    expect(stock()).toBe(28);
    expect(count()).toBe(1);
    sqlite.exec("DELETE FROM products WHERE id='P002'");
    expect(await (await post('orders', intent)).json()).toEqual(original);
  });
  it('rejects key reuse for different content and malformed keys without writes', async () => {
    await post('orders', intent);
    const changed = await post('orders', { items: [{ productId: 'P002', quantity: 1 }] });
    expect(changed.status).toBe(409);
    expect((await changed.json() as ErrorResponse).code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await post('orders', intent, 'short')).status).toBe(400);
    expect(stock()).toBe(28);
    expect(count()).toBe(1);
  });
  it('resolves concurrent duplicates to one committed order', async () => {
    const responses = await Promise.all([post('orders', intent), post('orders', intent)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const orders = await Promise.all(responses.map((response) => response.json()));
    expect(orders[0]).toEqual(orders[1]);
    expect(stock()).toBe(28);
    expect(count()).toBe(1);
  });
  it('scopes keys to authenticated customer and retains unkeyed behavior', async () => {
    const a = await orderJson(await post('orders', intent));
    const b = await orderJson(await post('orders', intent, 'checkout_1234567890', 'other-session'));
    expect(a.orderId).not.toBe(b.orderId);
    const unkeyed = await Promise.all([post('orders', intent, null), post('orders', intent, null)]);
    expect(unkeyed.map((response) => response.status)).toEqual([201, 201]);
    expect((await orderJson(unkeyed[0])).orderId).not.toBe((await orderJson(unkeyed[1])).orderId);
    expect(count()).toBe(4);
    expect(stock()).toBe(22);
  });
  it('does not reserve a key when stock validation fails', async () => {
    sqlite.exec("UPDATE products SET stock=1 WHERE id='P002'");
    expect((await post('orders', intent)).status).toBe(409);
    expect(count()).toBe(0);
    sqlite.exec("UPDATE products SET stock=3 WHERE id='P002'");
    expect((await post('orders', intent)).status).toBe(201);
    expect(stock()).toBe(1);
  });
  it('registration creates an account without changing the verified session identity', async () => {
    const created = await post('auth/register', { username: 'newcustomer', password: 'pass123' }, null, 'anonymous-session');
    expect(created.status).toBe(201);
    const me = await handleApiRequest(new Request('http://localhost/api/auth/me', {
      headers: { Cookie: 'SMART_INVENTORY_SESSION=anonymous-session' },
    }));
    expect(me.status).toBe(401);
    expect(sqlite.prepare("SELECT username FROM sessions WHERE session_id='anonymous-session'").get()!.username).toBeNull();
  });
  it('rejects overlong UTF-8 passwords before encoding or saving', async () => {
    const response = await post('auth/register', { username: 'newcustomer', password: '中'.repeat(25) }, null, 'anonymous-session');
    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT username FROM users WHERE username='newcustomer'").get()).toBeUndefined();
  });
});
