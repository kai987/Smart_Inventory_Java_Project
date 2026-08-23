import { ensureDatabase } from './database';
import type { FieldError, Role } from './domain';

const SESSION_COOKIE = 'SMART_INVENTORY_SESSION';
const SESSION_TTL_SECONDS = 30 * 60;

export type UserRecord = {
  username: string;
  password_hash: string;
  role: Role;
};

export type SessionRecord = {
  session_id: string;
  username: string | null;
  csrf_token: string;
  expires_at: number;
};

export type SessionContext = {
  session: SessionRecord;
  cookie: string;
};

export class ApiFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
  }
}

function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function cookieValue(request: Request, sessionId: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function parseCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === SESSION_COOKIE) return valueParts.join('=') || null;
  }
  return null;
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function empty(status = 204, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(null, { status, headers: responseHeaders });
}

export function faultResponse(fault: ApiFault, request: Request): Response {
  return json({
    timestamp: new Date().toISOString(),
    status: fault.status,
    code: fault.code,
    message: fault.message,
    path: new URL(request.url).pathname,
    fieldErrors: fault.fieldErrors,
  }, fault.status);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiFault(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }
  try {
    return await request.json();
  } catch {
    throw new ApiFault(400, 'INVALID_JSON', 'The JSON request body is malformed.');
  }
}

export async function getSession(request: Request, create: boolean): Promise<SessionContext | null> {
  const database = await ensureDatabase();
  const now = Math.floor(Date.now() / 1000);
  const existingId = parseCookie(request);
  if (existingId) {
    const session = await database.prepare(
      'SELECT session_id, username, csrf_token, expires_at FROM sessions WHERE session_id = ?',
    ).bind(existingId).first<SessionRecord>();
    if (session && session.expires_at > now) {
      const expiresAt = now + SESSION_TTL_SECONDS;
      await database.prepare('UPDATE sessions SET expires_at = ? WHERE session_id = ?')
        .bind(expiresAt, session.session_id).run();
      return {
        session: { ...session, expires_at: expiresAt },
        cookie: cookieValue(request, session.session_id),
      };
    }
    await database.prepare('DELETE FROM sessions WHERE session_id = ?').bind(existingId).run();
  }
  if (!create) return null;
  const session: SessionRecord = {
    session_id: randomToken(),
    username: null,
    csrf_token: randomToken(),
    expires_at: now + SESSION_TTL_SECONDS,
  };
  await database.prepare(
    'INSERT INTO sessions(session_id, username, csrf_token, expires_at) VALUES (?, NULL, ?, ?)',
  ).bind(session.session_id, session.csrf_token, session.expires_at).run();
  return { session, cookie: cookieValue(request, session.session_id) };
}

export async function requireCsrf(request: Request): Promise<SessionContext> {
  const context = await getSession(request, true);
  const supplied = request.headers.get('x-csrf-token');
  if (!context || !supplied || supplied !== context.session.csrf_token) {
    throw new ApiFault(403, 'CSRF_INVALID', 'The CSRF token is missing or invalid.');
  }
  return context;
}

export async function requireUser(request: Request, role?: Role): Promise<{ context: SessionContext; user: UserRecord }> {
  const context = await getSession(request, false);
  if (!context?.session.username) {
    throw new ApiFault(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }
  const database = await ensureDatabase();
  const user = await database.prepare(
    'SELECT username, password_hash, role FROM users WHERE username = ?',
  ).bind(context.session.username).first<UserRecord>();
  if (!user) throw new ApiFault(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  if (role && user.role !== role) throw new ApiFault(403, 'ACCESS_DENIED', 'You do not have permission to perform this action.');
  return { context, user };
}

export async function rotateAuthenticatedSession(context: SessionContext, username: string): Promise<SessionContext> {
  const database = await ensureDatabase();
  const nextToken = randomToken();
  await database.prepare('UPDATE sessions SET username = ?, csrf_token = ? WHERE session_id = ?')
    .bind(username, nextToken, context.session.session_id).run();
  return { ...context, session: { ...context.session, username, csrf_token: nextToken } };
}

export async function destroySession(request: Request, context: SessionContext): Promise<string> {
  const database = await ensureDatabase();
  await database.prepare('DELETE FROM sessions WHERE session_id = ?').bind(context.session.session_id).run();
  return cookieValue(request, '', 0);
}

export function withSession(response: Response, context: SessionContext): Response {
  const headers = new Headers(response.headers);
  headers.set('Set-Cookie', context.cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
