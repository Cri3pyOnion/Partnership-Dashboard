import { describe, expect, it } from 'vitest';
import { DB_DOWN, clerk, setupAdmin } from './admin-helper';

const newCase = (partnerId: string, over: Record<string, unknown> = {}) => ({
  partnerId, clientName: '李先生', licenceType: '营业执照', price: 1800, ...over,
});

async function seeded() {
  const ctx = await setupAdmin();
  const { req, activePartner, repo, json } = ctx;
  const a = await activePartner('A1', { name: 'Alice', company: 'Alice Sdn Bhd' });
  const c = await activePartner('C1', { name: 'Charlie' });
  const idle = await activePartner('A1', { name: 'Idle' });
  const post = async (body: Record<string, unknown>) => json(await req(clerk, 'POST', '/api/admin/cases', body));
  const a1 = await post(newCase(a.id, { submittedAt: '2026-11-03', price: 1800, clientName: 'A1客户' })); // 150
  const a2 = await post(newCase(a.id, { submittedAt: '2026-11-10', price: 1000, clientName: 'A2客户' })); // 100
  const a3 = await post(newCase(a.id, { submittedAt: '2026-11-12', price: 2000, clientName: 'A3取消' })); // cancelled
  await req(clerk, 'PATCH', `/api/admin/cases/${a3.id}`, { cancelled: true });
  const a4 = await post(newCase(a.id, { submittedAt: '2026-10-30', price: 5000 })); // other month
  const c1 = await post(newCase(c.id, { submittedAt: '2026-11-05', price: 1200, markup: 300, clientName: 'C1客户' }));
  return { ...ctx, a, c, idle, a1, a2, a3, a4, c1 };
}

function countCalls(repo: any) {
  const calls: string[] = [];
  for (const m of Object.getOwnPropertyNames(Object.getPrototypeOf(repo))) {
    if (m === 'constructor' || m === 'gate' || typeof repo[m] !== 'function') continue;
    const orig = repo[m].bind(repo);
    repo[m] = (...args: unknown[]) => {
      calls.push(m);
      return orig(...args);
    };
  }
  return calls;
}

describe('GET /api/admin/reports/monthly', () => {
  it('sums cases, revenue (non-cancelled) and commission per partner with cases that month', async () => {
    const { req, a, c, json } = await seeded();
    const res = await req(clerk, 'GET', '/api/admin/reports/monthly?month=2026-11');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([
      { partnerId: a.id, name: 'Alice', company: 'Alice Sdn Bhd', code: 'A1', cases: 2, revenue: 2800, commission: 250, b1Owed: 0 },
      { partnerId: c.id, name: 'Charlie', company: null, code: 'C1', cases: 1, revenue: 1200, commission: 300, b1Owed: 0 },
    ]);
  });

  it('uses exactly one listPartners, one listCases and one listCommissions', async () => {
    const { req, repo } = await seeded();
    const calls = countCalls(repo);
    // requireStaff reads the staff row once more
    await req(clerk, 'GET', '/api/admin/reports/monthly?month=2026-11');
    const rest = calls.filter((x) => x !== 'getStaff');
    expect(rest.sort()).toEqual(['listCases', 'listCommissions', 'listPartners']);
  });

  it('previews cases with no commission row, loading settings once only when needed', async () => {
    const { req, a, repo, json } = await seeded();
    for (const price of [1800, 1000]) {
      await repo.createCase({
        partnerId: a.id, clientName: '无佣金', clientPhone: null, licenceType: '营业执照', council: null, missingDocs: null,
        price, markup: null, invoiceNo: null, notesInternal: null, submittedAt: '2026-11-20',
      }, 't');
    }
    const calls = countCalls(repo);
    const rows = await json(await req(clerk, 'GET', '/api/admin/reports/monthly?month=2026-11'));
    expect(rows.find((r: any) => r.partnerId === a.id)).toMatchObject({ cases: 4, revenue: 5600, commission: 250 + 150 + 100 });
    expect(calls.filter((x) => x !== 'getStaff').sort()).toEqual(['getSettings', 'listCases', 'listCommissions', 'listPartners']);
    expect(await repo.listCommissions({ partnerId: a.id, month: '2026-11' })).toHaveLength(3); // nothing saved
  });

  it('400 on a missing or bad month; auth required', async () => {
    const { req, json } = await setupAdmin();
    for (const q of ['', '?month=2026-13', '?month=26-11', '?month=2026-1']) {
      const res = await req(clerk, 'GET', `/api/admin/reports/monthly${q}`);
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ error: '月份格式不正确' });
    }
    expect((await req(null, 'GET', '/api/admin/reports/monthly?month=2026-11')).status).toBe(401);
  });

  it('503 on a repo outage', async () => {
    const { req, repo, json } = await seeded();
    const orig = repo.listCases.bind(repo);
    repo.listCases = async (f: any) => {
      repo.failNext();
      return orig(f);
    };
    const res = await req(clerk, 'GET', '/api/admin/reports/monthly?month=2026-11');
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual(DB_DOWN);
  });
});

