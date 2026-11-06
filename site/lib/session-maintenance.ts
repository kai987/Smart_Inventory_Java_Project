const INTERVAL_SECONDS = 5 * 60;
const FAILURE_RETRY_SECONDS = 60;
const BATCH_SIZE = 100;

type SweepState = { nextRunAt: number; inFlight: Promise<void> | null };
const states = new WeakMap<D1Database, SweepState>();

// Serverless maintenance: run at most once per interval per isolate on API
// access. No traffic means no idle job; the next access resumes bounded work.
export function maybeCleanupExpiredSessions(
  database: D1Database,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  let state = states.get(database);
  if (!state) {
    state = { nextRunAt: -Infinity, inFlight: null };
    states.set(database, state);
  }
  if (state.inFlight) return state.inFlight;
  if (nowSeconds < state.nextRunAt) return Promise.resolve();
  const current = state;
  current.inFlight = Promise.resolve().then(async () => {
    try {
      // The existing expiry index bounds the scan. Recheck expiry in the same
      // statement so a refreshed active session is never removed by the sweep.
      await database.prepare(`
        DELETE FROM sessions
        WHERE session_id IN (
          SELECT session_id FROM sessions WHERE expires_at <= ?
          ORDER BY expires_at ASC, session_id ASC LIMIT ?
        ) AND expires_at <= ?
      `).bind(nowSeconds, BATCH_SIZE, nowSeconds).run();
      current.nextRunAt = nowSeconds + INTERVAL_SECONDS;
    } catch {
      current.nextRunAt = nowSeconds + FAILURE_RETRY_SECONDS;
      // Never include session IDs, tokens, SQL bindings, or driver errors.
      console.warn('Expired session maintenance failed; it will retry later.');
    } finally {
      current.inFlight = null;
    }
  });
  return current.inFlight;
}
