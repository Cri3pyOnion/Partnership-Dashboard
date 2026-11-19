import { describe, expect, it } from 'vitest';
import { DB_DOWN, admin, clerk, setupAdmin } from './admin-helper';

const newCase = (partnerId: string, over: Record<string, unknown> = {}) => ({
  partnerId, clientName: '李先生', licenceType: '营业执照', price: 1800, ...over,
});

describe('settings', () => {
  it('GET and PUT are admin only', async () => {
    const { req } = await setupAdmin();
    expect((await req(null, 'GET', '/api/admin/settings')).status).toBe(401);
    expect((await req(clerk, 'GET', '/api/admin/settings')).status).toBe(403);
    expect((await req(clerk, 'PUT', '/api/admin/settings', {})).status).toBe(403);
    expect((await req(admin, 'GET', '/api/admin/settings')).status).toBe(200);
  });

  it('GET returns the stored settings', async () => {
    const { req, json } = await setupAdmin();
    const s = await json(await req(admin, 'GET', '/api/admin/settings'));
    expect(s.commissionRules.A1).toEqual({ threshold: 1500, below: 100, above: 150 });
    expect(Array.isArray(s.licenceTypes)).toBe(true);
    expect(s.inactiveDays).toBe(90);
  });

  it('PUT saves valid settings, audits, and returns them', async () => {
    const { req, repo, json } = await setupAdmin();
    const cur = await json(await req(admin, 'GET', '/api/admin/settings'));
    const next = {
      ...cur,
      commissionRules: {
        A1: { threshold: 2000, below: 80, above: 120 },
        B1: { partnerPricePercent: 70, collectBeforeSubmit: true },
        C1: { maxMarkup: 400 },
        paidMarkedBy: 'staff',
      },
      licenceTypes: ['营业执照', '广告牌'],
      inactiveDays: 60,
    };
    const res = await req(admin, 'PUT', '/api/admin/settings', next);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(next);
    expect(await repo.getSettings()).toEqual(next);
    expect(repo.auditLog.at(-1)).toMatchObject({ action: 'settings.update', entity: 'settings', by: admin.email });
  });

  it('a partial body is merged over the stored settings', async () => {
    const { req, repo, json } = await setupAdmin();
    const res = await req(admin, 'PUT', '/api/admin/settings', { inactiveDays: 30 });
    expect(res.status).toBe(200);
    const s = await repo.getSettings();
    expect(s.inactiveDays).toBe(30);
    expect(s.commissionRules.A1.threshold).toBe(1500);
    expect(await json(res)).toEqual(s);
  });

  const bad = (path: string, v: unknown): Record<string, unknown> => {
    const rules: any = { A1: {}, B1: {}, C1: {} };
    const [a, b] = path.split('.');
    if (path === 'licenceTypes' || path === 'inactiveDays') return { [path]: v };
    if (path === 'paidMarkedBy') return { commissionRules: { paidMarkedBy: v } };
    rules[a][b] = v;
    return { commissionRules: rules };
  };

  it.each([
    ['A1.threshold -1', 'A1.threshold', -1],
    ['A1.below negative', 'A1.below', -5],
    ['A1.above text', 'A1.above', '150'],
    ['B1 percent 101', 'B1.partnerPricePercent', 101],
    ['B1 percent -1', 'B1.partnerPricePercent', -1],
    ['B1 collect not boolean', 'B1.collectBeforeSubmit', 'yes'],
    ['C1 maxMarkup negative', 'C1.maxMarkup', -1],
    ['C1 maxMarkup text', 'C1.maxMarkup', 'x'],
    ['paidMarkedBy other', 'paidMarkedBy', 'everyone'],
    ['licenceTypes empty', 'licenceTypes', []],
    ['licenceTypes 31', 'licenceTypes', Array.from({ length: 31 }, (_, i) => `T${i}`)],
    ['licenceTypes blank', 'licenceTypes', ['a', ' ']],
    ['licenceTypes long', 'licenceTypes', ['x'.repeat(51)]],
    ['licenceTypes duplicate', 'licenceTypes', ['a', 'a']],
    ['licenceTypes not strings', 'licenceTypes', [1]],
    ['inactiveDays 0', 'inactiveDays', 0],
    ['inactiveDays 366', 'inactiveDays', 366],
    ['inactiveDays 1.5', 'inactiveDays', 1.5],
  ])('400 on %s, and nothing is saved', async (_n, path, v) => {
    const { req, repo } = await setupAdmin();
    const before = await repo.getSettings();
    const res = await req(admin, 'PUT', '/api/admin/settings', bad(path, v));
    expect(res.status).toBe(400);
    expect(await repo.getSettings()).toEqual(before);
  });

  it('accepts the boundaries', async () => {
    const { req } = await setupAdmin();
    const res = await req(admin, 'PUT', '/api/admin/settings', {
      commissionRules: { A1: { threshold: 0, below: 0, above: 0 }, B1: { partnerPricePercent: 100 }, C1: { maxMarkup: null } },
      licenceTypes: ['x'.repeat(50)],
      inactiveDays: 365,
    });
    expect(res.status).toBe(200);
  });

  it('the error body names the field', async () => {
    const { req, json } = await setupAdmin();
    const res = await req(admin, 'PUT', '/api/admin/settings', bad('A1.threshold', -1));
    const j = await json(res);
    expect(j.error).toBe('请检查红色栏位');
    expect(Object.keys(j.fields)).toContain('commissionRules.A1.threshold');
  });

  it('saving does not recalculate existing commissions', async () => {
    const { req, activePartner, repo, json } = await setupAdmin();
    const p = await activePartner('A1');
    const paid = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    await req(clerk, 'PATCH', `/api/admin/cases/${paid.id}`, { clientPaid: true });
    await req(admin, 'POST', `/api/admin/commissions/${paid.id}/mark-paid`);
    const ready = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    await req(clerk, 'PATCH', `/api/admin/cases/${ready.id}`, { clientPaid: true });
    const before = [await repo.getCommission(paid.id), await repo.getCommission(ready.id)];
    expect(before.map((x) => x!.status)).toEqual(['已支付', '可发放']);
    const cur = await json(await req(admin, 'GET', '/api/admin/settings'));
    cur.commissionRules.A1 = { threshold: 5000, below: 10, above: 20 };
    expect((await req(admin, 'PUT', '/api/admin/settings', cur)).status).toBe(200);
    expect([await repo.getCommission(paid.id), await repo.getCommission(ready.id)]).toEqual(before);
  });

  it('repo outage is a 503', async () => {
    const { req, repo, json } = await setupAdmin();
    repo.failNext();
    // requireStaff reads the staff row first, so this hits the guard
    const res = await req(admin, 'GET', '/api/admin/settings');
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual(DB_DOWN);
  });
});

