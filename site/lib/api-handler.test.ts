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
  `);
  for (const [id, user] of [['customer-session', 'customer'], ['other-session', 'other'], ['anonymous-session', null]]) {
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

function post(path: string, body: unknown, key: string | null = 'checkout_1234567890', session = 'customer-session') {
  return handleApiRequest(new Request(`http://localhost/api/${path}`, {
    method: 'POST', headers: {
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
