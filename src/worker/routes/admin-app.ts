// Serves the staff app (Vite build) under /dashboard. Cloudflare Access protects /dashboard* at the
// edge; the API checks Access itself, so this shell needs no check.
import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const APP_BASE = '/dashboard';

const SHELL_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

export const adminApp = new Hono<AppEnv>();

adminApp.get('/', (c) => c.redirect(`${APP_BASE}/`, 302));

// The staff app used to live under /admin: old bookmarks land on the same page.
adminApp.on('GET', ['/admin', '/admin/*'], (c) => {
  const url = new URL(c.req.url);
  const rest = url.pathname.slice('/admin'.length) || '/';
  return c.redirect(`${APP_BASE}${rest}${url.search}`, 301);
});

adminApp.on('GET', `${APP_BASE}/assets/*`, (c) => c.env.ASSETS.fetch(c.req.raw));

adminApp.on('GET', [APP_BASE, `${APP_BASE}/`, `${APP_BASE}/*`], async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL(`${APP_BASE}/index.html`, c.req.url)));
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries(SHELL_HEADERS)) out.headers.set(k, v);
  return out;
});
