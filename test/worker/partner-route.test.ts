import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { refreshOrDrop } from '../../src/worker/admin-support';
import type { Env } from '../../src/worker/env';
import { createApp } from '../../src/worker/index';
import { clearSeenRecently, seenRecently } from '../../src/worker/routes/partner-view';
import type { Repo } from '../../src/worker/repo';
import { hashToken, isTokenShape, newViewToken } from '../../src/worker/token';
import { SNAPSHOT_VERSION, dropPartnerView, getPartnerView, refreshPartnerView } from '../../src/worker/view-cache';
import { FakeRepo } from '../fake-repo';
import { caseInput, partnerInput } from '../repo/repo.contract';

const ENV = { ...(testEnv as unknown as Env), MARKETING_WHATSAPP: '+60 12-345 6789' } as Env;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Wraps a repo and records every method name called on it. */
function spy(repo: Repo): { repo: Repo; calls: string[] } {
  const calls: string[] = [];
  const proxy = new Proxy(repo, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return v.apply(target, args);
      };
    },
  });
  return { repo: proxy, calls };
}

async function seeded() {
  const repo = new FakeRepo({ now: () => new Date('2026-11-03T03:00:00Z') });
  const p = await repo.createPartner(partnerInput({ code: 'C1', bankAccount: '9988776655' }), 't');
  const token = newViewToken();
  await repo.updatePartner(p.id, { status: '活跃', viewToken: token }, 't');
  const c = await repo.createCase(caseInput(p.id, { clientName: 'Kedai Kopi Ah Seng', markup: 300 }), 't');
  await repo.updateCase(c.id, { step: 2 }, 't');
  await repo.saveCommission({ caseId: c.id, code: 'C1', amount: 300, basis: 'x', status: '待处理', paidAt: null, paidBy: null });
  return { repo, partner: p, token };
}

// Every test starts with an empty per-instance view memo (partner ids repeat across tests).
beforeEach(() => clearSeenRecently());