describe('staff', () => {
  it('GET and PUT are admin only', async () => {
    const { req } = await setupAdmin();
    expect((await req(clerk, 'GET', '/api/admin/staff')).status).toBe(403);
    expect((await req(clerk, 'PUT', '/api/admin/staff/x@tohsign.com', { name: 'X', role: 'staff', team: null })).status).toBe(403);
  });

  it('lists staff', async () => {
    const { req, json } = await setupAdmin();
    const list = await json(await req(admin, 'GET', '/api/admin/staff'));
    expect(list.map((s: any) => s.email)).toEqual([admin.email, clerk.email]);
  });

  it('creates and updates a staff member; the email is lowercased', async () => {
    const { req, repo, json } = await setupAdmin();
    const res = await req(admin, 'PUT', '/api/admin/staff/New.Person@TohSign.com', {
      name: ' New Person ', role: 'staff', team: 'Transmission', active: true,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ email: 'new.person@tohsign.com', name: 'New Person', role: 'staff', team: 'Transmission', active: true });
    expect(await repo.getStaff('new.person@tohsign.com')).toMatchObject({ name: 'New Person' });
    const upd = await req(admin, 'PUT', '/api/admin/staff/new.person@tohsign.com', { name: 'Renamed', role: 'admin', team: null, active: true });
    expect(await json(upd)).toMatchObject({ name: 'Renamed', role: 'admin', team: null });
    expect(repo.auditLog.at(-1)).toMatchObject({ action: 'staff.save', entity: 'staff', id: 'new.person@tohsign.com' });
  });

  it.each([
    ['bad role', { name: 'A', role: 'owner', team: null }],
    ['bad team', { name: 'A', role: 'staff', team: 'Sales' }],
    ['no name', { name: ' ', role: 'staff', team: null }],
    ['long name', { name: 'x'.repeat(201), role: 'staff', team: null }],
    ['active not boolean', { name: 'A', role: 'staff', team: null, active: 'no' }],
  ])('400 on %s', async (_n, body) => {
    const { req, repo } = await setupAdmin();
    const res = await req(admin, 'PUT', '/api/admin/staff/a@tohsign.com', body);
    expect(res.status).toBe(400);
    expect(await repo.getStaff('a@tohsign.com')).toBeNull();
  });

  it('400 on a bad email in the path', async () => {
    const { req } = await setupAdmin();
    expect((await req(admin, 'PUT', '/api/admin/staff/not-an-email', { name: 'A', role: 'staff', team: null })).status).toBe(400);
  });

  it('an admin cannot deactivate their own account', async () => {
    const { req, repo, json } = await setupAdmin();
    const res = await req(admin, 'PUT', `/api/admin/staff/${admin.email}`, { name: 'Boss', role: 'admin', team: 'IT', active: false });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '不能停用自己的账号' });
    expect((await repo.getStaff(admin.email))!.active).toBe(true);
  });

  it("a deactivated staff member's next request is a 403", async () => {
    const { req } = await setupAdmin();
    expect((await req(clerk, 'GET', '/api/admin/cases')).status).toBe(200);
    const off = await req(admin, 'PUT', `/api/admin/staff/${clerk.email}`, { name: 'Clerk', role: 'staff', team: '市场部', active: false });
    expect(off.status).toBe(200);
    expect((await req(clerk, 'GET', '/api/admin/cases')).status).toBe(403);
    expect((await req(clerk, 'GET', '/api/admin/me')).status).toBe(403);
  });

  it('repo outage is a 503', async () => {
    const { req, repo, json } = await setupAdmin();
    const orig = repo.listStaff.bind(repo);
    repo.listStaff = async () => {
      repo.failNext();
      return orig();
    };
    const res = await req(admin, 'GET', '/api/admin/staff');
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual(DB_DOWN);
  });
});

