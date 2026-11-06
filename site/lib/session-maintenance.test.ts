import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { maybeCleanupExpiredSessions } from './session-maintenance';

let sqlite: DatabaseSync;
let database: D1Database;
let run: Mock<(sql: string, values: number[]) => Promise<{ success: boolean }>>;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE sessions(session_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, csrf_token TEXT);
    CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
    CREATE TABLE preserved(value TEXT);
    INSERT INTO preserved VALUES ('real data is not part of maintenance');`);
  run = vi.fn(async (sql: string, values: number[]) => {
    sqlite.prepare(sql).run(...values);
    return { success: true };
  });
  database = { prepare: (sql: string) => ({ bind: (...values: number[]) => ({ run: () => run(sql, values) }) }) } as unknown as D1Database;
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });
const ids = () => sqlite.prepare('SELECT session_id FROM sessions ORDER BY session_id').all().map((row) => row.session_id);

describe('bounded access-driven expired session maintenance', () => {
  it('deletes oldest expired rows in batches of 100, including the exact expiry boundary, preserving active rows', async () => {
    for (let i = 0; i < 105; i++) sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run(`expired-${String(i).padStart(3, '0')}`, 900 + i, 'secret');
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run('active', 2000, 'secret');
    await maybeCleanupExpiredSessions(database, 1004);
    expect(ids()).toEqual(['active', ...Array.from({ length: 5 }, (_, i) => `expired-${100 + i}`)]);
    await maybeCleanupExpiredSessions(database, 1303);
    expect(run).toHaveBeenCalledTimes(1);
    await maybeCleanupExpiredSessions(database, 1304);
    expect(ids()).toEqual(['active']);
    expect(sqlite.prepare('SELECT * FROM preserved').all()).toHaveLength(1);
  });
  it('does not remove a session refreshed beyond the captured cutoff', async () => {
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run('refreshed', 999, 'secret');
    sqlite.prepare('UPDATE sessions SET expires_at=2000 WHERE session_id=?').run('refreshed');
    await maybeCleanupExpiredSessions(database, 1000);
    expect(ids()).toEqual(['refreshed']);
    expect(run.mock.calls[0][1]).toEqual([1000, 100, 1000]);
  });
  it('single-flights concurrent requests and skips subsequent requests before the interval', async () => {
    const first = maybeCleanupExpiredSessions(database, 1000);
    expect(maybeCleanupExpiredSessions(database, 1000)).toBe(first);
    await Promise.all([first, maybeCleanupExpiredSessions(database, 1001)]);
    await maybeCleanupExpiredSessions(database, 1299);
    expect(run).toHaveBeenCalledTimes(1);
    await maybeCleanupExpiredSessions(database, 1300);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('fails open without secrets and retries after 60 seconds, not on every request', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    run.mockRejectedValueOnce(new Error('database error including secret-session-id'));
    await expect(maybeCleanupExpiredSessions(database, 1000)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Expired session maintenance failed; it will retry later.');
    await maybeCleanupExpiredSessions(database, 1059);
    expect(run).toHaveBeenCalledTimes(1);
    await maybeCleanupExpiredSessions(database, 1060);
    expect(run).toHaveBeenCalledTimes(2);
    await maybeCleanupExpiredSessions(database, 1359);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('keeps maintenance state scoped to the database binding', async () => {
    await maybeCleanupExpiredSessions(database, 1000);
    const other = { prepare: database.prepare.bind(database) } as D1Database;
    await maybeCleanupExpiredSessions(other, 1000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('uses the existing expiry index without a schema migration', async () => {
    await maybeCleanupExpiredSessions(database, 1000);
    const [sql, values] = run.mock.calls[0];
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values);
    expect(plan.some((row) => String(row.detail).includes('idx_sessions_expires_at'))).toBe(true);
  });
});
