// Staff API for commissions: month view and marking a commission as paid.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { HttpError, adminErrorHandler } from '../admin-errors';
import { auditQuietly, bad, has, isMonth, readJson, readObject, refreshOrDrop, round2 } from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';
import { nextCommission, previewCommission } from '../recalc';

export function adminCommissions(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));

  r.get('/', async (c) => {
    const month = c.req.query('month');
    if (month !== undefined && !isMonth(month)) throw new HttpError(400, '月份格式不正确');
    const f = { partnerId: c.req.query('partnerId') || undefined, month };
    // Two queries whatever the number of rows (subrequest cap).
    const [cases, comms] = await Promise.all([c.var.repo.listCases(f), c.var.repo.listCommissions(f)]);
    const byId = new Map(cases.map((x) => [x.id, x]));
    const have = new Set(comms.map((cm) => cm.caseId));
    const missing = cases.filter((x) => !have.has(x.id));
    const rows: Array<Record<string, unknown>> = [];
    for (const cm of comms) {
      const cs = byId.get(cm.caseId);
      if (!cs) continue;
      rows.push({
        caseId: cm.caseId, clientName: cs.clientName, partnerId: cs.partnerId, code: cm.code, amount: cm.amount,
        basis: cm.basis, status: cm.status, paidAt: cm.paidAt, paidBy: cm.paidBy,
      });
    }
    // A case without a commission row (a failed recalculation) is previewed in memory, never saved (R32).
    if (missing.length) {
      const [settings, partners] = await Promise.all([c.var.repo.getSettings(), c.var.repo.listPartners({})]);
      const codeOf = new Map(partners.map((p) => [p.id, p.code]));
      for (const cs of missing) {
        const code = codeOf.get(cs.partnerId);
        const cm = code ? previewCommission(cs, code, settings.commissionRules) : null;
        if (!cm) continue;
        rows.push({
          caseId: cs.id, clientName: cs.clientName, partnerId: cs.partnerId, code: cm.code, amount: cm.amount,
          basis: cm.basis, status: cm.status, paidAt: null, paidBy: null, pending: true,
        });
      }
    }
    return c.json(rows);
  });

  r.post('/:caseId/mark-paid', async (c) => {
    const repo = c.var.repo;
    const caseId = c.req.param('caseId');
    const staff = c.var.staff;
    const settings = await repo.getSettings();
    if (settings.commissionRules.paidMarkedBy === 'admin' && staff.role !== 'admin') throw new HttpError(403, '没有权限');
    // The amount the admin saw and confirmed. Only that amount may be frozen as 已支付.
    const b = readObject(await readJson(c.req.raw));
    const expected = b.expectedAmount;
    if (!has(b, 'expectedAmount') || typeof expected !== 'number' || !Number.isFinite(expected) || expected < 0) {
      throw bad('expectedAmount', '请提供确认的金额');
    }
    const [cm, cs] = await Promise.all([repo.getCommission(caseId), repo.getCase(caseId)]);
    if (!cm && !cs) throw new HttpError(404, '找不到佣金');
    if (!cs) throw new HttpError(404, '找不到案件');
    const partner = await repo.getPartner(cs.partnerId);
    if (!partner) throw new HttpError(404, '找不到伙伴');
    if ((cm?.code ?? partner.code) === 'B1') throw new HttpError(400, '此佣金不能标记为已支付');
    // Recompute from the current case and rules, so a stale stored amount is never frozen (R33).
    const next = nextCommission(cs, caseId, partner.code, cm, settings.commissionRules);
    if (next.status !== '可发放') throw new HttpError(400, '佣金尚未可发放');
    if (round2(next.amount) !== round2(expected)) throw new HttpError(409, '金额已变更，请刷新后再确认');
    const paid = { ...next, status: '已支付' as const, paidAt: new Date().toISOString(), paidBy: staff.email };
    await repo.saveCommission(paid);
    await refreshOrDrop(c.env, repo, partner.id, partner.viewToken);
    await auditQuietly(repo, staff.email, 'commission.mark_paid', 'commission', caseId, { amount: paid.amount });
    return c.json(paid);
  });

  return r;
}
