import { env as testEnv } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Staff } from '../../src/shared/types';
import { linkMessage, whatsappLink } from '../../src/shared/whatsapp';
import type { Env } from '../../src/worker/env';
import { RepoError } from '../../src/worker/repo';
import { hashToken } from '../../src/worker/token';
import { createApp } from '../../src/worker/index';
import { FakeRepo } from '../fake-repo';
import { caseInput, partnerInput } from '../repo/repo.contract';
import { AUD, TEAM, makeAccess } from './access-helper';
import { SAME_ORIGIN, sameOriginFor } from './admin-helper';

const ENV = { ...(testEnv as unknown as Env), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as Env;
const LINK_RE = /^https:\/\/partners\.tohssignlicense\.com\/p\/([A-Za-z0-9_-]{43})$/;
const DAY = 86_400_000;
const DB_DOWN = { error: '数据库暂时无法连接，请稍后再试' };

const admin: Staff = { email: 'boss@tohsign.com', name: 'Boss', role: 'admin', team: 'IT', active: true };
const clerk: Staff = { email: 'clerk@tohsign.com', name: 'Clerk', role: 'staff', team: '市场部', active: true };

let sign: (email: string) => Promise<string>;
let jwks: Awaited<ReturnType<typeof makeAccess>>['jwks'];
beforeAll(async () => {
  ({ sign, jwks } = await makeAccess());
});

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Tan Wei Ming', phone: '012-345 6789', email: 'tan@example.com', code: 'A1', filledBy: 'Transmission', ...over,
});

async function setup(now?: () => Date) {
  const repo = new FakeRepo(now ? { now } : {});
  await repo.saveStaff(admin, 't');
  await repo.saveStaff(clerk, 't');
  const app = createApp({ makeRepo: () => repo, jwks });
  async function req(who: Staff | null, method: string, path: string, json?: unknown, env: Env = ENV) {
    const headers: Record<string, string> = { ...sameOriginFor(method) };
    if (who) headers['Cf-Access-Jwt-Assertion'] = await sign(who.email);
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    return app.request(
      `/api/admin/partners${path}`,
      { method, headers, body: json === undefined ? undefined : JSON.stringify(json) },
      env,
    );
  }
  return { repo, app, req };
}

