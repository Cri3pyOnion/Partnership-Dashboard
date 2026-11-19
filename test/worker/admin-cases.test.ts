import { describe, expect, it } from 'vitest';
import { RepoError } from '../../src/worker/repo';
import { partnerInput } from '../repo/repo.contract';
import { DB_DOWN, ENV, admin, clerk, setupAdmin } from './admin-helper';

const newCase = (partnerId: string, over: Record<string, unknown> = {}) => ({
  partnerId, clientName: '李先生', clientPhone: '012-3456789', licenceType: '营业执照', council: 'MBPJ', price: 1800, ...over,
});
const kl = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

describe('auth', () => {
  it('401 without a token, 403 for a deactivated staff member', async () => {
    const { req, repo } = await setupAdmin();
    expect((await req(null, 'GET', '/api/admin/cases')).status).toBe(401);
    await repo.saveStaff({ ...clerk, active: false }, 't');
    expect((await req(clerk, 'GET', '/api/admin/cases')).status).toBe(403);
  });
});

describe('POST /api/admin/cases', () => {
  it('creates an A1 case with commission 150 / 待处理', async () => {
    const { req, activePartner, repo, json } = await setupAdmin();
    const p = await activePartner('A1');
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id));
    expect(res.status).toBe(201);
    const c = await json(res);
    expect(c).toMatchObject({ partnerId: p.id, step: 0, price: 1800 });
    expect(c.commission).toMatchObject({ caseId: c.id, code: 'A1', amount: 150, status: '待处理' });
    expect(await repo.getCommission(c.id)).toMatchObject({ amount: 150, status: '待处理' });
    expect(repo.auditLog.at(-1)).toMatchObject({ by: clerk.email, action: 'case.create', entity: 'case', id: c.id });
  });

  it('rejects an unknown or unapproved partner', async () => {
    const { req, repo, json } = await setupAdmin();
    const r1 = await req(clerk, 'POST', '/api/admin/cases', newCase('TSP9999'));
    expect(r1.status).toBe(404);
    expect(await json(r1)).toEqual({ error: '找不到伙伴' });
    const pending = await repo.createPartner(partnerInput(), 't');
    const r2 = await req(clerk, 'POST', '/api/admin/cases', newCase(pending.id));
    expect(r2.status).toBe(400);
    expect(await json(r2)).toEqual({ error: '伙伴尚未批准' });
  });

  it('C1: a markup above maxMarkup is a 400 and nothing is written', async () => {
    const { req, repo, activePartner, json } = await setupAdmin();
    const s = await repo.getSettings();
    s.commissionRules.C1.maxMarkup = 500;
    await repo.saveSettings(s, 't');
    const p = await activePartner('C1');
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { markup: 600 }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('加价超过上限');
    expect(await repo.listCases({})).toHaveLength(0);
    const ok = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { markup: 500 }));
    expect(ok.status).toBe(201);
    expect((await json(ok)).commission).toMatchObject({ amount: 500, code: 'C1' });
  });

  it('markup is only for C1 partners', async () => {
    const { req, activePartner, json } = await setupAdmin();
    const p = await activePartner('A1');
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { markup: 100 }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: '只有 C1 伙伴可以加价' });
  });

  it('checks the licence type against the settings list', async () => {
    const { req, activePartner, json } = await setupAdmin();
    const p = await activePartner();
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { licenceType: '乱写' }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('执照类型不正确');
  });

  it.each([
    ['price -1', { price: -1 }, '金额不正确'],
    ['price string', { price: '1800' }, '金额不正确'],
    ['text too long', { council: 'x'.repeat(201) }, '内容过长'],
    ['client name blank', { clientName: '  ' }, '请填写客户姓名'],
    ['bad date', { submittedAt: '2026-13-40' }, '日期格式不正确'],
  ])('400 on %s', async (_n, over, msg) => {
    const { req, activePartner, repo, json } = await setupAdmin();
    const p = await activePartner();
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, over));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(msg);
    expect(await repo.listCases({})).toHaveLength(0);
  });

  it('only allowed fields reach the repo (step/clientPaid in the body are ignored)', async () => {
    const { req, activePartner, json } = await setupAdmin();
    const p = await activePartner();
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { step: 4, clientPaid: true, id: 'TS-0000-001' }));
    const c = await json(res);
    expect(c).toMatchObject({ step: 0, clientPaid: false });
    expect(c.id).not.toBe('TS-0000-001');
  });

  it('repo outage is a 503', async () => {
    const { req, activePartner, repo, json } = await setupAdmin();
    const p = await activePartner();
    repo.failNext();
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual(DB_DOWN);
  });
});