async function get(repo: Repo, path: string, init: RequestInit = {}, env: Env = ENV) {
  const app = createApp({ makeRepo: () => repo });
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`https://portal.example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function expectSecurityHeaders(res: Response, cache: string) {
  expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
  expect(res.headers.get('Cache-Control')).toBe(cache);
}

describe('token', () => {
  it('newViewToken is 43 base64url chars and random', () => {
    const a = newViewToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(a)).toBe(true);
    expect(newViewToken()).not.toBe(a);
  });

  it('isTokenShape rejects other shapes', () => {
    for (const t of ['abc', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + '+', '']) {
      expect(isTokenShape(t)).toBe(false);
    }
  });

  it('hashToken is SHA-256 hex', async () => {
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('GET /p/:token', () => {
  it('/p/abc is 404 链接无效 and never calls the repo', async () => {
    const { repo, calls } = spy(new FakeRepo());
    const res = await get(repo, '/p/abc');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('链接无效');
    expect(calls).toEqual([]);
    expectSecurityHeaders(res, 'no-store');
  });

  it('an unknown 43-character token is 404 链接无效', async () => {
    const res = await get(new FakeRepo(), `/p/${newViewToken()}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('链接无效');
    expectSecurityHeaders(res, 'no-store');
  });

  it('a valid token is 200 with the page and the security headers, and logs the view', async () => {
    const { repo, partner, token } = await seeded();
    const res = await get(repo, `/p/${token}`, { cf: { country: 'MY' } } as RequestInit);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res, 'no-store');
    const html = await res.text();
    expect(html).toContain('Kedai Kopi Ah Seng');
    expect(html).toContain('更新于');
    expect(html).toContain('wa.me/60123456789');
    expect(html).not.toContain('9988776655');
    expect(await repo.listLinkViews(partner.id, 10)).toEqual([{ viewedAt: expect.any(String), country: 'MY' }]);
  });

  it('stores the page in KV under view:<hash>', async () => {
    const { repo, partner, token } = await seeded();
    await get(repo, `/p/${token}`);
    const stored = await ENV.VIEWS.get<{ html: string; updatedAt: string; partnerId: string }>(`view:${await hashToken(token)}`, 'json');
    expect(stored?.partnerId).toBe(partner.id);
    expect(stored?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(stored?.html).toContain(`更新于 ${stored?.updatedAt}`);
  });

  it('a valid token while the repo throws is still 200 from KV, and still logs on a hit', async () => {
    const { repo, partner, token } = await seeded();
    expect((await get(repo, `/p/${token}`)).status).toBe(200);
    const broken = spy(repo);
    repo.listCases = async () => { throw new Error('should not be called'); };
    repo.getPartnerByToken = async () => { throw new Error('should not be called'); };
    clearSeenRecently(); // as if this request landed on another Worker instance
    const res = await get(broken.repo, `/p/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Kedai Kopi Ah Seng');
    expect(broken.calls).toEqual(['logLinkView']);
    // The repo still drops the repeat: same partner, same country, inside the window.
    expect((await repo.listLinkViews(partner.id, 10)).length).toBe(1);
  });

  it('503 暂时无法加载 when the repo fails and KV is empty', async () => {
    const { repo, token } = await seeded();
    repo.failNext();
    const res = await get(repo, `/p/${token}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('暂时无法加载');
    expectSecurityHeaders(res, 'no-store');
  });

  it('after dropPartnerView and a token reset, the old token is 404', async () => {
    const { repo, partner, token } = await seeded();
    expect((await get(repo, `/p/${token}`)).status).toBe(200);
    const fresh = newViewToken();
    await repo.updatePartner(partner.id, { viewToken: fresh }, 't');
    await dropPartnerView(ENV, token);
    const res = await get(repo, `/p/${token}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('链接无效');
    expect((await get(repo, `/p/${fresh}`)).status).toBe(200);
  });

  it('logLinkView throwing does not change the 200', async () => {
    const { repo, token } = await seeded();
    repo.logLinkView = async () => { throw new Error('log down'); };
    const res = await get(repo, `/p/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Kedai Kopi Ah Seng');
    const sync = await seeded();
    sync.repo.logLinkView = (() => { throw new Error('sync throw'); }) as never;
    expect((await get(sync.repo, `/p/${sync.token}`)).status).toBe(200);
  });

  it('other /p/ paths (extra segments, a trailing slash) are the same 404 链接无效 page', async () => {
    const { repo, token } = await seeded();
    for (const path of ['/p/a/b', `/p/${token}/`, `/p/${token}/x`, '/p/', '/p']) {
      const res = await get(repo, path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).toContain('链接无效');
      expectSecurityHeaders(res, 'no-store');
    }
  });

  it('HEAD works', async () => {
    const { repo, token } = await seeded();
    const res = await get(repo, `/p/${token}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });
});

/** A KV namespace whose chosen methods throw; others go to the real one. */
function brokenKV(fail: Array<'get' | 'put' | 'delete'>): KVNamespace {
  return new Proxy(ENV.VIEWS, {
    get(target, prop) {
      if ((fail as string[]).includes(String(prop))) return async () => { throw new Error(`kv ${String(prop)} down`); };
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

const kvKey = async (token: string) => `view:${await hashToken(token)}`;

describe('best-effort KV and unexpected errors (R22)', () => {
  it('a KV get failure falls through to a rebuild', async () => {
    const { repo, token } = await seeded();
    const res = await get(repo, `/p/${token}`, {}, { ...ENV, VIEWS: brokenKV(['get']) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Kedai Kopi Ah Seng');
  });

  it('a KV put failure still returns the page', async () => {
    const { repo, token } = await seeded();
    const res = await get(repo, `/p/${token}`, {}, { ...ENV, VIEWS: brokenKV(['put']) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Kedai Kopi Ah Seng');
    expect(await ENV.VIEWS.get(await kvKey(token))).toBeNull();
  });

  it('a KV put failure on a miss deletes the key (best effort) and still returns the page', async () => {
    const { repo, token } = await seeded();
    const deleted: string[] = [];
    const kv = new Proxy(ENV.VIEWS, {
      get(target, prop) {
        if (prop === 'put') return async () => { throw new Error('429 too many writes'); };
        if (prop === 'delete') return async (k: string) => { deleted.push(k); await target.delete(k); };
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const v = await getPartnerView({ ...ENV, VIEWS: kv }, repo, token);
    expect(v?.html).toContain('Kedai Kopi Ah Seng');
    expect(deleted).toEqual([await kvKey(token)]);
  });

  it('a KV put failure on refresh throws, so refreshOrDrop drops the stale page (R27)', async () => {
    const { repo, partner, token } = await seeded();
    await get(repo, `/p/${token}`); // a snapshot exists
    await repo.createCase(caseInput(partner.id, { clientName: 'Glow Beauty Studio' }), 't');
    const env = { ...ENV, VIEWS: brokenKV(['put']) };
    await expect(refreshPartnerView(env, repo, partner.id)).rejects.toThrow();
    await get(repo, `/p/${token}`); // a snapshot exists again
    expect(await ENV.VIEWS.get(await kvKey(token))).not.toBeNull();
    await repo.createCase(caseInput(partner.id, { clientName: 'Bright Tuition Centre' }), 't');
    await refreshOrDrop(env, repo, partner.id, token);
    expect(await ENV.VIEWS.get(await kvKey(token))).toBeNull();
    expect(await (await get(repo, `/p/${token}`)).text()).toContain('Bright Tuition Centre');
  });

  it('the page previews a case with no commission row, with one getSettings (and none when no row is missing)', async () => {
    const { repo, partner, token } = await seeded();
    const counted = spy(repo);
    await getPartnerView(ENV, counted.repo, token);
    expect(counted.calls.filter((x) => x === 'getSettings')).toEqual([]);
    await dropPartnerView(ENV, token);
    await repo.createCase(caseInput(partner.id, { clientName: 'Glow Beauty Studio', markup: 150 }), 't');
    await repo.createCase(caseInput(partner.id, { clientName: 'Bright Tuition Centre', markup: 250 }), 't');
    const again = spy(repo);
    const v = await getPartnerView(ENV, again.repo, token);
    expect(again.calls.filter((x) => x === 'getSettings')).toEqual(['getSettings']);
    expect(v!.html).toContain('<span class="amt">RM 150</span>');
    expect(v!.html).toContain('<span class="amt">RM 250</span>');
    expect(v!.html).not.toContain('<span class="amt">–</span>');
    expect(v!.html).toContain('RM 700'); // pending tile: 300 + 150 + 250
    expect(await repo.getCommission((await repo.listCases({ partnerId: partner.id }))[0].id)).toBeNull(); // never saved
  });

  it('a malformed KV value falls through to a rebuild', async () => {
    const { repo, token } = await seeded();
    await ENV.VIEWS.put(await kvKey(token), JSON.stringify({ html: 42, partnerId: 'TSP0001' }));
    const res = await get(repo, `/p/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Kedai Kopi Ah Seng');
    await ENV.VIEWS.put(await kvKey(token), 'not json');
    expect((await get(repo, `/p/${token}`)).status).toBe(200);
  });

  it('an unexpected (non-RepoError) error is the 503 page with the security headers', async () => {
    const { repo, token } = await seeded();
    repo.getPartnerByToken = async () => { throw new TypeError('boom'); };
    const res = await get(repo, `/p/${token}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('暂时无法加载');
    expectSecurityHeaders(res, 'no-store');
  });
});

describe('put-then-verify (R20)', () => {
  /** Resets the partner's link (new token + drop) the first time the build lists cases. */
  function resetDuringBuild(repo: FakeRepo, partnerId: string, old: string): { fresh: string } {
    const fresh = newViewToken();
    const real = repo.listCases.bind(repo);
    let done = false;
    repo.listCases = async (f) => {
      if (!done) {
        done = true;
        await repo.updatePartner(partnerId, { viewToken: fresh }, 't');
        await dropPartnerView(ENV, old);
      }
      return real(f);
    };
    return { fresh };
  }

  it('a reset between read and put on a miss leaves no old key and the old link 404s', async () => {
    const { repo, partner, token } = await seeded();
    const { fresh } = resetDuringBuild(repo, partner.id, token);
    await getPartnerView(ENV, repo, token);
    expect(await ENV.VIEWS.get(await kvKey(token))).toBeNull();
    expect((await get(repo, `/p/${token}`)).status).toBe(404);
    expect((await get(repo, `/p/${fresh}`)).status).toBe(200);
  });

  it('a reset during refreshPartnerView leaves no old key', async () => {
    const { repo, partner, token } = await seeded();
    resetDuringBuild(repo, partner.id, token);
    await refreshPartnerView(ENV, repo, partner.id);
    expect(await ENV.VIEWS.get(await kvKey(token))).toBeNull();
    expect((await get(repo, `/p/${token}`)).status).toBe(404);
  });

  it('a failed re-read deletes the key to be safe', async () => {
    const { repo, token } = await seeded();
    repo.getPartner = async () => { throw new Error('re-read down'); };
    const v = await getPartnerView(ENV, repo, token);
    expect(v?.html).toContain('Kedai Kopi Ah Seng');
    expect(await ENV.VIEWS.get(await kvKey(token))).toBeNull();
  });

  it('keeps the key when the token is unchanged', async () => {
    const { repo, token } = await seeded();
    await getPartnerView(ENV, repo, token);
    expect(await ENV.VIEWS.get(await kvKey(token))).not.toBeNull();
  });
});

describe('view cache', () => {
  it('getPartnerView rejects a bad shape without touching KV or the repo', async () => {
    const { repo, calls } = spy(new FakeRepo());
    expect(await getPartnerView(ENV, repo, 'abc')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('refreshPartnerView rebuilds the snapshot with new data', async () => {
    const { repo, partner, token } = await seeded();
    await get(repo, `/p/${token}`);
    await repo.createCase(caseInput(partner.id, { clientName: 'Glow Beauty Studio' }), 't');
    expect((await getPartnerView(ENV, repo, token))!.html).not.toContain('Glow Beauty Studio');
    await refreshPartnerView(ENV, repo, partner.id);
    expect((await getPartnerView(ENV, repo, token))!.html).toContain('Glow Beauty Studio');
  });

  it('refreshPartnerView does nothing for a partner without a token', async () => {
    const repo = new FakeRepo();
    const p = await repo.createPartner(partnerInput(), 't');
    const { repo: r, calls } = spy(repo);
    await refreshPartnerView(ENV, r, p.id);
    expect(calls).toEqual(['getPartner']);
  });

  it('a repo error on a miss propagates', async () => {
    const { repo, token } = await seeded();
    repo.failNext();
    await expect(getPartnerView(ENV, repo, token)).rejects.toThrow();
  });
});

describe('view logging cannot be spammed', () => {
  it('a refresh loop logs once and reaches the repo once', async () => {
    const { repo, partner, token } = await seeded();
    const calls = { n: 0 };
    const real = repo.logLinkView.bind(repo);
    repo.logLinkView = async (id, country) => { calls.n++; return real(id, country); };
    for (let i = 0; i < 20; i++) expect((await get(repo, `/p/${token}`)).status).toBe(200);
    expect(calls.n).toBe(1);
    expect(await repo.listLinkViews(partner.id, 100)).toHaveLength(1);
  });

  it('the per-instance memo expires after the window and is keyed by partner and country', () => {
    const t0 = 1_000_000;
    expect(seenRecently('TSP0001', 'MY', t0)).toBe(false);
    expect(seenRecently('TSP0001', 'MY', t0 + 60_000)).toBe(true);
    expect(seenRecently('TSP0001', 'SG', t0 + 60_000)).toBe(false);
    expect(seenRecently('TSP0002', 'MY', t0 + 60_000)).toBe(false);
    expect(seenRecently('TSP0001', 'MY', t0 + 31 * 60_000)).toBe(false);
  });
});

describe('partner page language', () => {
  const CJK = /[一-鿿]/;
  /** Page text without the switch (its 中文 link) and without the partner's own data. */
  const chromeText = (html: string, data: string[]) => {
    let t = html.replace(/<nav class="lang"[\s\S]*?<\/nav>/, '').replace(/<style>[\s\S]*?<\/style>/, '');
    for (const d of data) t = t.split(d).join('');
    return t;
  };

  it('?lang=en shows the page in English, remembers it, and has the EN | 中文 switch', async () => {
    const { repo, token, partner } = await seeded();
    const res = await get(repo, `/p/${token}?lang=en`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Total referred');
    expect(html).toContain('Submitted to authority');
    expect(html).toContain('<b aria-current="true">EN</b>');
    expect(html).toContain('<a href="?lang=zh" hreflang="zh">中文</a>');
    expect(CJK.test(chromeText(html, [partner.name, 'Kedai Kopi Ah Seng', '营业执照']))).toBe(false);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^lang=en;/);
    expect(cookie).toContain('Path=/p');
    expect(cookie).toContain('HttpOnly');
  });

  it('uses the remembered choice, then the browser language, else Chinese', async () => {
    const { repo, token } = await seeded();
    expect(await (await get(repo, `/p/${token}`, { headers: { Cookie: 'lang=en' } })).text()).toContain('<html lang="en">');
    expect(await (await get(repo, `/p/${token}`, { headers: { 'Accept-Language': 'en-GB,en;q=0.9' } })).text()).toContain('<html lang="en">');
    const zh = await (await get(repo, `/p/${token}`, { headers: { 'Accept-Language': 'en', Cookie: 'lang=zh' } })).text();
    expect(zh).toContain('<html lang="zh">');
    expect(zh).toContain('推荐案件');
    expect(await (await get(repo, `/p/${token}`)).text()).toContain('<html lang="zh">');
  });

  it('the invalid-link page follows the language too', async () => {
    const res = await get(new FakeRepo(), `/p/${'a'.repeat(43)}?lang=en`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('This link is not valid');
  });

  it('a page stored by an older layout is rebuilt in either language on its next visit', async () => {
    const { repo, token } = await seeded();
    await getPartnerView(ENV, repo, token, 'zh');
    const k = `view:${await hashToken(token)}`;
    const stored = JSON.parse((await ENV.VIEWS.get(k)) as string);
    // What the first English release stored: no version, a Chinese page with small English in it.
    await ENV.VIEWS.put(k, JSON.stringify({ html: '<p>旧页面 Old page</p>', htmlEn: stored.htmlEn, updatedAt: stored.updatedAt, partnerId: stored.partnerId }));
    const zh = (await getPartnerView(ENV, repo, token, 'zh'))!.html;
    expect(zh).not.toContain('旧页面');
    expect(zh).toContain('EN</a>');
    expect(JSON.parse((await ENV.VIEWS.get(k)) as string).v).toBe(SNAPSHOT_VERSION);
  });

});