/** A KV whose delete is replaced; everything else hits the real test namespace. */
function kvWithDelete(del: (k: string, real: KVNamespace) => Promise<void>): Env {
  const real = ENV.VIEWS;
  const kv = new Proxy(real, {
    get(t, prop) {
      if (prop === 'delete') return (k: string) => del(k, real);
      const v = Reflect.get(t, prop);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { ...ENV, VIEWS: kv } as Env;
}

describe('whatsapp helpers', () => {
  it('builds a wa.me link', () => {
    expect(whatsappLink('+60123384521', 'hi')).toBe('https://wa.me/60123384521?text=hi');
    expect(whatsappLink('+60 12-338 4521', '您好')).toBe(`https://wa.me/60123384521?text=${encodeURIComponent('您好')}`);
    expect(whatsappLink('', 'x')).toBe('');
  });
  it('builds the link message', () => {
    expect(linkMessage({ name: 'Tan Wei Ming' }, 'https://x/p/t')).toBe(
      "您好 Tan Wei Ming，这是您的 Toh's Sign 伙伴专属页面（只读）：https://x/p/t",
    );
  });
});

describe('auth', () => {
  it('401 without a token', async () => {
    const { req } = await setup();
    expect((await req(null, 'GET', '')).status).toBe(401);
    expect((await req(null, 'POST', '', body())).status).toBe(401);
  });
});

describe('POST /', () => {
  it('400 on a bad phone', async () => {
    const { req, repo } = await setup();
    const res = await req(clerk, 'POST', '', body({ phone: '03-1234 5678' }));
    expect(res.status).toBe(400);
    const j = (await res.json()) as any;
    expect(j.error).toBe('请检查红色栏位');
    expect(j.fields.phone).toBe('电话号码格式不正确');
    expect(await repo.listPartners({})).toHaveLength(0);
  });

  it('400 on missing name, code, filledBy and bad email, tin, source', async () => {
    const { req } = await setup();
    const res = await req(clerk, 'POST', '', { phone: '0123456789', email: 'nope', tin: 'xx', source: '路过' });
    expect(res.status).toBe(400);
    const { fields } = (await res.json()) as any;
    expect(fields).toMatchObject({
      name: '请填写姓名', email: '电邮格式不正确', tin: '税号格式不正确',
      code: '请选择伙伴代码', filledBy: '请选择填写团队',
    });
    expect(fields.source).toBeTruthy();
    expect(fields.phone).toBeUndefined();
  });

  it('400 on invalid JSON', async () => {
    const { app } = await setup();
    const res = await app.request('/api/admin/partners', {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'Cf-Access-Jwt-Assertion': await sign(clerk.email), 'Content-Type': 'application/json' },
      body: '{oops',
    }, ENV);
    expect(res.status).toBe(400);
  });

  it('201 with TSP0001, 待审核, normalized phone and tin, and an audit row', async () => {
    const { req, repo } = await setup();
    const res = await req(clerk, 'POST', '', body({ tin: 'ig 12345678901', source: '线上', company: '  Kedai ' }));
    expect(res.status).toBe(201);
    const p = (await res.json()) as any;
    expect(p).toMatchObject({
      id: 'TSP0001', status: '待审核', phone: '+60123456789', tin: 'IG12345678901',
      company: 'Kedai', source: '线上', viewToken: null,
    });
    expect(repo.auditLog).toHaveLength(1);
    expect(repo.auditLog[0]).toMatchObject({ by: clerk.email, action: 'partner.create', entity: 'partner', id: 'TSP0001' });
  });

  it('rejects client-controlled id, status, viewToken and registeredAt with 400', async () => {
    const { req, repo } = await setup();
    for (const k of ['id', 'status', 'viewToken', 'registeredAt']) {
      const res = await req(clerk, 'POST', '', body({ [k]: k === 'status' ? '活跃' : 'X' }));
      expect(res.status).toBe(400);
    }
    expect(await repo.listPartners({})).toHaveLength(0);
  });
});

describe('PATCH /:id', () => {
  async function withPartner() {
    const s = await setup();
    const p = await s.repo.createPartner(partnerInput({ code: 'A1', phone: '+60123456789' }), 't');
    return { ...s, p };
  }

  it('updates allowed fields, normalizes, audits', async () => {
    const { req, repo, p } = await withPartner();
    const res = await req(clerk, 'PATCH', `/${p.id}`, { name: 'New Name', phone: '019-876 5432', tin: null, bankName: 'CIMB' });
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toMatchObject({ name: 'New Name', phone: '+60198765432', tin: null, bankName: 'CIMB' });
    expect(repo.auditLog.at(-1)).toMatchObject({ action: 'partner.update', id: p.id, by: clerk.email });
  });

  it('validates fields', async () => {
    const { req, p } = await withPartner();
    const res = await req(clerk, 'PATCH', `/${p.id}`, { phone: '123', email: 'x', name: '', code: 'Z9', filledBy: 'Sales' });
    expect(res.status).toBe(400);
    const { error, fields } = (await res.json()) as any;
    expect(error).toBe('请检查红色栏位');
    expect(fields).toMatchObject({
      phone: '电话号码格式不正确', email: '电邮格式不正确', name: '请填写姓名', code: '请选择伙伴代码', filledBy: '请选择填写团队',
    });
  });

  it('rejects id, viewToken, registeredAt', async () => {
    const { req, repo, p } = await withPartner();
    for (const k of ['id', 'viewToken', 'registeredAt']) {
      expect((await req(clerk, 'PATCH', `/${p.id}`, { [k]: 'hax' })).status).toBe(400);
    }
    expect((await repo.getPartner(p.id))?.viewToken).toBeNull();
  });

  it('status: 不活跃 ok; 活跃 only with a token; 待审核 never', async () => {
    const { req, repo, p } = await withPartner();
    expect((await req(clerk, 'PATCH', `/${p.id}`, { status: '活跃' })).status).toBe(400);
    expect((await req(clerk, 'PATCH', `/${p.id}`, { status: '待审核' })).status).toBe(400);
    expect((await req(clerk, 'PATCH', `/${p.id}`, { status: '不活跃' })).status).toBe(200);
    await repo.updatePartner(p.id, { viewToken: 'T'.repeat(43) }, 't');
    const back = await req(clerk, 'PATCH', `/${p.id}`, { status: '活跃' });
    expect(back.status).toBe(200);
    expect(((await back.json()) as any).status).toBe('活跃');
  });

  it('changing code keeps existing commissions code', async () => {
    const { req, repo, p } = await withPartner();
    const c = await repo.createCase(caseInput(p.id), 't');
    await repo.saveCommission({ caseId: c.id, code: 'A1', amount: 100, basis: 'x', status: '待处理', paidAt: null, paidBy: null });
    const res = await req(clerk, 'PATCH', `/${p.id}`, { code: 'C1' });
    expect(res.status).toBe(200);
    expect((await repo.getPartner(p.id))?.code).toBe('C1');
    expect((await repo.getCommission(c.id))?.code).toBe('A1');
  });

  it('404 for a missing partner', async () => {
    const { req } = await setup();
    const res = await req(clerk, 'PATCH', '/TSP9999', { name: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '找不到伙伴' });
  });

  it('refreshes the stored page when the partner has a link', async () => {
    const { req, p, app } = await withPartner();
    const ap = await req(admin, 'POST', `/${p.id}/approve`);
    const token = /\/p\/(.+)$/.exec(((await ap.json()) as any).link)![1];
    await req(clerk, 'PATCH', `/${p.id}`, { name: 'Renamed Person' });
    const page = await app.request(`/p/${token}`, {}, ENV);
    expect(await page.text()).toContain('Renamed Person');
  });
});

describe('GET /', () => {
  it('filters by status and q; bad status is 400', async () => {
    const { req, repo } = await setup();
    const a = await repo.createPartner(partnerInput({ name: 'Alice Lim' }), 't');
    await repo.createPartner(partnerInput({ name: 'Bob Tan' }), 't');
    await repo.updatePartner(a.id, { status: '活跃' }, 't');
    expect((await (await req(clerk, 'GET', '')).json()) as any[]).toHaveLength(2);
    const act = (await (await req(clerk, 'GET', `?status=${encodeURIComponent('活跃')}`)).json()) as any[];
    expect(act.map((x) => x.name)).toEqual(['Alice Lim']);
    const q = (await (await req(clerk, 'GET', '?q=bob')).json()) as any[];
    expect(q.map((x) => x.name)).toEqual(['Bob Tan']);
    expect((await req(clerk, 'GET', '?status=foo')).status).toBe(400);
  });
});

describe('GET /:id', () => {
  it('returns partner, cases and the last 10 views', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    await repo.createCase(caseInput(p.id), 't');
    for (let i = 0; i < 12; i++) await repo.logLinkView(p.id, 'MY');
    const res = await req(clerk, 'GET', `/${p.id}`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.partner.id).toBe(p.id);
    expect(j.cases).toHaveLength(1);
    expect(j.recentViews).toHaveLength(10);
  });

  it('404 when missing', async () => {
    const { req } = await setup();
    const res = await req(clerk, 'GET', '/TSP0404');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '找不到伙伴' });
  });
});

