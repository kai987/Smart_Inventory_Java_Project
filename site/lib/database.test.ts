import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_EXPANSION_VERSION, catalogExpansionProducts, ensureExpandedCatalog } from './catalog-seed';

const context = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock('cloudflare:workers', () => ({ env: { get DB() { return context.database!; } } }));

let sqlite: DatabaseSync;
let preparedSql: string[];
let batchCount: number;
let failAfterStatement: number | null;
let afterFirstBatch: (() => void) | null;

class Prepared {
  constructor(readonly sql: string, readonly values: (string | number | null)[] = []) { }
  bind(...values: (string | number | null)[]) { return new Prepared(this.sql, values); }
  async first<T>() { return (sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
}

beforeEach(() => {
  vi.resetModules();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  // Only the test harness applies the real migration; request code must not.
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
  for (const migration of journal.entries) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), 'utf8')
      .replaceAll('--> statement-breakpoint', ''));
  }
  preparedSql = [];
  batchCount = 0;
  failAfterStatement = null;
  afterFirstBatch = null;
  context.database = {
    prepare: (sql: string) => { preparedSql.push(sql); return new Prepared(sql); },
    batch: async (statements: Prepared[]) => {
      // Let separate cold isolates both observe the initial empty database.
      await Promise.resolve();
      batchCount += 1;
      sqlite.exec('BEGIN');
      try {
        for (const [index, statement] of statements.entries()) {
          sqlite.prepare(statement.sql).run(...statement.values);
          if (failAfterStatement === index) {
            failAfterStatement = null;
            throw new Error('simulated batch failure');
          }
        }
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      if (batchCount === 1) afterFirstBatch?.();
      return statements.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
});
afterEach(() => sqlite.close());

const count = (table: string) => Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
const counts = () => ['users', 'products', 'orders', 'order_items', 'sessions', 'operation_guards'].map(count);
const schema = () => sqlite.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all();
async function coldModule() { vi.resetModules(); return import('./database'); }

describe('D1 bootstrap without request-time schema changes', () => {
  it('seeds a migrated empty database atomically without changing its schema', async () => {
    const before = schema();
    const { ensureDatabase } = await coldModule();
    expect(await ensureDatabase()).toBe(context.database);
    expect(counts()).toEqual([4, 24, 2, 3, 0, 1]);
    expect(schema()).toEqual(before);
    expect(preparedSql.every((sql) => !/\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(true);
    expect(batchCount).toBe(2);
  });

  it('preserves an existing partial dataset and adds only the new catalog version', async () => {
    sqlite.exec("INSERT INTO users VALUES ('existing','unused','CUSTOMER')");
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P999','Existing item','123',7,1)");
    const { ensureDatabase } = await coldModule();
    await ensureDatabase();
    expect(counts()).toEqual([1, 21, 0, 0, 0, 1]);
    expect(sqlite.prepare("SELECT stock FROM products WHERE id='P999'").get()!.stock).toBe(7);
    expect(batchCount).toBe(1);
  });

  it('does not resurrect deleted products or orders on a later cold start', async () => {
    await (await coldModule()).ensureDatabase();
    sqlite.exec("DELETE FROM products WHERE id='P001'");
    sqlite.exec("UPDATE products SET stock=13 WHERE id='P002'");
    sqlite.exec("DELETE FROM orders WHERE customer_name='customer'");
    const before = counts();
    await (await coldModule()).ensureDatabase();
    expect(counts()).toEqual(before);
    expect(sqlite.prepare("SELECT id FROM products WHERE id='P001'").get()).toBeUndefined();
    expect(sqlite.prepare("SELECT stock FROM products WHERE id='P002'").get()!.stock).toBe(13);
    expect(batchCount).toBe(2);
  });

  it('keeps a deliberately empty product catalog empty', async () => {
    await (await coldModule()).ensureDatabase();
    sqlite.exec('DELETE FROM products');
    await (await coldModule()).ensureDatabase();
    expect(count('products')).toBe(0);
    expect(count('users')).toBe(4);
    expect(batchCount).toBe(2);
  });

  it('deduplicates simultaneous requests in one isolate', async () => {
    const { ensureDatabase } = await coldModule();
    await Promise.all([ensureDatabase(), ensureDatabase(), ensureDatabase()]);
    expect(counts()).toEqual([4, 24, 2, 3, 0, 1]);
    expect(batchCount).toBe(2);
  });

  it('rechecks emptiness inside each concurrent isolate batch', async () => {
    const first = await coldModule();
    const second = await coldModule();
    afterFirstBatch = () => sqlite.exec("DELETE FROM products WHERE id='P001'");
    await Promise.all([first.ensureDatabase(), second.ensureDatabase()]);
    expect(batchCount).toBe(4);
    expect(counts()).toEqual([4, 23, 2, 3, 0, 1]);
    expect(sqlite.prepare("SELECT id FROM products WHERE id='P001'").get()).toBeUndefined();
  });

  it('rolls back failed seeds and retries without retaining a guard or partial data', async () => {
    failAfterStatement = 3;
    const { ensureDatabase } = await coldModule();
    await expect(ensureDatabase()).rejects.toThrow('simulated batch failure');
    expect(counts()).toEqual([0, 0, 0, 0, 0, 0]);
    await ensureDatabase();
    expect(counts()).toEqual([4, 24, 2, 3, 0, 1]);
  });

  it('retries a failed catalog upgrade without modifying an existing dataset', async () => {
    sqlite.exec("INSERT INTO users VALUES ('existing','unused','CUSTOMER')");
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P001','Existing laptop','99000',2,2.5)");
    failAfterStatement = 3;
    const { ensureDatabase } = await coldModule();
    await expect(ensureDatabase()).rejects.toThrow('simulated batch failure');
    expect(counts()).toEqual([1, 1, 0, 0, 0, 0]);
    await ensureDatabase();
    expect(counts()).toEqual([1, 21, 0, 0, 0, 1]);
    expect(sqlite.prepare("SELECT stock FROM products WHERE id='P001'").get()!.stock).toBe(2);
  });

  it('does not seed base accounts or orders when existing session data is present', async () => {
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('existing-session', null, 'unused', 1);
    await (await coldModule()).ensureDatabase();
    expect(counts()).toEqual([0, 20, 0, 0, 1, 1]);
    expect(batchCount).toBe(1);
  });

  it('fails closed when migrations are missing rather than creating tables', async () => {
    sqlite.close();
    sqlite = new DatabaseSync(':memory:');
    await expect((await coldModule()).ensureDatabase()).rejects.toThrow();
    expect(schema()).toEqual([]);
    expect(preparedSql.every((sql) => !/\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(true);
    expect(batchCount).toBe(0);
  });
});

describe('versioned catalog expansion', () => {
  const products = () => sqlite.prepare('SELECT * FROM products ORDER BY id').all();
  const permanentMarkers = () => sqlite.prepare('SELECT id FROM operation_guards ORDER BY id').all();

  function insertExistingData() {
    sqlite.exec("INSERT INTO users VALUES ('existing','unused','CUSTOMER')");
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P001','Custom Laptop','118000',3,2.5)");
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P002','Existing Mouse','2100',17,0.18)");
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P003','Existing Keyboard','6500',0,0.7)");
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P004','Existing Monitor','33000',2,4.7)");
    sqlite.exec("INSERT INTO orders VALUES ('existing-order','existing','118000',2.5,1,'2026-01-01T00:00:00Z')");
    sqlite.exec("INSERT INTO order_items(order_id,item_order,product_id,product_name,unit_price_yen,unit_weight_kg,quantity,subtotal_yen,total_weight_kg) VALUES ('existing-order',0,'P001','Historical Laptop','118000',2.5,1,'118000',2.5)");
  }

  it('adds all 20 specified products with exact string prices and quantities', async () => {
    expect(catalogExpansionProducts).toEqual([
      ['P005', 'Desk Lamp', '3200', 24, 0.8],
      ['P006', 'Robot Vacuum', '24800', 10, 3.2],
      ['P007', 'Desk Fan', '4500', 18, 1.1],
      ['P008', 'Digital Alarm Clock', '2200', 30, 0.3],
      ['P009', 'Electric Kettle', '5800', 20, 1],
      ['P010', 'Frying Pan', '3600', 16, 0.9],
      ['P011', 'Stainless Steel Bottle', '2400', 36, 0.35],
      ['P012', 'Digital Kitchen Scale', '1800', 22, 0.4],
      ['P013', 'Travel Backpack', '6800', 25, 0.7],
      ['P014', 'Cabin Suitcase', '12800', 12, 2.8],
      ['P015', 'Compact Umbrella', '1900', 40, 0.25],
      ['P016', 'Toiletry Bag', '2600', 28, 0.3],
      ['P017', 'Yoga Mat', '3400', 24, 1.2],
      ['P018', 'Dumbbell Set', '7900', 15, 5],
      ['P019', 'Jump Rope', '1200', 32, 0.2],
      ['P020', 'Basketball', '4200', 18, 0.65],
      ['P021', 'Notebook Set', '1500', 45, 0.6],
      ['P022', 'Gel Pen Set', '900', 60, 0.15],
      ['P023', 'Desk Organizer', '2800', 20, 0.5],
      ['P024', 'Pencil Case', '1600', 35, 0.2],
    ]);
    await ensureExpandedCatalog(context.database!);
    expect(products()).toEqual(catalogExpansionProducts.map(([id, name, price_yen, stock, weight_kg]) => ({
      id, name, price_yen, stock, weight_kg, name_ja: null, name_zh: null, category: null, image_url: null,
    })));
    expect(catalogExpansionProducts.map(([id]) => id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `P${String(index + 5).padStart(3, '0')}`),
    );
    expect(products().every((product) => typeof product.price_yen === 'string')).toBe(true);
    expect(permanentMarkers()).toEqual([{ id: CATALOG_EXPANSION_VERSION }]);
    expect(batchCount).toBe(1);
  });

  it('does not replace original inventory, historical orders, or colliding product IDs', async () => {
    insertExistingData();
    sqlite.exec("INSERT INTO products(id,name,price_yen,stock,weight_kg) VALUES ('P005','My existing product','9876',7,1.7)");
    const existingProducts = products();
    const existingOrders = sqlite.prepare('SELECT * FROM orders').all();
    const existingItems = sqlite.prepare('SELECT * FROM order_items').all();
    await ensureExpandedCatalog(context.database!);
    expect(count('products')).toBe(24);
    expect(sqlite.prepare("SELECT * FROM products WHERE id <= 'P005' ORDER BY id").all())
      .toEqual(existingProducts);
    expect(sqlite.prepare('SELECT * FROM orders').all()).toEqual(existingOrders);
    expect(sqlite.prepare('SELECT * FROM order_items').all()).toEqual(existingItems);
    expect(count('users')).toBe(1);
    expect(permanentMarkers()).toEqual([{ id: CATALOG_EXPANSION_VERSION }]);
  });

  it('never re-adds deleted products or resets changed inventory on repeated calls', async () => {
    await ensureExpandedCatalog(context.database!);
    sqlite.exec("DELETE FROM products WHERE id='P005'");
    sqlite.exec("UPDATE products SET name='Changed product', price_yen='1111', stock=1 WHERE id='P006'");
    const before = products();
    await ensureExpandedCatalog(context.database!);
    await ensureExpandedCatalog(context.database!);
    expect(products()).toEqual(before);
    expect(count('products')).toBe(19);
    expect(batchCount).toBe(1);
    expect(permanentMarkers()).toEqual([{ id: CATALOG_EXPANSION_VERSION }]);
  });

  it('rechecks the completion marker inside concurrent batches after an intervening delete', async () => {
    afterFirstBatch = () => sqlite.exec("DELETE FROM products WHERE id='P005'");
    await Promise.all([
      ensureExpandedCatalog(context.database!),
      ensureExpandedCatalog(context.database!),
    ]);
    expect(batchCount).toBe(2);
    expect(count('products')).toBe(19);
    expect(sqlite.prepare("SELECT id FROM products WHERE id='P005'").get()).toBeUndefined();
    expect(permanentMarkers()).toEqual([{ id: CATALOG_EXPANSION_VERSION }]);
  });

  it.each([3, 21])('rolls back a failed expansion at statement %i and safely retries', async (statement) => {
    insertExistingData();
    const before = products();
    const beforeOrders = sqlite.prepare('SELECT * FROM orders').all();
    const beforeItems = sqlite.prepare('SELECT * FROM order_items').all();
    failAfterStatement = statement;
    await expect(ensureExpandedCatalog(context.database!)).rejects.toThrow('simulated batch failure');
    expect(products()).toEqual(before);
    expect(permanentMarkers()).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM orders').all()).toEqual(beforeOrders);
    expect(sqlite.prepare('SELECT * FROM order_items').all()).toEqual(beforeItems);
    await ensureExpandedCatalog(context.database!);
    expect(count('products')).toBe(24);
    expect(sqlite.prepare("SELECT * FROM products WHERE id <= 'P004' ORDER BY id").all()).toEqual(before);
    expect(permanentMarkers()).toEqual([{ id: CATALOG_EXPANSION_VERSION }]);
  });

  it('respects a completed version even when the entire expanded catalog was deleted', async () => {
    sqlite.prepare('INSERT INTO operation_guards(id,ok) VALUES (?,1)').run(CATALOG_EXPANSION_VERSION);
    await ensureExpandedCatalog(context.database!);
    expect(count('products')).toBe(0);
    expect(batchCount).toBe(0);
    expect(permanentMarkers()).toEqual([{ id: CATALOG_EXPANSION_VERSION }]);
  });
});
