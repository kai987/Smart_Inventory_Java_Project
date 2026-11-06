import { DatabaseSync } from 'node:sqlite';
import { hashSync } from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock('./database', () => ({ ensureDatabase: async () => context.database! }));
vi.mock('cloudflare:workers', () => ({ env: {} }));
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
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY, username TEXT REFERENCES users(username), csrf_token TEXT, expires_at INTEGER);
  `);
  sqlite.prepare('INSERT INTO users VALUES (?,?,?)').run('customer', hashSync('valid-password', 4), 'CUSTOMER');
  const now = Math.floor(Date.now() / 1000);
  for (const [id, username, expiresAt] of [
    ['customer-session', 'customer', now + 1800],
    ['expired-session', 'customer', now - 1],
    ['anonymous-session', null, now + 1800],
  ] as const) {
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(id, username, 'test-token', expiresAt);
  }
  context.database = { prepare: (sql: string) => new Prepared(sql) } as unknown as D1Database;
});

afterEach(() => sqlite.close());

function request(path: string, session: string, body?: unknown) {
  return handleApiRequest(new Request(`http://localhost/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: `SMART_INVENTORY_SESSION=${session}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'test-token' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

describe('authentication wire contract shared with the React clients', () => {
  it('returns UNAUTHENTICATED when an authenticated session cookie has expired', async () => {
    const response = await request('orders/me', 'expired-session');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', path: '/api/orders/me', fieldErrors: [] });
    expect(sqlite.prepare('SELECT session_id FROM sessions WHERE session_id=?').get('expired-session')).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns FORBIDDEN when a customer attempts an administrator read', async () => {
    const response = await request('admin/summary', 'customer-session');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: 403, code: 'FORBIDDEN', path: '/api/admin/summary', fieldErrors: [] });
    expect(sqlite.prepare('SELECT username FROM sessions WHERE session_id=?').get('customer-session')).toEqual({ username: 'customer' });
  });

  it('returns INVALID_CREDENTIALS for a rejected login without authenticating the browser session', async () => {
    const response = await request('auth/login', 'anonymous-session', { username: 'customer', password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', path: '/api/auth/login', fieldErrors: [] });
    expect(sqlite.prepare('SELECT username FROM sessions WHERE session_id=?').get('anonymous-session')).toEqual({ username: null });
  });

  it('returns USERNAME_EXISTS for an already registered username without changing its account', async () => {
    const before = sqlite.prepare('SELECT * FROM users WHERE username=?').get('customer');
    const response = await request('auth/register', 'anonymous-session', { username: 'customer', password: 'new-password' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: 409, code: 'USERNAME_EXISTS', path: '/api/auth/register', fieldErrors: [] });
    expect(sqlite.prepare('SELECT * FROM users WHERE username=?').get('customer')).toEqual(before);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
  });
});