describe('GET /inactive', () => {
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  const day = (days: number) => ago(days).toISOString().slice(0, 10);

  it('lists active partners whose newest case (or registration) is older than inactiveDays', async () => {
    let t = ago(200);
    const { req, repo } = await setup(() => t);
    const mk = async (name: string) => {
      const p = await repo.createPartner(partnerInput({ name }), 't');
      await repo.updatePartner(p.id, { status: '活跃' }, 't');
      return p;
    };
    const oldCases = await mk('OldCase'); // registered 200d ago, newest case 100d ago
    const recent = await mk('RecentCase'); // newest case 10d ago
    await mk('NoCaseOld'); // registered 200d ago, no cases
    await repo.createPartner(partnerInput({ name: 'Pending' }), 't'); // not 活跃
    await repo.createCase(caseInput(oldCases.id, { submittedAt: day(100) }), 't');
    await repo.createCase(caseInput(oldCases.id, { submittedAt: day(150) }), 't');
    await repo.createCase(caseInput(recent.id, { submittedAt: day(10) }), 't');
    t = ago(5);
    await mk('NoCaseNew'); // registered 5d ago, no cases

    const res = await req(clerk, 'GET', '/inactive');
    expect(res.status).toBe(200);
    const names = ((await res.json()) as any[]).map((p) => p.name).sort();
    expect(names).toEqual(['NoCaseOld', 'OldCase']);
  });

  it('makes exactly one listCases call', async () => {
    const { req, repo } = await setup();
    for (let i = 0; i < 4; i++) {
      const p = await repo.createPartner(partnerInput(), 't');
      await repo.updatePartner(p.id, { status: '活跃' }, 't');
    }
    let n = 0;
    const real = repo.listCases.bind(repo);
    repo.listCases = async (f) => { n++; return real(f); };
    expect((await req(clerk, 'GET', '/inactive')).status).toBe(200);
    expect(n).toBe(1);
  });

  it('respects settings.inactiveDays', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    await repo.updatePartner(p.id, { status: '活跃' }, 't');
    await repo.createCase(caseInput(p.id, { submittedAt: day(40) }), 't');
    expect((await (await req(clerk, 'GET', '/inactive')).json()) as any[]).toHaveLength(0);
    await repo.saveSettings({ ...(await repo.getSettings()), inactiveDays: 30 }, 't');
    expect((await (await req(clerk, 'GET', '/inactive')).json()) as any[]).toHaveLength(1);
  });
});

