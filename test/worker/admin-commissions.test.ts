import { describe, expect, it } from 'vitest';
import { RepoError } from '../../src/worker/repo';
import { DB_DOWN, ENV, admin, clerk, setupAdmin } from './admin-helper';

const newCase = (partnerId: string, over: Record<string, unknown> = {}) => ({
  partnerId, clientName: '李先生', licenceType: '营业执照', price: 1800, ...over,
});

async function payable(code: 'A1' | 'B1' | 'C1' = 'A1') {
  const ctx = await setupAdmin();
  const p = await ctx.activePartner(code);
  const c = await ctx.json(await ctx.req(clerk, 'POST', '/api/admin/cases', newCase(p.id, code === 'C1' ? { markup: 200 } : {})));
  await ctx.req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { clientPaid: true });
  return { ...ctx, p, c };
}

describe('POST /api/admin/commissions/:caseId/mark-paid', () => {
  it('admin marks a 可发放 commission as 已支付 with paidAt and paidBy; page refreshed; audited', async () => {
    const { req, c, p, app, repo, json } = await payable();
    await app.request(`/p/${p.token}`, {}, ENV); // build the page
    const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(200);
    const cm = await json(res);
    expect(cm).toMatchObject({ caseId: c.id, status: '已支付', paidBy: admin.email });
    expect(Number.isNaN(Date.parse(cm.paidAt))).toBe(false);
    expect(await repo.getCommission(c.id)).toMatchObject({ status: '已支付', paidBy: admin.email });
    expect(await (await app.request(`/p/${p.token}`, {}, ENV)).text()).toContain('已支付');
    expect(repo.auditLog.at(-1)).toMatchObject({ action: 'commission.mark_paid', entity: 'commission', id: c.id, by: admin.email });
  });

  it('staff is refused when paidMarkedBy is admin (403) and allowed when it is staff', async () => {
    const { req, c, repo, json } = await payable();
    const res = await req(clerk, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: '没有权限' });
    expect((await repo.getCommission(c.id))!.status).toBe('可发放');
    const s = await repo.getSettings();
    s.commissionRules.paidMarkedBy = 'staff';
    await repo.saveSettings(s, 't');
    expect((await req(clerk, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 })).status).toBe(200);
  });

  it('only from 可发放: 待处理 and 已支付 are refused', async () => {
    const { req, activePartner, c, json } = await payable();
    const p2 = await activePartner('A1');
    const c2 = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p2.id)));
    const early = await req(admin, 'POST', `/api/admin/commissions/${c2.id}/mark-paid`, { expectedAmount: 150 });
    expect(early.status).toBe(400);
    expect(await json(early)).toEqual({ error: '佣金尚未可发放' });
    expect((await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 })).status).toBe(200);
    const again = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(again.status).toBe(400);
    expect(await json(again)).toEqual({ error: '佣金尚未可发放' });
  });

  it('B1 commissions cannot be marked paid', async () => {
    const { req, c, json } = await payable('B1');
    const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '此佣金不能标记为已支付' });
  });

  it('409 and nothing written when the recomputed amount differs from the confirmed one', async () => {
    const { req, c, p, app, repo, json } = await payable();
    await app.request(`/p/${p.token}`, {}, ENV);
    const audits = repo.auditLog.length;
    await repo.updateCase(c.id, { price: 900 }, 't'); // changed after the admin loaded the list: now RM 100
    const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: '金额已变更，请刷新后再确认' });
    expect(await repo.getCommission(c.id)).toMatchObject({ amount: 150, status: '可发放', paidAt: null });
    expect(repo.auditLog.length).toBe(audits);
    expect((await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 100 })).status).toBe(200);
  });

  it('400 when expectedAmount is missing or not a number; nothing written', async () => {
    const { req, c, repo } = await payable();
    for (const body of [{}, { expectedAmount: '150' }, { expectedAmount: null }, { expectedAmount: -1 }]) {
      const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await repo.getCommission(c.id))!.status).toBe('可发放');
  });

  it('404 for an unknown case', async () => {
    const { req, json } = await setupAdmin();
    const res = await req(admin, 'POST', '/api/admin/commissions/TS-0000-999/mark-paid', { expectedAmount: 150 });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: '找不到佣金' });
  });

  it('an audit failure does not fail the response', async () => {
    const { req, c, repo } = await payable();
    repo.audit = async () => {
      throw new RepoError('audit down');
    };
    expect((await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 })).status).toBe(200);
    expect((await repo.getCommission(c.id))!.status).toBe('已支付');
  });

  it('repo outage is a 503', async () => {
    const { req, c, repo, json } = await payable();
    repo.failNext();
    const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual(DB_DOWN);
  });
});

