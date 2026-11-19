// Staff API for the monthly report and the printable statement data.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { HttpError, adminErrorHandler } from '../admin-errors';
import { mustMonth, round2 } from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';
import { previewCommission } from '../recalc';

export function adminReports(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));

  r.get('/monthly', async (c) => {
    const month = mustMonth(c.req.query('month'));
    const repo = c.var.repo;
    // Three queries in total, whatever the number of partners (subrequest cap).
    const [partners, cases, comms] = await Promise.all([
      repo.listPartners({}), repo.listCases({ month }), repo.listCommissions({ month }),
    ]);
    const partnerOf = new Map(cases.map((x) => [x.id, x.partnerId]));
    const sums = new Map<string, { cases: number; revenue: number; commission: number; b1Owed: number }>();
    const row = (id: string) => {
      let s = sums.get(id);
      if (!s) sums.set(id, (s = { cases: 0, revenue: 0, commission: 0, b1Owed: 0 }));
      return s;
    };
    for (const x of cases) {
      const s = row(x.partnerId);
      if (!x.cancelled) {
        s.cases += 1;
        s.revenue += x.price ?? 0;
      }
    }
    const add = (pid: string, code: string, amount: number) => {
      // B1 amounts are owed to Toh's Sign, so they never join the commission sum. The row's own code decides.
      row(pid)[code === 'B1' ? 'b1Owed' : 'commission'] += amount;
    };
    for (const cm of comms) {
      const pid = partnerOf.get(cm.caseId);
      if (pid) add(pid, cm.code, cm.amount);
    }
    // A case without a row is previewed, as statements do. Settings load once, only if needed.
    const have = new Set(comms.map((cm) => cm.caseId));
    const missing = cases.filter((x) => !have.has(x.id));
    if (missing.length) {
      const rules = (await repo.getSettings()).commissionRules;
      const codeOf = new Map(partners.map((p) => [p.id, p.code]));
      for (const x of missing) {
        const code = codeOf.get(x.partnerId);
        const cm = code ? previewCommission(x, code, rules) : null;
        if (cm) add(x.partnerId, cm.code, cm.amount);
      }
    }
    return c.json(
      partners.filter((p) => sums.has(p.id)).map((p) => {
        const s = sums.get(p.id)!;
        return {
          partnerId: p.id, name: p.name, company: p.company, code: p.code,
          cases: s.cases, revenue: round2(s.revenue), commission: round2(s.commission), b1Owed: round2(s.b1Owed),
        };
      }),
    );
  });

  return r;
}

export function adminStatements(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));

  r.get('/:partnerId/:month', async (c) => {
    const repo = c.var.repo;
    const month = mustMonth(c.req.param('month'));
    const partnerId = c.req.param('partnerId');
    const [partner, cases, comms] = await Promise.all([
      repo.getPartner(partnerId), repo.listCases({ partnerId, month }), repo.listCommissions({ partnerId, month }),
    ]);
    if (!partner) throw new HttpError(404, '找不到伙伴');
    const commOf = new Map<string, { code: string; amount: number; basis: string; status: string; pending?: true }>(comms.map((cm) => [cm.caseId, cm]));
    if (cases.some((x) => !commOf.has(x.id))) {
      const rules = (await repo.getSettings()).commissionRules;
      for (const x of cases) {
        if (commOf.has(x.id)) continue;
        const cm = previewCommission(x, partner.code, rules);
        if (cm) commOf.set(x.id, { code: partner.code, amount: cm.amount, basis: cm.basis, status: cm.status, pending: true });
      }
    }
    const lines = [];
    for (const x of [...cases].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))) {
      const cm = commOf.get(x.id);
      if (!cm) continue;
      lines.push({
        caseId: x.id, clientName: x.clientName, licence: x.licenceType, submittedAt: x.submittedAt,
        code: cm.code, amount: cm.amount, basis: cm.basis, status: cm.status, ...(cm.pending ? { pending: true } : {}),
      });
    }
    return c.json({
      partner: { id: partner.id, name: partner.name, company: partner.company, code: partner.code },
      month,
      lines,
      // A1/C1 amounts are paid to the partner; B1 amounts are owed by the partner. Never one sum.
      totalCommission: round2(lines.filter((l) => l.code !== 'B1').reduce((sum, l) => sum + l.amount, 0)),
      totalB1: round2(lines.filter((l) => l.code === 'B1').reduce((sum, l) => sum + l.amount, 0)),
    });
  });

  return r;
}