describe('approve', () => {
  it('403 for staff role', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    expect((await req(clerk, 'POST', `/${p.id}/approve`)).status).toBe(403);
    expect((await repo.getPartner(p.id))?.status).toBe('待审核');
  });

  it('admin approves: 活跃, token issued, link returned, page served, audit without the token', async () => {
    const { req, repo, app } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const res = await req(admin, 'POST', `/${p.id}/approve`);
    expect(res.status).toBe(200);
    const { link } = (await res.json()) as any;
    const m = LINK_RE.exec(link);
    expect(m).not.toBeNull();
    expect(await repo.getPartner(p.id)).toMatchObject({ status: '活跃', viewToken: m![1] });
    expect((await app.request(`/p/${m![1]}`, {}, ENV)).status).toBe(200);
    const row = repo.auditLog.at(-1)!;
    expect(row).toMatchObject({ by: admin.email, action: 'partner.approve', id: p.id });
    expect(JSON.stringify(row)).not.toContain(m![1]);
  });

  it('400 when already 活跃', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    await req(admin, 'POST', `/${p.id}/approve`);
    const res = await req(admin, 'POST', `/${p.id}/approve`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '伙伴已是活跃状态' });
  });

  it('re-approving a 不活跃 partner keeps the existing token', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const first = (await (await req(admin, 'POST', `/${p.id}/approve`)).json()) as any;
    await repo.updatePartner(p.id, { status: '不活跃' }, 't');
    const second = (await (await req(admin, 'POST', `/${p.id}/approve`)).json()) as any;
    expect(second.link).toBe(first.link);
    expect((await repo.getPartner(p.id))?.status).toBe('活跃');
  });

  it('404 for an unknown partner', async () => {
    const { req } = await setup();
    expect((await req(admin, 'POST', '/TSP0404/approve')).status).toBe(404);
  });
});