describe('GET /api/admin/commissions', () => {
  it('lists commissions with case and partner details using one case and one commission query', async () => {
    const { req, activePartner, repo, json } = await setupAdmin();
    const a = await activePartner('A1');
    const b = await activePartner('C1');
    const c1 = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(a.id, { submittedAt: '2026-10-03' })));
    const c2 = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(b.id, { submittedAt: '2026-11-03', markup: 300, clientName: '陈小姐' })));
    const calls: string[] = [];
    for (const m of ['listCases', 'listCommissions', 'listPartners', 'getCase', 'getPartner', 'getCommission'] as const) {
      const orig = (repo as any)[m].bind(repo);
      (repo as any)[m] = (...a: unknown[]) => {
        calls.push(m);
        return orig(...a);
      };
    }
    const all = await json(await req(clerk, 'GET', '/api/admin/commissions'));
    expect(calls.filter((x) => x === 'listCases')).toHaveLength(1);
    expect(calls.filter((x) => x === 'listCommissions')).toHaveLength(1);
    expect(calls.filter((x) => x === 'getCase' || x === 'getPartner' || x === 'getCommission')).toHaveLength(0);
    expect(all).toHaveLength(2);
    const row = all.find((r: any) => r.caseId === c2.id);
    expect(row).toEqual({
      caseId: c2.id, clientName: '陈小姐', partnerId: b.id, code: 'C1', amount: 300,
      basis: expect.any(String), status: '待处理', paidAt: null, paidBy: null,
    });
    expect(await json(await req(clerk, 'GET', '/api/admin/commissions?month=2026-10'))).toMatchObject([{ caseId: c1.id }]);
    expect(await json(await req(clerk, 'GET', `/api/admin/commissions?partnerId=${b.id}`))).toMatchObject([{ caseId: c2.id }]);
  });

  it('400 on a bad month', async () => {
    const { req, json } = await setupAdmin();
    const res = await req(clerk, 'GET', '/api/admin/commissions?month=2026-1');
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: '月份格式不正确' });
  });
});

describe('R33: mark-paid recomputes from the current case and rules', () => {
  it('a cancelled case whose stored row is still 可发放 is refused', async () => {
    const { req, c, repo, json } = await payable();
    await repo.updateCase(c.id, { cancelled: true }, 't'); // bypasses recalculation: a stale row
    expect((await repo.getCommission(c.id))!.status).toBe('可发放');
    const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '佣金尚未可发放' });
    expect((await repo.getCommission(c.id))!.status).toBe('可发放');
  });

  it('a stale stored amount is never frozen: 409 for the shown amount, 200 once the recomputed one is confirmed', async () => {
    const { req, c, repo, json } = await payable();
    await repo.saveCommission({ ...(await repo.getCommission(c.id))!, amount: 999 });
    const stale = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 999 });
    expect(stale.status).toBe(409);
    expect((await repo.getCommission(c.id))!.status).toBe('可发放');
    const res = await req(admin, 'POST', `/api/admin/commissions/${c.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(200);
    expect((await json(res)).amount).toBe(150);
    expect(await repo.getCommission(c.id)).toMatchObject({ amount: 150, status: '已支付' });
  });

  it('a case with no commission row is paid when the recompute is 可发放', async () => {
    const ctx = await setupAdmin();
    const { req, repo, json } = ctx;
    const p = await ctx.activePartner('A1');
    const cs = await repo.createCase({
      partnerId: p.id, clientName: 'x', clientPhone: null, licenceType: '营业执照', council: null, missingDocs: null,
      price: 1800, markup: null, invoiceNo: null, notesInternal: null,
    }, 't');
    expect((await req(admin, 'POST', `/api/admin/commissions/${cs.id}/mark-paid`, { expectedAmount: 150 })).status).toBe(400);
    await repo.updateCase(cs.id, { clientPaid: true }, 't');
    const res = await req(admin, 'POST', `/api/admin/commissions/${cs.id}/mark-paid`, { expectedAmount: 150 });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ amount: 150, status: '已支付', code: 'A1' });
  });
});