describe('R34 and extras', () => {
  it('an empty PUT settings body is a 400', async () => {
    const { req, json } = await setupAdmin();
    const res = await req(admin, 'PUT', '/api/admin/settings', {});
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '没有需要更新的栏位' });
  });

  it('an admin cannot demote themselves', async () => {
    const { req, repo, json } = await setupAdmin();
    const res = await req(admin, 'PUT', `/api/admin/staff/${admin.email}`, { name: 'Boss', role: 'staff', team: 'IT', active: true });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('不能降级自己的账号');
    expect((await repo.getStaff(admin.email))!.role).toBe('admin');
  });

  it('demoting another admin is fine while an admin remains; non-admins do not list staff', async () => {
    const { req, repo } = await setupAdmin();
    await repo.saveStaff({ email: 'two@tohsign.com', name: 'Two', role: 'admin', team: null, active: true }, 't');
    const calls: string[] = [];
    const orig = repo.listStaff.bind(repo);
    repo.listStaff = async () => {
      calls.push('listStaff');
      return orig();
    };
    const res = await req(admin, 'PUT', '/api/admin/staff/two@tohsign.com', { name: 'Two', role: 'staff', team: null, active: true });
    expect(res.status).toBe(200);
    expect(calls).toEqual(['listStaff']);
    await req(admin, 'PUT', `/api/admin/staff/${clerk.email}`, { name: 'Clerk', role: 'staff', team: null, active: false });
    expect(calls).toEqual(['listStaff']);
  });

  it('never leaves zero active admins', async () => {
    const { req, repo, json } = await setupAdmin();
    await repo.saveStaff({ email: 'two@tohsign.com', name: 'Two', role: 'admin', team: null, active: true }, 't');
    // a stale list in which the target is the only admin
    repo.listStaff = async () => [{ email: 'two@tohsign.com', name: 'Two', role: 'admin', team: null, active: true }];
    const res = await req(admin, 'PUT', '/api/admin/staff/two@tohsign.com', { name: 'Two', role: 'staff', team: null, active: true });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '至少需要一位管理员' });
    const res2 = await req(admin, 'PUT', '/api/admin/staff/two@tohsign.com', { name: 'Two', role: 'admin', team: null, active: false });
    expect(res2.status).toBe(400);
    expect((await repo.getStaff('two@tohsign.com'))!.role).toBe('admin');
  });
});

describe('GET /api/admin/licence-types', () => {
  it('needs a login but any staff may read it', async () => {
    const { req, json } = await setupAdmin();
    expect((await req(null, 'GET', '/api/admin/licence-types')).status).toBe(401);
    const res = await req(clerk, 'GET', '/api/admin/licence-types');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body)).toEqual(['licenceTypes']);
    expect(body.licenceTypes).toContain('营业执照');
  });

  it('returns only the list, never the commission rules', async () => {
    const { req } = await setupAdmin();
    const text = await (await req(clerk, 'GET', '/api/admin/licence-types')).text();
    expect(text).not.toContain('commissionRules');
  });
});