describe('reset-link', () => {
  async function approved() {
    const s = await setup();
    const p = await s.repo.createPartner(partnerInput(), 't');
    const { link } = (await (await s.req(admin, 'POST', `/${p.id}/approve`)).json()) as any;
    return { ...s, p, oldLink: link as string, oldToken: LINK_RE.exec(link)![1] };
  }

  it('issues a new link; the old token 404s on /p/, the new one works; audited without tokens', async () => {
    const { req, app, repo, p, oldLink, oldToken } = await approved();
    expect((await app.request(`/p/${oldToken}`, {}, ENV)).status).toBe(200);
    const res = await req(clerk, 'POST', `/${p.id}/reset-link`);
    expect(res.status).toBe(200);
    const { link } = (await res.json()) as any;
    expect(link).not.toBe(oldLink);
    const newToken = LINK_RE.exec(link)![1];
    expect((await app.request(`/p/${oldToken}`, {}, ENV)).status).toBe(404);
    expect((await app.request(`/p/${newToken}`, {}, ENV)).status).toBe(200);
    const row = repo.auditLog.at(-1)!;
    expect(row).toMatchObject({ action: 'partner.reset_link', by: clerk.email, id: p.id });
    expect(JSON.stringify(row)).not.toContain(newToken);
    expect(JSON.stringify(row)).not.toContain(oldToken);
  });

  it('400 for a 待审核 partner', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const res = await req(clerk, 'POST', `/${p.id}/reset-link`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '伙伴尚未批准' });
  });

  it('R26: three failed drops give 503 with nothing committed; a later reset revokes the original link', async () => {
    const { req, app, repo, p, oldToken } = await approved();
    let drops = 0;
    const env = kvWithDelete(async () => { drops++; throw new Error('kv down'); });
    const res = await req(clerk, 'POST', `/${p.id}/reset-link`, undefined, env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: '旧链接清除失败，请再试一次' });
    expect(drops).toBe(3);
    expect((await repo.getPartner(p.id))!.viewToken).toBe(oldToken);
    expect((await app.request(`/p/${oldToken}`, {}, ENV)).status).toBe(200);
    const again = await req(clerk, 'POST', `/${p.id}/reset-link`);
    expect(again.status).toBe(200);
    expect((await app.request(`/p/${oldToken}`, {}, ENV)).status).toBe(404);
    expect((await repo.getPartner(p.id))!.viewToken).not.toBe(oldToken);
  });

  it('drops the old page again after the commit, removing a rebuild that slipped in between', async () => {
    const { req, app, repo, p, oldToken } = await approved();
    let calls = 0;
    const env = kvWithDelete(async (k, real) => {
      await real.delete(k);
      if (++calls === 1) {
        // A viewer rebuilds the old page after the first drop, before the commit.
        expect((await app.request(`/p/${oldToken}`, {}, ENV)).status).toBe(200);
      }
    });
    const res = await req(clerk, 'POST', `/${p.id}/reset-link`, undefined, env);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect((await repo.getPartner(p.id))!.viewToken).not.toBe(oldToken);
    expect((await app.request(`/p/${oldToken}`, {}, ENV)).status).toBe(404);
  });

  it('a failing second drop never fails the response', async () => {
    const { req, p } = await approved();
    let calls = 0;
    const env = kvWithDelete(async (k, real) => {
      if (++calls > 1) throw new Error('kv down');
      await real.delete(k);
    });
    expect((await req(clerk, 'POST', `/${p.id}/reset-link`, undefined, env)).status).toBe(200);
  });

  it('succeeds when the drop works on the third try', async () => {
    const { req, p } = await approved();
    let drops = 0;
    const env = kvWithDelete(async (k, real) => {
      if (++drops < 3) throw new Error('flaky');
      await real.delete(k);
    });
    expect((await req(clerk, 'POST', `/${p.id}/reset-link`, undefined, env)).status).toBe(200);
    expect(drops).toBeGreaterThanOrEqual(3);
  });
});

describe('R27 side effects before audit', () => {
  const failAudit = (repo: FakeRepo) => {
    repo.audit = async () => { throw new RepoError('audit down'); };
  };
  const failRebuild = (repo: FakeRepo) => {
    repo.listCases = async () => { throw new RepoError('cases down'); };
  };
  const kvKey = async (token: string) => `view:${await hashToken(token)}`;

  it('audit failure after PATCH still gives 200 and the page was refreshed', async () => {
    const { req, app, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const { link } = (await (await req(admin, 'POST', `/${p.id}/approve`)).json()) as any;
    const token = LINK_RE.exec(link)![1];
    failAudit(repo);
    const res = await req(clerk, 'PATCH', `/${p.id}`, { name: 'After Audit Fail' });
    expect(res.status).toBe(200);
    expect(await (await app.request(`/p/${token}`, {}, ENV)).text()).toContain('After Audit Fail');
  });

  it('audit failure after approve still returns the link, and the page is live', async () => {
    const { req, app, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    failAudit(repo);
    const res = await req(admin, 'POST', `/${p.id}/approve`);
    expect(res.status).toBe(200);
    const token = LINK_RE.exec(((await res.json()) as any).link)![1];
    expect((await repo.getPartner(p.id))!.status).toBe('活跃');
    expect((await app.request(`/p/${token}`, {}, ENV)).status).toBe(200);
  });

  it('audit failure after POST and reset still succeeds', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    await req(admin, 'POST', `/${p.id}/approve`);
    failAudit(repo);
    expect((await req(clerk, 'POST', '', body())).status).toBe(201);
    expect((await req(clerk, 'POST', `/${p.id}/reset-link`)).status).toBe(200);
  });

  it('a failed refresh drops the stored page so the next view rebuilds', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const { link } = (await (await req(admin, 'POST', `/${p.id}/approve`)).json()) as any;
    const token = LINK_RE.exec(link)![1];
    expect(await ENV.VIEWS.get(await kvKey(token))).not.toBeNull();
    failRebuild(repo);
    const res = await req(clerk, 'PATCH', `/${p.id}`, { name: 'Stale Risk' });
    expect(res.status).toBe(200);
    expect(await ENV.VIEWS.get(await kvKey(token))).toBeNull();
  });

  it('approve with a failing refresh still returns the link', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    failRebuild(repo);
    const res = await req(admin, 'POST', `/${p.id}/approve`);
    expect(res.status).toBe(200);
    expect(LINK_RE.test(((await res.json()) as any).link)).toBe(true);
  });
});