describe('lifecycle', () => {
  it('create, paid, mark-paid, then a price change leaves 150 / 已支付', async () => {
    const { req, activePartner, json } = await setupAdmin();
    const p = await activePartner('A1');
    const c = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    const paid = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { clientPaid: true }));
    expect(paid.commission).toMatchObject({ amount: 150, status: '可发放' });
    expect(paid.clientPaidAt).toBe(kl(new Date()));
    const mp = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`);
    expect(mp.status).toBe(200);
    expect(await json(mp)).toMatchObject({ status: '已支付', paidBy: admin.email });
    const after = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { price: 900 }));
    expect(after.price).toBe(900);
    expect(after.commission).toMatchObject({ amount: 150, status: '已支付', paidBy: admin.email });
    const cancelled = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { cancelled: true }));
    expect(cancelled.commission).toMatchObject({ amount: 150, status: '已支付' });
  });

  it('a partner code change keeps the commission code of existing cases', async () => {
    const { req, activePartner, repo, json } = await setupAdmin();
    const p = await activePartner('A1');
    const c = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    await repo.updatePartner(p.id, { code: 'B1' }, 't');
    const after = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { price: 2000 }));
    expect(after.commission).toMatchObject({ code: 'A1', amount: 150 });
    const rejected = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { markup: 10 });
    expect(rejected.status).toBe(400);
    expect((await json(rejected)).error).toBe('只有 C1 伙伴可以加价');
  });

  it('cancelling zeroes the commission; un-cancelling restores it', async () => {
    const { req, activePartner, json } = await setupAdmin();
    const p = await activePartner('A1');
    const c = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    const x = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { cancelled: true }));
    expect(x.commission.amount).toBe(0);
    const y = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { cancelled: false }));
    expect(y.commission.amount).toBe(150);
  });
});

describe('PATCH /api/admin/cases/:id', () => {
  async function one(code: 'A1' | 'B1' | 'C1' = 'A1', over: Record<string, unknown> = {}) {
    const ctx = await setupAdmin();
    const p = await ctx.activePartner(code);
    const c = await ctx.json(await ctx.req(clerk, 'POST', '/api/admin/cases', newCase(p.id, over)));
    return { ...ctx, p, c };
  }

  it('404 for an unknown case; 400 for an empty patch', async () => {
    const { req, c, json } = await one();
    const r1 = await req(clerk, 'PATCH', '/api/admin/cases/TS-0000-999', { step: 1 });
    expect(r1.status).toBe(404);
    expect(await json(r1)).toEqual({ error: '找不到案件' });
    const r2 = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, {});
    expect(r2.status).toBe(400);
    expect(await json(r2)).toEqual({ error: '没有需要更新的栏位' });
  });

  it('partnerId cannot be changed', async () => {
    const { req, c, json } = await one();
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { partnerId: 'TSP0009' });
    expect(res.status).toBe(400);
    expect((await json(res)).fields.partnerId).toBeTruthy();
  });

  it.each([
    ['step 6', { step: 6 }],
    ['step 1.5', { step: 1.5 }],
    ['step "2"', { step: '2' }],
    ['price -5', { price: -5 }],
    ['markup text', { markup: 'abc' }],
    ['bad submittedAt', { submittedAt: '2026/11/01' }],
    ['bad clientPaidAt', { clientPaid: true, clientPaidAt: 'yesterday' }],
    ['long notes', { notesInternal: 'x'.repeat(201) }],
  ])('400 on %s, and the case is unchanged', async (_n, patch) => {
    const { req, c, repo } = await one();
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, patch);
    expect(res.status).toBe(400);
    expect(await repo.getCase(c.id)).toMatchObject({ step: 0, price: 1800, clientPaid: false });
  });

  it('error messages: amount, long text', async () => {
    const { req, c, json } = await one();
    expect((await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { price: -5 }))).error).toBe('金额不正确');
    expect((await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { notesInternal: 'x'.repeat(201) }))).error).toBe('内容过长');
  });

  it('changes the allowed fields and records step history', async () => {
    const { req, c, repo, json } = await one();
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, {
      step: 1, missingDocs: 'IC 副本', invoiceNo: 'INV-1', notesInternal: '内部', council: 'MBSJ', clientName: '王先生',
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ step: 1, missingDocs: 'IC 副本', invoiceNo: 'INV-1', council: 'MBSJ', clientName: '王先生' });
    expect((await repo.listCaseHistory(c.id)).map((h) => h.step)).toEqual([1]);
    expect(repo.auditLog.at(-1)).toMatchObject({ action: 'case.update', entity: 'case', id: c.id });
    expect((repo.auditLog.at(-1)!.details as any).fields).toContain('step');
  });

  it('clientPaid true keeps an explicit date; false clears it', async () => {
    const { req, c, json } = await one();
    const a = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { clientPaid: true, clientPaidAt: '2026-11-02' }));
    expect(a).toMatchObject({ clientPaid: true, clientPaidAt: '2026-11-02' });
    const b = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { clientPaid: true }));
    expect(b.clientPaidAt).toBe('2026-11-02');
    const d = await json(await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { clientPaid: false }));
    expect(d).toMatchObject({ clientPaid: false, clientPaidAt: null });
  });

  it('licence type must be in the list', async () => {
    const { req, c, json } = await one();
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { licenceType: '乱写' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('执照类型不正确');
  });

  it('C1 markup over the cap is a 400 before anything is written', async () => {
    const { req, repo, activePartner, json } = await setupAdmin();
    const s = await repo.getSettings();
    s.commissionRules.C1.maxMarkup = 500;
    await repo.saveSettings(s, 't');
    const p = await activePartner('C1');
    const c = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { markup: 300 })));
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { markup: 600, step: 1 });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('加价超过上限');
    expect(await repo.getCase(c.id)).toMatchObject({ markup: 300, step: 0 });
    expect(await repo.getCommission(c.id)).toMatchObject({ amount: 300 });
  });

  it('B1 collectBeforeSubmit blocks step >= 2 until settled', async () => {
    const { req, repo, activePartner, json } = await setupAdmin();
    const s = await repo.getSettings();
    s.commissionRules.B1.collectBeforeSubmit = true;
    await repo.saveSettings(s, 't');
    const p = await activePartner('B1');
    const c = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    expect(c.commission.status).toBe('待付发票');
    const blocked = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 2 });
    expect(blocked.status).toBe(400);
    expect(await json(blocked)).toEqual({ error: 'B1 案件需先结清才能递交' });
    expect((await repo.getCase(c.id))!.step).toBe(0);
    expect((await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 1 })).status).toBe(200);
    const ok = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 2, clientPaid: true });
    expect(ok.status).toBe(200);
    expect((await json(ok)).commission.status).toBe('已结清');
    expect((await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 3 })).status).toBe(200);
  });

  it('B1 without the setting moves freely', async () => {
    const { req, c } = await one('B1');
    expect((await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 2 })).status).toBe(200);
  });

  it('a committed write survives an audit failure', async () => {
    const { req, c, repo } = await one();
    repo.audit = async () => {
      throw new RepoError('audit down');
    };
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 1 });
    expect(res.status).toBe(200);
    expect((await repo.getCase(c.id))!.step).toBe(1);
  });

  it('repo outage is a 503', async () => {
    const { req, c, repo, json } = await one();
    repo.failNext();
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 1 });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual(DB_DOWN);
  });

  it("any case change refreshes the partner's KV page", async () => {
    const { req, c, p, app } = await one();
    const first = await (await app.request(`/p/${p.token}`, {}, ENV)).text();
    expect(first).toContain('<span class="badge">已收件</span>');
    await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { step: 2 });
    const second = await (await app.request(`/p/${p.token}`, {}, ENV)).text();
    expect(second).toContain('<span class="badge">已递交政府部门</span>');
  });
});

describe('GET', () => {
  it('lists with filters and returns one case with commission and history', async () => {
    const { req, activePartner, json } = await setupAdmin();
    const a = await activePartner('A1');
    const b = await activePartner('A1');
    const c1 = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(a.id, { submittedAt: '2026-10-05' })));
    await json(await req(clerk, 'POST', '/api/admin/cases', newCase(b.id, { submittedAt: '2026-11-05' })));
    await req(clerk, 'PATCH', `/api/admin/cases/${c1.id}`, { step: 1 });
    expect(await json(await req(clerk, 'GET', '/api/admin/cases'))).toHaveLength(2);
    expect(await json(await req(clerk, 'GET', `/api/admin/cases?partnerId=${a.id}`))).toHaveLength(1);
    expect(await json(await req(clerk, 'GET', '/api/admin/cases?month=2026-11'))).toHaveLength(1);
    expect(await json(await req(clerk, 'GET', '/api/admin/cases?step=1'))).toHaveLength(1);
    expect((await req(clerk, 'GET', '/api/admin/cases?month=2026-13')).status).toBe(400);
    expect((await req(clerk, 'GET', '/api/admin/cases?step=9')).status).toBe(400);
    const one = await json(await req(clerk, 'GET', `/api/admin/cases/${c1.id}`));
    expect(one).toMatchObject({ id: c1.id, commission: { amount: 150 } });
    expect(one.history.map((h: any) => h.step)).toEqual([1]);
    expect((await req(clerk, 'GET', '/api/admin/cases/TS-0000-999')).status).toBe(404);
  });
});
