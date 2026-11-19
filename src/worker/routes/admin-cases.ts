// Staff API for cases: list, create, view, update. Every write recalculates the commission.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { StepIndex } from '../../shared/status';
import type { Case, Commission, NewCase, Partner } from '../../shared/types';
import { HttpError, adminErrorHandler } from '../admin-errors';
import {
  MAX_TEXT, auditQuietly, bad, has, isDay, isMonth, klDay, mustMonth, readJson, readObject,
} from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';
import { nextCommission, recalcAfterCommit } from '../recalc';

const NOT_BLANK_TEXT = ['clientName'] as const;
const OPT_TEXT = ['clientPhone', 'council', 'missingDocs', 'invoiceNo', 'notesInternal'] as const;

/** Trimmed text; blank means null. */
function text(b: Record<string, unknown>, k: string): string | null {
  const v = b[k];
  if (v === null) return null;
  if (typeof v !== 'string') throw bad(k, '格式不正确');
  if (v.length > MAX_TEXT) throw bad(k, '内容过长');
  const t = v.trim();
  return t === '' ? null : t;
}

/** A finite number of at least 0, or null. */
function money(b: Record<string, unknown>, k: string): number | null {
  const v = b[k];
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw bad(k, '金额不正确');
  return v;
}

function day(b: Record<string, unknown>, k: string): string {
  const v = b[k];
  if (!isDay(v)) throw bad(k, '日期格式不正确');
  return v;
}

/**
 * Reads the allowed case fields from a body, validating each one that is present. The raw body
 * never reaches the repo. `create` and `patch` share this; callers add the rules that need data.
 */
function readCaseFields(b: Record<string, unknown>, licenceTypes: string[]): Partial<Case> {
  const out: Partial<Case> = {};
  for (const k of NOT_BLANK_TEXT) {
    if (!has(b, k)) continue;
    const v = text(b, k);
    if (v === null) throw bad(k, '请填写客户姓名');
    out[k] = v;
  }
  for (const k of OPT_TEXT) if (has(b, k)) out[k] = text(b, k);
  if (has(b, 'licenceType')) {
    const v = typeof b.licenceType === 'string' ? b.licenceType.trim() : '';
    if (!licenceTypes.includes(v)) throw bad('licenceType', '执照类型不正确');
    out.licenceType = v;
  }
  if (has(b, 'price')) out.price = money(b, 'price');
  if (has(b, 'markup')) out.markup = money(b, 'markup');
  if (has(b, 'step')) {
    const v = b.step;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 5) throw bad('step', '步骤不正确');
    out.step = v as StepIndex;
  }
  for (const k of ['cancelled', 'clientPaid'] as const) {
    if (!has(b, k)) continue;
    if (typeof b[k] !== 'boolean') throw bad(k, '格式不正确');
    out[k] = b[k] as boolean;
  }
  if (has(b, 'submittedAt')) out.submittedAt = day(b, 'submittedAt');
  if (has(b, 'clientPaidAt')) out.clientPaidAt = b.clientPaidAt === null ? null : day(b, 'clientPaidAt');
  return out;
}

/** The commission code a case counts under: the one it was calculated with, else the partner's. */
const codeOf = (partner: Partner, existing: Commission | null) => existing?.code ?? partner.code;

