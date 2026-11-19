// Staff API for commissions: month view and marking a commission as paid.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { HttpError, adminErrorHandler } from '../admin-errors';
import { auditQuietly, isMonth, refreshOrDrop } from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';

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
    const rows = [];
    for (const cm of comms) {
      const cs = byId.get(cm.caseId);
      if (!cs) continue;
      rows.push({
        caseId: cm.caseId, clientName: cs.clientName, partnerId: cs.partnerId, code: cm.code, amount: cm.amount,
        basis: cm.basis, status: cm.status, paidAt: cm.paidAt, paidBy: cm.paidBy,
      });
    }
    return c.json(rows);
  });

  r.post('/:caseId/mark-paid', async (c) => {
    const repo = c.var.repo;
    const caseId = c.req.param('caseId');
    const staff = c.var.staff;
    const settings = await repo.getSettings();
    if (settings.commissionRules.paidMarkedBy === 'admin' && staff.role !== 'admin') throw new HttpError(403, '没有权限');
    const cm = await repo.getCommission(caseId);
    if (!cm) throw new HttpError(404, '找不到佣金');
    if (cm.code === 'B1') throw new HttpError(400, '此佣金不能标记为已支付');
    if (cm.status !== '可发放') throw new HttpError(400, '佣金尚未可发放');
    const cs = await repo.getCase(caseId);
    if (!cs) throw new HttpError(404, '找不到案件');
    const paid = { ...cm, status: '已支付' as const, paidAt: new Date().toISOString(), paidBy: staff.email };
    await repo.saveCommission(paid);
    const partner = await repo.getPartner(cs.partnerId);
    await refreshOrDrop(c.env, repo, cs.partnerId, partner?.viewToken ?? null);
    await auditQuietly(repo, staff.email, 'commission.mark_paid', 'commission', caseId, { amount: cm.amount });
    return c.json(paid);
  });

  return r;
}