describe('mixed commission codes (a partner whose code changed)', () => {
  async function mixed() {
    const ctx = await seeded();
    const { repo, req, a, json } = ctx;
    // a1 and a2 were calculated as A1. Now the partner is B1 and a new case is calculated as B1.
    await repo.updatePartner(a.id, { code: 'B1' }, 't');
    const b = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(a.id, { submittedAt: '2026-11-15', price: 1000, clientName: 'B1客户' })));
    return { ...ctx, b };
  }

  it('monthly report splits commission and b1Owed by each commission row code', async () => {
    const { req, a, json } = await mixed();
    const rows = await json(await req(clerk, 'GET', '/api/admin/reports/monthly?month=2026-11'));
    const row = rows.find((r: any) => r.partnerId === a.id);
    expect(row.commission).toBe(250);
    expect(row.b1Owed).toBe(800);
  });

  it('statement lines carry their own code and the totals are split', async () => {
    const { req, a, b, a1, json } = await mixed();
    const s = await json(await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-11`));
    expect(s.lines.find((l: any) => l.caseId === a1.id).code).toBe('A1');
    expect(s.lines.find((l: any) => l.caseId === b.id).code).toBe('B1');
    expect(s.totalCommission).toBe(250);
    expect(s.totalB1).toBe(800);
  });

  it('a preview line uses the partner code', async () => {
    const { req, a, repo, json } = await mixed();
    const extra = await repo.createCase({
      partnerId: a.id, clientName: 'p', clientPhone: null, licenceType: '营业执照', council: null, missingDocs: null,
      price: 1000, markup: null, invoiceNo: null, notesInternal: null, submittedAt: '2026-11-21',
    }, 't');
    const s = await json(await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-11`));
    expect(s.lines.find((l: any) => l.caseId === extra.id)).toMatchObject({ pending: true, code: 'B1' });
  });
});

describe('GET /api/admin/statements/:partnerId/:month', () => {
  it('returns the partner, lines and total', async () => {
    const { req, a, a1, a2, a3, json } = await seeded();
    const res = await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-11`);
    expect(res.status).toBe(200);
    const s = await json(res);
    expect(s.partner).toEqual({ id: a.id, name: 'Alice', company: 'Alice Sdn Bhd', code: 'A1' });
    expect(s.month).toBe('2026-11');
    expect(s.lines.map((l: any) => l.caseId)).toEqual([a1.id, a2.id, a3.id]);
    expect(s.lines[0]).toEqual({
      caseId: a1.id, clientName: 'A1客户', licence: '营业执照', submittedAt: '2026-11-03',
      amount: 150, basis: expect.any(String), status: '待处理', code: 'A1',
    });
    expect(s.lines[2].amount).toBe(0);
    expect(s.totalCommission).toBe(250);
    expect(s.totalB1).toBe(0);
  });

  it('an empty month gives no lines and total 0; unknown partner 404; bad month 400', async () => {
    const { req, a, idle, json } = await seeded();
    expect(await json(await req(clerk, 'GET', `/api/admin/statements/${idle.id}/2026-11`))).toMatchObject({ lines: [], totalCommission: 0, totalB1: 0 });
    expect(await json(await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-09`))).toMatchObject({ lines: [], totalCommission: 0, totalB1: 0 });
    const nf = await req(clerk, 'GET', '/api/admin/statements/TSP9999/2026-11');
    expect(nf.status).toBe(404);
    expect(await json(nf)).toEqual({ error: '找不到伙伴' });
    expect((await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-13`)).status).toBe(400);
  });

  it('previews a case with no commission row as pending, without saving it', async () => {
    const { req, a, repo, json } = await seeded();
    const extra = await repo.createCase({
      partnerId: a.id, clientName: '无佣金', clientPhone: null, licenceType: '营业执照', council: null, missingDocs: null,
      price: 1800, markup: null, invoiceNo: null, notesInternal: null, submittedAt: '2026-11-20',
    }, 't');
    const s = await json(await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-11`));
    expect(s.lines.find((l: any) => l.caseId === extra.id)).toMatchObject({ amount: 150, status: '待处理', pending: true, code: 'A1' });
    expect(s.lines.filter((l: any) => l.pending)).toHaveLength(1);
    expect(s.totalCommission).toBe(400);
    expect(await repo.getCommission(extra.id)).toBeNull();
  });

  it('is a fixed number of repo calls', async () => {
    const { req, a, repo } = await seeded();
    const calls = countCalls(repo);
    await req(clerk, 'GET', `/api/admin/statements/${a.id}/2026-11`);
    expect(calls.filter((x) => x !== 'getStaff').sort()).toEqual(['getPartner', 'listCases', 'listCommissions']);
  });
});
