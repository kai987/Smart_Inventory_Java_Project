import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  sqlite.exec(readFileSync(new URL('../drizzle/0000_dashing_betty_brant.sql', import.meta.url), 'utf8')
    .replaceAll('--> statement-breakpoint', ''));
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
    expect(counts()).toEqual([4, 4, 2, 3, 0, 0]);
    expect(schema()).toEqual(before);
    expect(preparedSql.every((sql) => !/\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(true);
    expect(batchCount).toBe(1);
  });

  it('preserves an existing partial dataset instead of adding demo records', async () => {
    sqlite.exec("INSERT INTO users VALUES ('existing','unused','CUSTOMER')");
    sqlite.exec("INSERT INTO products VALUES ('P999','Existing item','123',7,1)");
    const { ensureDatabase } = await coldModule();
    await ensureDatabase();
    expect(counts()).toEqual([1, 1, 0, 0, 0, 0]);
    expect(sqlite.prepare("SELECT stock FROM products WHERE id='P999'").get()!.stock).toBe(7);
    expect(batchCount).toBe(0);
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
    expect(batchCount).toBe(1);
  });

  it('keeps a deliberately empty product catalog empty', async () => {
    await (await coldModule()).ensureDatabase();
    sqlite.exec('DELETE FROM products');
    await (await coldModule()).ensureDatabase();
    expect(count('products')).toBe(0);
    expect(count('users')).toBe(4);
    expect(batchCount).toBe(1);
  });

  it('deduplicates simultaneous requests in one isolate', async () => {
    const { ensureDatabase } = await coldModule();
    await Promise.all([ensureDatabase(), ensureDatabase(), ensureDatabase()]);
    expect(counts()).toEqual([4, 4, 2, 3, 0, 0]);
    expect(batchCount).toBe(1);
  });

  it('rechecks emptiness inside each concurrent isolate batch', async () => {
    const first = await coldModule();
    const second = await coldModule();
    afterFirstBatch = () => sqlite.exec("DELETE FROM products WHERE id='P001'");
    await Promise.all([first.ensureDatabase(), second.ensureDatabase()]);
    expect(batchCount).toBe(2);
    expect(counts()).toEqual([4, 3, 2, 3, 0, 0]);
    expect(sqlite.prepare("SELECT id FROM products WHERE id='P001'").get()).toBeUndefined();
  });

  it('rolls back failed seeds and retries without retaining a guard or partial data', async () => {
    failAfterStatement = 3;
    const { ensureDatabase } = await coldModule();
    await expect(ensureDatabase()).rejects.toThrow('simulated batch failure');
    expect(counts()).toEqual([0, 0, 0, 0, 0, 0]);
    await ensureDatabase();
    expect(counts()).toEqual([4, 4, 2, 3, 0, 0]);
  });

  it('does not seed when any existing session data is present', async () => {
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('existing-session', null, 'unused', 1);
    await (await coldModule()).ensureDatabase();
    expect(counts()).toEqual([0, 0, 0, 0, 1, 0]);
    expect(batchCount).toBe(0);
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
