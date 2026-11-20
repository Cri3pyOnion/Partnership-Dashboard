// Serves the staff app (Vite build) under /admin. Cloudflare Access protects /admin* at the edge;
// the API checks Access itself, so this shell needs no check.
import { Hono } from 'hono';
import type { AppEnv } from '../env';

const SHELL_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

export const adminApp = new Hono<AppEnv>();

adminApp.get('/', (c) => c.redirect('/admin/', 302));

adminApp.on('GET', '/admin/assets/*', (c) => c.env.ASSETS.fetch(c.req.raw));

adminApp.on('GET', ['/admin', '/admin/', '/admin/*'], async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL('/admin/index.html', c.req.url)));
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries(SHELL_HEADERS)) out.headers.set(k, v);
  return out;
});
