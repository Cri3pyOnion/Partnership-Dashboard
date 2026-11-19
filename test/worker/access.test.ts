import { Hono } from 'hono';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { CryptoKey, JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Staff } from '../../src/shared/types';
import { requireStaff } from '../../src/worker/access';
import type { AppEnv, Env } from '../../src/worker/env';
import { createApp } from '../../src/worker/index';
import { FakeRepo } from '../fake-repo';

const TEAM = 'tohs.cloudflareaccess.com';
const AUD = 'test-aud-tag';
const ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as Env;

const admin: Staff = { email: 'boss@tohsign.com', name: 'Boss', role: 'admin', team: 'IT', active: true };
const staff: Staff = { email: 'clerk@tohsign.com', name: 'Clerk', role: 'staff', team: '市场部', active: true };
const gone: Staff = { email: 'gone@tohsign.com', name: 'Gone', role: 'admin', team: null, active: false };

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'k1' };
  jwks = createLocalJWKSet({ keys: [jwk] });
  otherKey = (await generateKeyPair('RS256')).privateKey;
});

function sign(
  email: string | undefined,
  o: { aud?: string; iss?: string; exp?: string | number; key?: CryptoKey } = {},
) {
  const jwt = new SignJWT(email === undefined ? {} : { email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '5m');
  return jwt.sign(o.key ?? privateKey);
}

async function seeded() {
  const repo = new FakeRepo();
  for (const s of [admin, staff, gone]) await repo.saveStaff(s, 'test');
  return repo;
}

function buildApp(repo: FakeRepo) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('repo', repo);
    await next();
  });
  app.get('/any', requireStaff({ jwks }), (c) => c.json({ email: c.var.staff.email }));
  app.get('/admin', requireStaff({ role: 'admin', jwks }), (c) => c.json({ email: c.var.staff.email }));
  return app;
}

async function call(app: Hono<AppEnv>, path: string, token?: string) {
  const headers: Record<string, string> = token ? { 'Cf-Access-Jwt-Assertion': token } : {};
  return app.request(path, { headers }, ENV);
}

describe('requireStaff', () => {
  it('401 without the header', async () => {
    const res = await call(buildApp(await seeded()), '/any');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
  });

  it('401 on wrong audience', async () => {
    const res = await call(buildApp(await seeded()), '/any', await sign(admin.email, { aud: 'other' }));
    expect(res.status).toBe(401);
  });

  it('401 on wrong issuer', async () => {
    const res = await call(buildApp(await seeded()), '/any', await sign(admin.email, { iss: 'https://evil.example.com' }));
    expect(res.status).toBe(401);
  });

  it('401 on expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const res = await call(buildApp(await seeded()), '/any', await sign(admin.email, { exp: past }));
    expect(res.status).toBe(401);
  });

  it('401 on bad signature', async () => {
    const res = await call(buildApp(await seeded()), '/any', await sign(admin.email, { key: otherKey }));
    expect(res.status).toBe(401);
  });

  it('401 on garbage token or missing email claim', async () => {
    const app = buildApp(await seeded());
    expect((await call(app, '/any', 'not-a-jwt')).status).toBe(401);
    expect((await call(app, '/any', await sign(undefined))).status).toBe(401);
  });

  it('403 when email is not staff', async () => {
    const res = await call(buildApp(await seeded()), '/any', await sign('nobody@example.com'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '没有权限' });
  });

  it('403 for inactive staff', async () => {
    const res = await call(buildApp(await seeded()), '/any', await sign(gone.email));
    expect(res.status).toBe(403);
  });

  it('403 for role staff on an admin-only route', async () => {
    const res = await call(buildApp(await seeded()), '/admin', await sign(staff.email));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '没有权限' });
  });

  it('200 for staff on a plain route', async () => {
    const res = await call(buildApp(await seeded()), '/any', await sign(staff.email));
    expect(res.status).toBe(200);
  });

  it('200 for admin and sets c.var.staff', async () => {
    const res = await call(buildApp(await seeded()), '/admin', await sign(admin.email));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: admin.email });
  });

  it('matches an uppercase email in the token', async () => {
    const res = await call(buildApp(await seeded()), '/admin', await sign('Boss@TohSign.COM'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: admin.email });
  });

  it('503 when the repo fails', async () => {
    const repo = await seeded();
    repo.failNext();
    const res = await call(buildApp(repo), '/any', await sign(admin.email));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: '数据库暂时无法连接，请稍后再试' });
  });
});

describe('GET /api/admin/me', () => {
  it('returns the signed-in staff member', async () => {
    const repo = await seeded();
    const app = createApp({ makeRepo: () => repo, jwks });
    const res = await app.request('/api/admin/me', { headers: { 'Cf-Access-Jwt-Assertion': await sign(staff.email) } }, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: staff.email, name: 'Clerk', role: 'staff', team: '市场部' });
  });

  it('401 without a token', async () => {
    const app = createApp({ makeRepo: () => new FakeRepo(), jwks });
    const res = await app.request('/api/admin/me', {}, ENV);
    expect(res.status).toBe(401);
  });
});
