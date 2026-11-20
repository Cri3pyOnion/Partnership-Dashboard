// Staff API for partners: list, register, edit, approve, reset link.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { isEmail, normalizePhone, normalizeTin } from '../../shared/validate';
import type { NewPartner, Partner, PartnerCode, PartnerStatus, Source, Team } from '../../shared/types';
import { HttpError, adminErrorHandler, notFoundPartner } from '../admin-errors';
import {
  MAX_TEXT, auditQuietly, checkAssignee, has, klDay, readAssignee, readJson, refreshOrDrop, staffQuery,
} from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv, Env } from '../env';
import type { Repo } from '../repo';
import { newViewToken } from '../token';
import { dropPartnerView } from '../view-cache';

const CODES: PartnerCode[] = ['A1', 'B1', 'C1'];
const TEAMS: Team[] = ['Transmission', 'Marketing', 'IT'];
const SOURCES: Source[] = ['上门', '线上'];
const STATUSES: PartnerStatus[] = ['待审核', '活跃', '不活跃'];
const FORBIDDEN = ['id', 'viewToken', 'registeredAt'];
const TEXT_KEYS = ['name', 'phone', 'email', 'tin', 'company', 'referralName', 'bankName', 'bankAccount'];
const BAD_FIELDS = '请检查红色栏位';

type Fields = Record<string, string>;

/** string trimmed, or null when blank or null; undefined when not a string. */
function optText(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * One validator for POST and PATCH. Builds the repo input from allowed fields only, so the raw
 * body never reaches the repo. On POST every required field must be present; on PATCH only the
 * fields that are present are checked.
 */
function validatePartner(raw: unknown, mode: 'create' | 'patch', current?: Partner): Partial<Partner> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, '请求格式不正确');
  const b = raw as Record<string, unknown>;
  const fields: Fields = {};
  const out: Partial<Partner> = {};
  const want = (k: string) => mode === 'create' || has(b, k);
  const tooLong = TEXT_KEYS.filter((k) => typeof b[k] === 'string' && (b[k] as string).length > MAX_TEXT);

  for (const k of FORBIDDEN) if (has(b, k)) fields[k] = '不可修改';
  if (mode === 'create' && has(b, 'status')) fields.status = '不可修改';

  if (want('name')) {
    const v = typeof b.name === 'string' ? b.name.trim() : '';
    if (v) out.name = v;
    else fields.name = '请填写姓名';
  }
  if (want('phone')) {
    const v = typeof b.phone === 'string' ? normalizePhone(b.phone) : null;
    if (v) out.phone = v;
    else fields.phone = '电话号码格式不正确';
  }
  if (want('email')) {
    const v = typeof b.email === 'string' ? b.email.trim() : '';
    if (isEmail(v)) out.email = v;
    else fields.email = '电邮格式不正确';
  }
  if (want('code')) {
    if (CODES.includes(b.code as PartnerCode)) out.code = b.code as PartnerCode;
    else fields.code = '请选择伙伴代码';
  }
  if (want('filledBy')) {
    if (TEAMS.includes(b.filledBy as Team)) out.filledBy = b.filledBy as Team;
    else fields.filledBy = '请选择填写团队';
  }

  if (has(b, 'tin')) {
    const t = optText(b.tin);
    if (t === undefined) fields.tin = '税号格式不正确';
    else if (t === null) out.tin = null;
    else {
      const n = normalizeTin(t);
      if (n) out.tin = n;
      else fields.tin = '税号格式不正确';
    }
  } else if (mode === 'create') out.tin = null;

  if (has(b, 'source')) {
    const s = optText(b.source);
    if (s === null) out.source = null;
    else if (s !== undefined && SOURCES.includes(s as Source)) out.source = s as Source;
    else fields.source = '来源格式不正确';
  } else if (mode === 'create') out.source = null;

  for (const k of ['company', 'referralName', 'bankName', 'bankAccount'] as const) {
    if (has(b, k)) {
      const t = optText(b[k]);
      if (t === undefined) fields[k] = '格式不正确';
      else out[k] = t;
    } else if (mode === 'create') out[k] = null;
  }

  const assignee = readAssignee(b, 'assignedStaff');
  if (assignee !== undefined) out.assignedStaff = assignee;

  if (mode === 'patch' && has(b, 'status')) {
    if (b.status === '不活跃') out.status = '不活跃';
    else if (b.status === '活跃' && current?.viewToken) out.status = '活跃';
    else if (b.status === '活跃') fields.status = '请先批准伙伴';
    else fields.status = STATUSES.includes(b.status as PartnerStatus) ? '不能改为此状态' : '状态不正确';
  }

  for (const k of tooLong) {
    fields[k] = '内容过长';
    delete (out as Record<string, unknown>)[k];
  }
  if (Object.keys(fields).length) throw new HttpError(400, BAD_FIELDS, fields);
  if (mode === 'patch' && Object.keys(out).length === 0) throw new HttpError(400, '没有需要更新的栏位');
  return out;
}

/** Link for a token. A missing base URL is a setup error, never a relative link. */
function linkFor(env: Env, token: string): string {
  const base = (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new HttpError(503, '系统设置不完整');
  return `${base}/p/${token}`;
}

async function mustGet(repo: Repo, id: string): Promise<Partner> {
  const p = await repo.getPartner(id);
  if (!p) throw notFoundPartner();
  return p;
}

/** Drop a page up to 3 times; true when one try worked. */
async function dropWithRetry(env: Env, token: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      await dropPartnerView(env, token);
      return true;
    } catch {
      // retry
    }
  }
  return false;
}

