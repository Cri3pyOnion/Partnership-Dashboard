// CSRF: every unsafe /api/admin request must come from the portal's own origin, and JSON bodies
// must say so in their Content-Type.
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/worker/env';
import { partnerInput } from '../repo/repo.contract';
import { ENV, admin, setupAdmin } from './admin-helper';

const SITE = 'https://partners.tohssignlicense.com';
const EVIL = 'https://evil.example';
const partnerBody = { name: 'Tan Wei Ming', phone: '012-345 6789', email: 'tan@example.com', code: 'A1', filledBy: 'Transmission' };

async function ctx() {
  const s = await setupAdmin();
  /** A request with exactly the headers given, plus a valid Access token. */
  async function send(method: string, path: string, headers: Record<string, string>, body?: BodyInit, env: Env = ENV) {
    return s.app.request(path, { method, headers: { 'Cf-Access-Jwt-Assertion': await s.token(admin), ...headers }, body }, env);
  }
  return { ...s, send };
}

describe('CSRF on /api/admin', () => {
  it('a cross-origin JSON POST is 403 and nothing is written', async () => {
    const { send, repo } = await ctx();
    const res = await send('POST', '/api/admin/partners', { 'Content-Type': 'application/json', Origin: EVIL }, JSON.stringify(partnerBody));
    expect(res.status).toBe(403);
    expect(await repo.listPartners({})).toEqual([]);
  });

  it('a cross-site form-style POST (no body, text/plain or form) is 403', async () => {
    const { send, repo } = await ctx();
    const p = await repo.createPartner(partnerInput(), 't');
    for (const headers of <Array<Record<string, string>>>[
      { Origin: EVIL },
      { Origin: EVIL, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: EVIL, 'Content-Type': 'application/x-www-form-urlencoded' },
      { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' },
      {},
    ]) {
      const res = await send('POST', `/api/admin/partners/${p.id}/approve`, headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect((await repo.getPartner(p.id))!.status).toBe('待审核');
  });

  it('a cross-origin document upload keeps its file type but is 403', async () => {
    const { send, repo, activePartner } = await ctx();
    const p = await activePartner('A1');
    const c = await repo.createCase({
      partnerId: p.id, clientName: 'x', clientPhone: null, licenceType: '营业执照', council: null, missingDocs: null,
      price: 1800, markup: null, invoiceNo: null, notesInternal: null,
    }, 't');
    const res = await send('PUT', `/api/admin/cases/${c.id}/documents?filename=a.pdf&kind=IC`, {
      Origin: EVIL, 'Content-Type': 'application/pdf', 'Content-Length': '5',
    }, new Uint8Array([37, 80, 68, 70, 45]));
    expect(res.status).toBe(403);
    expect(await repo.listDocuments(c.id)).toEqual([]);
  });

  it('a same-origin POST passes (by Origin, or by Sec-Fetch-Site: same-origin)', async () => {
    const { send } = await ctx();
    const byOrigin = await send('POST', '/api/admin/partners', { 'Content-Type': 'application/json', Origin: SITE }, JSON.stringify(partnerBody));
    expect(byOrigin.status).toBe(201);
    const byFetchSite = await send('POST', '/api/admin/partners', { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, JSON.stringify(partnerBody));
    expect(byFetchSite.status).toBe(201);
  });

  it('localhost origins pass only when PUBLIC_BASE_URL is itself localhost', async () => {
    const { send } = await ctx();
    const h = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
    expect((await send('POST', '/api/admin/partners', h, JSON.stringify(partnerBody))).status).toBe(403);
    const dev = { ...ENV, PUBLIC_BASE_URL: 'http://localhost:8787' } as Env;
    expect((await send('POST', '/api/admin/partners', h, JSON.stringify(partnerBody), dev)).status).toBe(201);
    expect((await send('POST', '/api/admin/partners', { ...h, Origin: 'http://localhost.evil.example' }, JSON.stringify(partnerBody), dev)).status).toBe(403);
  });

  it('GET is never blocked', async () => {
    const { send } = await ctx();
    expect((await send('GET', '/api/admin/partners', { Origin: EVIL, 'Sec-Fetch-Site': 'cross-site' })).status).toBe(200);
  });

  it('a JSON body without Content-Type application/json is 415', async () => {
    const { send, repo } = await ctx();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await send('POST', '/api/admin/partners', { 'Content-Type': type, Origin: SITE }, JSON.stringify(partnerBody));
      expect(res.status, type).toBe(415);
    }
    expect(await repo.listPartners({})).toEqual([]);
    const p = await repo.createPartner(partnerInput(), 't');
    const c = await send('PATCH', `/api/admin/partners/${p.id}`, { Origin: SITE }, JSON.stringify({ name: 'x' }));
    expect(c.status).toBe(415);
    expect((await repo.getPartner(p.id))!.name).not.toBe('x');
  });
});