describe('KV snapshot TTL', () => {
  it('every put carries expirationTtl 86400', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const opts: unknown[] = [];
    const kv = new Proxy(ENV.VIEWS, {
      get(t, prop) {
        if (prop === 'put') return (k: string, v: string, o?: unknown) => { opts.push(o); return t.put(k, v, o as any); };
        const v = Reflect.get(t, prop);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    await req(admin, 'POST', `/${p.id}/approve`, undefined, { ...ENV, VIEWS: kv } as Env);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts).toEqual(opts.map(() => ({ expirationTtl: 86400 })));
  });
});

describe('input limits and config', () => {
  it('rejects text over 200 characters', async () => {
    const { req } = await setup();
    const res = await req(clerk, 'POST', '', body({ company: 'x'.repeat(201), name: 'n'.repeat(201) }));
    expect(res.status).toBe(400);
    const { fields } = (await res.json()) as any;
    expect(fields.company).toBe('内容过长');
    expect(fields.name).toBe('内容过长');
    expect((await req(clerk, 'POST', '', body({ company: 'x'.repeat(200) }))).status).toBe(201);
  });

  it('empty PATCH is 400', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const res = await req(clerk, 'PATCH', `/${p.id}`, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '没有需要更新的栏位' });
  });

  it('missing PUBLIC_BASE_URL gives 503 before anything is written', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const env = { ...ENV, PUBLIC_BASE_URL: '' } as Env;
    const res = await req(admin, 'POST', `/${p.id}/approve`, undefined, env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: '系统设置不完整' });
    expect((await repo.getPartner(p.id))!.status).toBe('待审核');
    expect((await repo.getPartner(p.id))!.viewToken).toBeNull();
  });

  it('missing PUBLIC_BASE_URL on reset keeps the token', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    const { link } = (await (await req(admin, 'POST', `/${p.id}/approve`)).json()) as any;
    const res = await req(clerk, 'POST', `/${p.id}/reset-link`, undefined, { ...ENV, PUBLIC_BASE_URL: undefined } as unknown as Env);
    expect(res.status).toBe(503);
    expect(`/p/${(await repo.getPartner(p.id))!.viewToken}`).toBe(new URL(link).pathname);
  });
});

describe('repo failures', () => {
  it('RepoError becomes 503 on reads and writes', async () => {
    const { req, repo } = await setup();
    const p = await repo.createPartner(partnerInput(), 't');
    // requireStaff makes the first repo call (getStaff); arm the failure for the route's own call.
    const afterAuth = async (run: () => Promise<Response>) => {
      const real = repo.getStaff.bind(repo);
      repo.getStaff = async (e: string) => {
        const s = await real(e);
        repo.failNext();
        return s;
      };
      try {
        return await run();
      } finally {
        repo.getStaff = real;
      }
    };
    for (const run of [
      () => req(clerk, 'GET', ''),
      () => req(clerk, 'GET', `/${p.id}`),
      () => req(clerk, 'GET', '/inactive'),
      () => req(clerk, 'POST', '', body()),
      () => req(clerk, 'PATCH', `/${p.id}`, { name: 'x' }),
      () => req(admin, 'POST', `/${p.id}/approve`),
    ]) {
      const res = await afterAuth(run);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(DB_DOWN);
    }
  });
});
