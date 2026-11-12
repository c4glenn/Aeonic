import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { Db } from './db';
import { schema } from './db';
import { HttpError } from './problem';

export type Scope = 'read' | 'write';
export interface Auth {
  kind: 'token' | 'session';
  scope: Scope;
}
export type Env = { Variables: { auth: Auth } };

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (prefix = '') => prefix + randomBytes(32).toString('base64url');

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return Promise.resolve(false);
  const expected = Buffer.from(hashHex, 'hex');
  return new Promise((resolve) => {
    scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, (err, derived) =>
      resolve(!err && timingSafeEqual(derived, expected)),
    );
  });
}

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Cookie-authenticated mutating requests must carry this header (CSRF defence). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'todo-web';

export function createSession(db: Db): { id: string; expires: number } {
  const id = randomToken();
  const expires = Date.now() + SESSION_TTL_MS;
  db.insert(schema.sessions).values({ hash: sha256(id), expiresAt: expires }).run();
  return { id, expires };
}

export function destroySession(db: Db, id: string) {
  db.delete(schema.sessions).where(eq(schema.sessions.hash, sha256(id))).run();
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function authMiddleware(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header('authorization');
    let auth: Auth | null = null;

    if (header?.startsWith('Bearer ')) {
      const hash = sha256(header.slice(7).trim());
      const row = db.select().from(schema.tokens).where(eq(schema.tokens.hash, hash)).get();
      if (row) {
        auth = { kind: 'token', scope: row.scope === 'write' ? 'write' : 'read' };
        db.update(schema.tokens)
          .set({ lastUsedAt: new Date().toISOString() })
          .where(eq(schema.tokens.id, row.id))
          .run();
      }
    } else {
      const sid = getCookie(c, SESSION_COOKIE);
      if (sid) {
        const row = db.select().from(schema.sessions).where(eq(schema.sessions.hash, sha256(sid))).get();
        if (row && row.expiresAt > Date.now()) {
          if (MUTATING.has(c.req.method) && c.req.header(CSRF_HEADER) !== CSRF_VALUE) {
            throw new HttpError(403, 'Forbidden', `Missing ${CSRF_HEADER} header`);
          }
          auth = { kind: 'session', scope: 'write' };
        }
      }
    }

    if (!auth) throw new HttpError(401, 'Unauthorized', 'Provide a bearer token or sign in');
    if (MUTATING.has(c.req.method) && auth.scope !== 'write') {
      throw new HttpError(403, 'Forbidden', 'Token has read-only scope');
    }
    c.set('auth', auth);
    await next();
  };
}

/** Tiny in-memory limiter for login attempts. */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= max;
  };
}