export function adminPartners(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));

  r.get('/', async (c) => {
    const status = c.req.query('status');
    if (status && !STATUSES.includes(status as PartnerStatus)) throw new HttpError(400, '状态不正确');
    const q = c.req.query('q');
    const assignedStaff = staffQuery(c.req.query('assignedStaff'), c.var.staff.email);
    return c.json(await c.var.repo.listPartners({
      status: (status || undefined) as PartnerStatus | undefined, q: q || undefined, assignedStaff,
    }));
  });

  r.post('/', async (c) => {
    const input = validatePartner(await readJson(c.req.raw), 'create') as NewPartner;
    const repo = c.var.repo;
    // A new partner belongs to whoever registers them unless another staff member is chosen.
    if (input.assignedStaff === undefined) input.assignedStaff = c.var.staff.email.toLowerCase();
    await checkAssignee(repo, input.assignedStaff, 'assignedStaff');
    const p = await repo.createPartner(input, c.var.staff.email);
    await auditQuietly(repo, c.var.staff.email, 'partner.create', 'partner', p.id, { code: p.code, name: p.name });
    return c.json(p, 201);
  });

  // Registered before /:id so "inactive" is not read as an id.
  r.get('/inactive', async (c) => {
    const repo = c.var.repo;
    // Three calls in total, whatever the number of partners (subrequest cap).
    const [settings, active, allCases] = await Promise.all([
      repo.getSettings(), repo.listPartners({ status: '活跃' }), repo.listCases({}),
    ]);
    const newestBy = new Map<string, string>();
    for (const x of allCases) {
      const d = klDay(x.submittedAt);
      const cur = newestBy.get(x.partnerId);
      if (cur === undefined || d > cur) newestBy.set(x.partnerId, d);
    }
    const today = klDay(new Date());
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - settings.inactiveDays);
    const cut = cutoff.toISOString().slice(0, 10);
    const stale: Partner[] = [];
    for (const p of active) {
      const newest = newestBy.get(p.id) ?? null;
      if ((newest ?? klDay(p.registeredAt)) < cut) stale.push(p);
    }
    return c.json(stale);
  });

  r.get('/:id', async (c) => {
    const repo = c.var.repo;
    const partner = await mustGet(repo, c.req.param('id'));
    const [cases, recentViews] = await Promise.all([
      repo.listCases({ partnerId: partner.id }),
      repo.listLinkViews(partner.id, 10),
    ]);
    return c.json({ partner, cases, recentViews });
  });

  r.patch('/:id', async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const current = await mustGet(repo, id);
    const patch = validatePartner(await readJson(c.req.raw), 'patch', current);
    // Reassigning a partner never moves existing cases; only new cases follow the new staff.
    if (patch.assignedStaff !== undefined && patch.assignedStaff !== current.assignedStaff) {
      await checkAssignee(repo, patch.assignedStaff, 'assignedStaff');
    }
    const updated = await repo.updatePartner(id, patch, c.var.staff.email);
    await refreshOrDrop(c.env, repo, id, updated.viewToken);
    await auditQuietly(repo, c.var.staff.email, 'partner.update', 'partner', id, {
      fields: Object.keys(patch),
      ...(patch.assignedStaff !== undefined ? { assignedStaff: { from: current.assignedStaff, to: patch.assignedStaff } } : {}),
    });
    return c.json(updated);
  });

  r.post('/:id/approve', requireStaff({ role: 'admin', jwks }), async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const p = await mustGet(repo, id);
    if (p.status === '活跃') throw new HttpError(400, '伙伴已是活跃状态');
    const token = p.viewToken ?? newViewToken();
    const link = linkFor(c.env, token); // fails before anything is written when the base URL is missing
    await repo.updatePartner(id, { status: '活跃', viewToken: token }, c.var.staff.email);
    await refreshOrDrop(c.env, repo, id, token);
    await auditQuietly(repo, c.var.staff.email, 'partner.approve', 'partner', id, { from: p.status, issuedLink: p.viewToken === null });
    return c.json({ link });
  });

  r.post('/:id/reset-link', async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const p = await mustGet(repo, id);
    const old = p.viewToken;
    if (!old && p.status !== '活跃') throw new HttpError(400, '伙伴尚未批准');
    const token = newViewToken();
    const link = linkFor(c.env, token);
    if (!old) {
      // An 活跃 partner with no link yet (seeded or migrated): issue the first one. No old page to drop.
      await repo.updatePartner(id, { viewToken: token }, c.var.staff.email);
      await refreshOrDrop(c.env, repo, id, token);
      await auditQuietly(repo, c.var.staff.email, 'partner.reset_link', 'partner', id, { issuedLink: true });
      return c.json({ link });
    }
    // R26: kill the original page first. If that fails nothing is committed, so a retry targets the same token.
    if (!(await dropWithRetry(c.env, old))) return c.json({ error: '旧链接清除失败，请再试一次' }, 503);
    await repo.updatePartner(id, { viewToken: token }, c.var.staff.email);
    await refreshOrDrop(c.env, repo, id, token);
    // A view may have rebuilt the old page between the first drop and the commit; best effort, never fails.
    await dropWithRetry(c.env, old);
    await auditQuietly(repo, c.var.staff.email, 'partner.reset_link', 'partner', id);
    return c.json({ link });
  });

  return r;
}
