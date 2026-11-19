// Staff API for partners: list, register, edit, approve, reset link.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { isEmail, normalizePhone, normalizeTin } from '../../shared/validate';
import type { NewPartner, Partner, PartnerCode, PartnerStatus, Source, Team } from '../../shared/types';
import { HttpError, adminErrorHandler, notFoundPartner } from '../admin-errors';
import { requireStaff } from '../access';
import type { AppEnv, Env } from '../env';
import type { Repo } from '../repo';
import { newViewToken } from '../token';
import { dropPartnerView, refreshPartnerView } from '../view-cache';

const CODES: PartnerCode[] = ['A1', 'B1', 'C1'];
const TEAMS: Team[] = ['Transmission', '市场部', 'IT'];
const SOURCES: Source[] = ['上门', '线上'];
const STATUSES: PartnerStatus[] = ['待审核', '活跃', '不活跃'];
const FORBIDDEN = ['id', 'viewToken', 'registeredAt'];
const BAD_FIELDS = '请检查红色栏位';

type Fields = Record<string, string>;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

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

  if (mode === 'patch' && has(b, 'status')) {
    if (b.status === '不活跃') out.status = '不活跃';
    else if (b.status === '活跃' && current?.viewToken) out.status = '活跃';
    else if (b.status === '活跃') fields.status = '请先批准伙伴';
    else fields.status = STATUSES.includes(b.status as PartnerStatus) ? '不能改为此状态' : '状态不正确';
  }

  if (Object.keys(fields).length) throw new HttpError(400, BAD_FIELDS, fields);
  return out;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, '请求格式不正确');
  }
}

const linkFor = (env: Env, token: string) => `${(env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')}/p/${token}`;

async function mustGet(repo: Repo, id: string): Promise<Partner> {
  const p = await repo.getPartner(id);
  if (!p) throw notFoundPartner();
  return p;
}

/** The write is committed by now, so a failed page rebuild must not turn the response into an error. */
async function refreshQuietly(env: Env, repo: Repo, id: string): Promise<void> {
  try {
    await refreshPartnerView(env, repo, id);
  } catch (err) {
    console.error('refreshPartnerView failed', err);
  }
}

/** 'YYYY-MM-DD' of a date or timestamp in Asia/Kuala_Lumpur. */
function klDay(d: Date | string): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(d));
}

export function adminPartners(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));

  r.get('/', async (c) => {
    const status = c.req.query('status');
    if (status && !STATUSES.includes(status as PartnerStatus)) throw new HttpError(400, '状态不正确');
    const q = c.req.query('q');
    return c.json(await c.var.repo.listPartners({ status: (status || undefined) as PartnerStatus | undefined, q: q || undefined }));
  });

  r.post('/', async (c) => {
    const input = validatePartner(await readJson(c.req.raw), 'create') as NewPartner;
    const repo = c.var.repo;
    const p = await repo.createPartner(input, c.var.staff.email);
    await repo.audit(c.var.staff.email, 'partner.create', 'partner', p.id, { code: p.code, name: p.name });
    return c.json(p, 201);
  });

  // Registered before /:id so "inactive" is not read as an id.
  r.get('/inactive', async (c) => {
    const repo = c.var.repo;
    const [settings, active] = await Promise.all([repo.getSettings(), repo.listPartners({ status: '活跃' })]);
    const today = klDay(new Date());
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - settings.inactiveDays);
    const cut = cutoff.toISOString().slice(0, 10);
    const stale: Partner[] = [];
    for (const p of active) {
      const cases = await repo.listCases({ partnerId: p.id });
      const newest = cases.reduce<string | null>((m, x) => {
        const d = klDay(x.submittedAt);
        return m === null || d > m ? d : m;
      }, null);
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
    const updated = await repo.updatePartner(id, patch, c.var.staff.email);
    await repo.audit(c.var.staff.email, 'partner.update', 'partner', id, { fields: Object.keys(patch) });
    await refreshQuietly(c.env, repo, id);
    return c.json(updated);
  });

  r.post('/:id/approve', requireStaff({ role: 'admin', jwks }), async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const p = await mustGet(repo, id);
    if (p.status === '活跃') throw new HttpError(400, '伙伴已是活跃状态');
    const token = p.viewToken ?? newViewToken();
    await repo.updatePartner(id, { status: '活跃', viewToken: token }, c.var.staff.email);
    await repo.audit(c.var.staff.email, 'partner.approve', 'partner', id, {
      from: p.status, issuedLink: p.viewToken === null,
    });
    await refreshQuietly(c.env, repo, id);
    return c.json({ link: linkFor(c.env, token) });
  });

  r.post('/:id/reset-link', async (c) => {
    const repo = c.var.repo;
    const id = c.req.param('id');
    const p = await mustGet(repo, id);
    const old = p.viewToken;
    if (!old) throw new HttpError(400, '伙伴尚未批准');
    // R24: commit the new token first, so the old page can only be dropped once it is already dead.
    const token = newViewToken();
    await repo.updatePartner(id, { viewToken: token }, c.var.staff.email);
    await repo.audit(c.var.staff.email, 'partner.reset_link', 'partner', id);
    let dropped = false;
    for (let i = 0; i < 3 && !dropped; i++) {
      try {
        await dropPartnerView(c.env, old);
        dropped = true;
      } catch {
        // retry
      }
    }
    if (!dropped) return c.json({ error: '旧链接清除失败，请再试一次' }, 503);
    await refreshQuietly(c.env, repo, id);
    return c.json({ link: linkFor(c.env, token) });
  });

  return r;
}
