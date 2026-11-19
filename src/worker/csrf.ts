// CSRF protection for the staff API. Cloudflare Access logs staff in with a cookie, so a page on
// another site must never be able to make a staff member's browser write to /api/admin.
import type { Context, MiddlewareHandler } from 'hono';
import { csrf } from 'hono/csrf';
import type { AppEnv } from './env';

const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/i;

/**
 * The portal's own origin (PUBLIC_BASE_URL). Any http://localhost:<port> as well, but only when
 * PUBLIC_BASE_URL itself is localhost (local development).
 */
export function isAllowedOrigin(origin: string, c: Context<AppEnv>): boolean {
  let base: URL;
  let o: URL;
  try {
    base = new URL((c.env.PUBLIC_BASE_URL ?? '').trim());
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.origin === base.origin) return true;
  return base.hostname === 'localhost' && o.protocol === 'http:' && o.hostname === 'localhost';
}

/**
 * Hono's csrf() checks the request types a plain HTML form can send. The second check applies the
 * same rule (an allowed Origin, or Sec-Fetch-Site: same-origin) to every other unsafe request too,
 * such as JSON bodies and document uploads that keep their file Content-Type.
 */
export function staffCsrf(): MiddlewareHandler<AppEnv>[] {
  const forms = csrf({ origin: (origin, c) => isAllowedOrigin(origin, c as Context<AppEnv>) });
  const everyWrite: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (SAFE_METHOD.test(c.req.method)) return next();
    const origin = c.req.header('Origin');
    if (c.req.header('Sec-Fetch-Site') === 'same-origin' || (origin !== undefined && isAllowedOrigin(origin, c))) {
      return next();
    }
    return c.json({ error: '请求来源不正确' }, 403);
  };
  return [forms, everyWrite];
}
