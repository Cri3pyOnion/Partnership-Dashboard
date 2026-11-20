import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/worker/env';
import { createApp } from '../../src/worker/index';
import { FakeRepo } from '../fake-repo';

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function envWithAssets(seen: string[]): Env {
  const ASSETS = {
    fetch: async (input: Request | string | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(url.pathname);
      if (url.pathname === '/admin/index.html') return new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/admin/assets/x.js') return new Response('console.log(1)', { headers: { 'content-type': 'text/javascript' } });
      return new Response('nope', { status: 404 });
    },
  } as unknown as Fetcher;
  return { ...(testEnv as unknown as Env), ASSETS } as Env;
}

async function get(path: string, env: Env) {
  const app = createApp({ makeRepo: () => new FakeRepo() });
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`https://portal.example.com${path}`, { redirect: 'manual' }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('staff app shell', () => {
  it('redirects / to /admin/', async () => {
    const res = await get('/', envWithAssets([]));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!, 'https://portal.example.com').pathname).toBe('/admin/');
  });

  it.each(['/admin', '/admin/', '/admin/partners/TSP0001', '/admin/statements/TSP0001/2026-11'])('serves index.html with the CSP for %s', async (path) => {
    const seen: string[] = [];
    const res = await get(path, envWithAssets(seen));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
    expect(seen).toEqual(['/admin/index.html']);
    expect(res.headers.get('content-security-policy')).toBe(CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('passes /admin/assets/* straight through', async () => {
    const seen: string[] = [];
    const res = await get('/admin/assets/x.js', envWithAssets(seen));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
    expect(seen).toEqual(['/admin/assets/x.js']);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('leaves /p and /api alone', async () => {
    const env = envWithAssets([]);
    expect((await get('/p/not-a-token', env)).status).toBe(404);
    expect((await get('/api/admin/me', env)).status).toBe(401);
  });
});
