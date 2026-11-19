// Staff API for the monthly report and the printable statement data.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { HttpError, adminErrorHandler } from '../admin-errors';
import { mustMonth, round2 } from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';

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
    const sums = new Map<string, { cases: number; revenue: number; commission: number }>();
    const row = (id: string) => {
      let s = sums.get(id);
      if (!s) sums.set(id, (s = { cases: 0, revenue: 0, commission: 0 }));
      return s;
    };
    for (const x of cases) {
      const s = row(x.partnerId);
      s.cases += 1;
      if (!x.cancelled) s.revenue += x.price ?? 0;
    }
    for (const cm of comms) {
      const pid = partnerOf.get(cm.caseId);
      if (pid) row(pid).commission += cm.amount;
    }
    return c.json(
      partners.filter((p) => sums.has(p.id)).map((p) => {
        const s = sums.get(p.id)!;
        return {
          partnerId: p.id, name: p.name, company: p.company, code: p.code,
          cases: s.cases, revenue: round2(s.revenue), commission: round2(s.commission),
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
    const commOf = new Map(comms.map((cm) => [cm.caseId, cm]));
    const lines = [];
    for (const x of [...cases].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))) {
      const cm = commOf.get(x.id);
      if (!cm) continue;
      lines.push({
        caseId: x.id, clientName: x.clientName, licence: x.licenceType, submittedAt: x.submittedAt,
        amount: cm.amount, basis: cm.basis, status: cm.status,
      });
    }
    return c.json({
      partner: { id: partner.id, name: partner.name, company: partner.company, code: partner.code },
      month,
      lines,
      total: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    });
  });

  return r;
}
