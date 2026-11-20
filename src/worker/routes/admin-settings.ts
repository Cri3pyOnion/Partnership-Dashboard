// Staff API for settings and the staff list. Admin only.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { CommissionRules, Settings, Staff, Team } from '../../shared/types';
import { isEmail } from '../../shared/validate';
import { HttpError, adminErrorHandler } from '../admin-errors';
import { MAX_TEXT, auditQuietly, bad, has, readJson, readObject } from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';

const TEAMS: Team[] = ['Transmission', '市场部', 'IT'];
const BAD_FIELDS = '请检查红色栏位';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

/** The stored settings with the body's values merged over them; any bad value is a 400 naming its field. */
function mergeSettings(cur: Settings, raw: unknown): Settings {
  const b = readObject(raw);
  if (!['commissionRules', 'licenceTypes', 'inactiveDays'].some((k) => has(b, k))) throw new HttpError(400, '没有需要更新的栏位');
  const next: Settings = structuredClone(cur);
  const fields: Record<string, string> = {};
  const rules: CommissionRules = next.commissionRules;

  if (has(b, 'commissionRules')) {
    const br = b.commissionRules;
    if (!isObj(br)) fields.commissionRules = '格式不正确';
    else {
      const group = (name: 'A1' | 'B1' | 'C1'): Record<string, unknown> | null => {
        if (!has(br, name)) return null;
        const g = br[name];
        if (isObj(g)) return g;
        fields[`commissionRules.${name}`] = '格式不正确';
        return null;
      };
      const a = group('A1');
      if (a) {
        for (const k of ['threshold', 'below', 'above'] as const) {
          if (!has(a, k)) continue;
          if (isNum(a[k])) rules.A1[k] = a[k];
          else fields[`commissionRules.A1.${k}`] = '金额不正确';
        }
      }
      const b1 = group('B1');
      if (b1) {
        if (has(b1, 'partnerPricePercent')) {
          if (isNum(b1.partnerPricePercent, 100)) rules.B1.partnerPricePercent = b1.partnerPricePercent;
          else fields['commissionRules.B1.partnerPricePercent'] = '请填写 0 到 100';
        }
        if (has(b1, 'collectBeforeSubmit')) {
          if (typeof b1.collectBeforeSubmit === 'boolean') rules.B1.collectBeforeSubmit = b1.collectBeforeSubmit;
          else fields['commissionRules.B1.collectBeforeSubmit'] = '格式不正确';
        }
      }
      const c1 = group('C1');
      if (c1 && has(c1, 'maxMarkup')) {
        if (c1.maxMarkup === null || isNum(c1.maxMarkup)) rules.C1.maxMarkup = c1.maxMarkup;
        else fields['commissionRules.C1.maxMarkup'] = '金额不正确';
      }
      if (has(br, 'paidMarkedBy')) {
        if (br.paidMarkedBy === 'admin' || br.paidMarkedBy === 'staff') rules.paidMarkedBy = br.paidMarkedBy;
        else fields['commissionRules.paidMarkedBy'] = '格式不正确';
      }
    }
  }

  if (has(b, 'licenceTypes')) {
    const v = b.licenceTypes;
    const list = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : null)) : null;
    if (!list || list.length < 1 || list.length > 30 || list.some((x) => !x || x.length > 50) || new Set(list).size !== list.length) {
      fields.licenceTypes = '请填写 1 到 30 个不重复的执照类型（每个不超过 50 字）';
    } else next.licenceTypes = list as string[];
  }

  if (has(b, 'inactiveDays')) {
    const v = b.inactiveDays;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365) next.inactiveDays = v;
    else fields.inactiveDays = '请填写 1 到 365';
  }

  if (Object.keys(fields).length) throw new HttpError(400, BAD_FIELDS, fields);
  return next;
}

export function adminSettings(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ role: 'admin', jwks }));

  r.get('/', async (c) => c.json(await c.var.repo.getSettings()));

  // Saving never recalculates existing commissions: only later case changes use the new rules.
  r.put('/', async (c) => {
    const repo = c.var.repo;
    const raw = await readJson(c.req.raw);
    const next = mergeSettings(await repo.getSettings(), raw);
    await repo.saveSettings(next, c.var.staff.email);
    await auditQuietly(repo, c.var.staff.email, 'settings.update', 'settings', 'settings');
    return c.json(next);
  });

  return r;
}

export function adminStaff(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ role: 'admin', jwks }));

  r.get('/', async (c) => c.json(await c.var.repo.listStaff()));

  r.put('/:email', async (c) => {
    const repo = c.var.repo;
    const email = c.req.param('email').trim().toLowerCase();
    if (!isEmail(email)) throw bad('email', '电邮格式不正确');
    const b = readObject(await readJson(c.req.raw));
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) throw bad('name', '请填写姓名');
    if (name.length > MAX_TEXT) throw bad('name', '内容过长');
    if (b.role !== 'admin' && b.role !== 'staff') throw bad('role', '角色不正确');
    const team = b.team === undefined || b.team === null ? null : b.team;
    if (team !== null && !TEAMS.includes(team as Team)) throw bad('team', '团队不正确');
    if (has(b, 'active') && typeof b.active !== 'boolean') throw bad('active', '格式不正确');
    const active = has(b, 'active') ? (b.active as boolean) : true;
    const me = c.var.staff.email.toLowerCase();
    if (!active && email === me) throw new HttpError(400, '不能停用自己的账号');
    if (b.role === 'staff' && email === me) throw new HttpError(400, '不能降级自己的账号');
    // Never leave the system without an active admin (one listStaff call, only when an admin is demoted or deactivated).
    if (b.role !== 'admin' || !active) {
      const target = await repo.getStaff(email);
      if (target?.role === 'admin' && target.active) {
        const others = (await repo.listStaff()).filter((x) => x.email.toLowerCase() !== email && x.role === 'admin' && x.active);
        if (others.length === 0) throw new HttpError(400, '至少需要一位管理员');
      }
    }

    const s: Staff = { email, name, role: b.role, team: team as Team | null, active };
    await repo.saveStaff(s, c.var.staff.email);
    await auditQuietly(repo, c.var.staff.email, 'staff.save', 'staff', email, { role: s.role, active: s.active });
    return c.json(s);
  });

  return r;
}

/** The licence type list only. Any staff may read it (the case form needs it); the rest of the settings stay admin only. */
export function adminLicenceTypes(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  r.use('*', requireStaff({ jwks }));
  r.get('/', async (c) => c.json({ licenceTypes: (await c.var.repo.getSettings()).licenceTypes }));
  return r;
}