export function adminCases(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));

  r.get('/', async (c) => {
    const month = c.req.query('month');
    if (month !== undefined && !isMonth(month)) throw new HttpError(400, '月份格式不正确');
    const stepQ = c.req.query('step');
    if (stepQ !== undefined && !/^[0-5]$/.test(stepQ)) throw new HttpError(400, '步骤不正确');
    return c.json(await c.var.repo.listCases({
      partnerId: c.req.query('partnerId') || undefined,
      step: stepQ === undefined ? undefined : (Number(stepQ) as StepIndex),
      month,
    }));
  });

  r.get('/:id', async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const found = await repo.getCase(id);
    if (!found) throw new HttpError(404, '找不到案件');
    const [commission, history] = await Promise.all([repo.getCommission(id), repo.listCaseHistory(id)]);
    return c.json({ ...found, commission, history });
  });

  r.post('/', async (c) => {
    const repo = c.var.repo;
    const b = readObject(await readJson(c.req.raw));
    const partnerId = typeof b.partnerId === 'string' ? b.partnerId.trim() : '';
    if (!partnerId) throw bad('partnerId', '请选择伙伴');
    for (const k of ['clientName', 'licenceType']) if (!has(b, k)) throw bad(k, k === 'clientName' ? '请填写客户姓名' : '执照类型不正确');
    const [partner, settings] = await Promise.all([repo.getPartner(partnerId), repo.getSettings()]);
    const f = readCaseFields(b, settings.licenceTypes);
    if (!partner) throw new HttpError(404, '找不到伙伴');
    if (partner.status === '待审核') throw new HttpError(400, '伙伴尚未批准');
    if (f.markup != null && partner.code !== 'C1') throw bad('markup', '只有 C1 伙伴可以加价');
    // Validate the commission (markup cap) before anything is written.
    nextCommission({ price: f.price ?? null, markup: f.markup ?? null, clientPaid: false, cancelled: false }, '', partner.code, null, settings.commissionRules);

    const input: NewCase = {
      partnerId,
      clientName: f.clientName as string,
      clientPhone: f.clientPhone ?? null,
      licenceType: f.licenceType as string,
      council: f.council ?? null,
      missingDocs: f.missingDocs ?? null,
      price: f.price ?? null,
      markup: f.markup ?? null,
      invoiceNo: f.invoiceNo ?? null,
      notesInternal: f.notesInternal ?? null,
      ...(f.submittedAt !== undefined ? { submittedAt: f.submittedAt } : {}),
    };
    const created = await repo.createCase(input, c.var.staff.email);
    const rc = await recalcAfterCommit(c.env, repo, created, partner, null, settings.commissionRules);
    await auditQuietly(repo, c.var.staff.email, 'case.create', 'case', created.id, { partnerId, price: created.price });
    return c.json({ ...created, ...rc }, 201);
  });

  r.patch('/:id', async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const raw = await readJson(c.req.raw);
    const cur = await repo.getCase(id);
    if (!cur) throw new HttpError(404, '找不到案件');
    const b = readObject(raw);
    if (has(b, 'partnerId')) throw new HttpError(400, '请检查红色栏位', { partnerId: '不可修改' });
    const [partner, settings, existing] = await Promise.all([
      repo.getPartner(cur.partnerId), repo.getSettings(), repo.getCommission(id),
    ]);
    if (!partner) throw new HttpError(404, '找不到伙伴');
    // An unchanged licence type stays valid even if it was later removed from the list.
    const out = readCaseFields(b, [...settings.licenceTypes, cur.licenceType]);

    if (has(b, 'clientPaid')) {
      if (out.clientPaid) out.clientPaidAt = out.clientPaidAt ?? (cur.clientPaid && cur.clientPaidAt ? cur.clientPaidAt : klDay(new Date()));
      else out.clientPaidAt = null;
    } else if (has(b, 'clientPaidAt') && (!cur.clientPaid || out.clientPaidAt === null)) {
      throw bad('clientPaidAt', '请先标记客户已付款');
    }
    if (Object.keys(out).length === 0) throw new HttpError(400, '没有需要更新的栏位');

    const code = codeOf(partner, existing);
    if (out.markup != null && code !== 'C1') throw bad('markup', '只有 C1 伙伴可以加价');
    // Compute from the patched values first: a markup over the cap fails here, before the write.
    const preview = nextCommission({ ...cur, ...out }, id, partner.code, existing, settings.commissionRules);
    if (
      out.step !== undefined && out.step >= 2 && code === 'B1'
      && settings.commissionRules.B1.collectBeforeSubmit && preview.status !== '已结清'
    ) throw new HttpError(400, 'B1 案件需先结清才能递交');

    const updated = await repo.updateCase(id, out, c.var.staff.email);
    const rc = await recalcAfterCommit(c.env, repo, updated, partner, existing, settings.commissionRules);
    await auditQuietly(repo, c.var.staff.email, 'case.update', 'case', id, { fields: Object.keys(out) });
    return c.json({ ...updated, ...rc });
  });

  return r;
}
