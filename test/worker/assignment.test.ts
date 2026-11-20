// Partner → responsible staff, case → handling staff.
import { describe, expect, it } from 'vitest';
import type { Staff } from '../../src/shared/types';
import { partnerInput } from '../repo/repo.contract';
import { admin, clerk, setupAdmin } from './admin-helper';

const vera: Staff = { email: 'vera@tohsign.com', name: 'Vera', role: 'staff', team: null, active: true };
const gone: Staff = { email: 'gone@tohsign.com', name: 'Gone', role: 'staff', team: null, active: false };
const newCase = (partnerId: string, over: Record<string, unknown> = {}) => ({
  partnerId, clientName: '李先生', licenceType: '营业执照', price: 1800, ...over,
});
const partnerBody = (over: Record<string, unknown> = {}) => ({
  name: 'Ali', phone: '012-3456789', email: 'ali@x.my', code: 'A1', filledBy: '市场部', ...over,
});

async function setup() {
  const t = await setupAdmin();
  await t.repo.saveStaff(vera, 't');
  await t.repo.saveStaff(gone, 't');
  return t;
}

describe('partner assignment', () => {
  it('a new partner belongs to whoever registers them', async () => {
    const { req, json } = await setup();
    const p = await json(await req(clerk, 'POST', '/api/admin/partners', partnerBody()));
    expect(p.assignedStaff).toBe(clerk.email);
  });

  it('can be registered for another staff member, given in any case', async () => {
    const { req, json } = await setup();
    const res = await req(clerk, 'POST', '/api/admin/partners', partnerBody({ assignedStaff: ' VERA@tohsign.com ' }));
    expect(res.status).toBe(201);
    expect((await json(res)).assignedStaff).toBe(vera.email);
  });

  it('refuses an unknown or deactivated staff member, writing nothing', async () => {
    const { req, json, repo } = await setup();
    for (const who of ['nobody@x.my', gone.email]) {
      const res = await req(clerk, 'POST', '/api/admin/partners', partnerBody({ assignedStaff: who }));
      expect(res.status).toBe(400);
      expect((await json(res)).fields).toEqual({ assignedStaff: '请选择有效的员工' });
    }
    expect(await repo.listPartners({})).toHaveLength(0);
  });

  it('any staff member can reassign; the audit records from and to; existing cases stay put', async () => {
    const { req, json, repo, activePartner } = await setup();
    const p = await activePartner('A1', { assignedStaff: clerk.email });
    const before = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    expect(before.handledBy).toBe(clerk.email);

    const res = await req(clerk, 'PATCH', `/api/admin/partners/${p.id}`, { assignedStaff: vera.email });
    expect(res.status).toBe(200);
    expect((await json(res)).assignedStaff).toBe(vera.email);
    expect(repo.auditLog.at(-1)).toMatchObject({
      action: 'partner.update', details: { assignedStaff: { from: clerk.email, to: vera.email } },
    });
    expect((await repo.getCase(before.id))!.handledBy).toBe(clerk.email);
    const after = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id)));
    expect(after.handledBy).toBe(vera.email);
  });

  it('can be unassigned with null', async () => {
    const { req, json, activePartner } = await setup();
    const p = await activePartner('A1', { assignedStaff: clerk.email });
    const res = await req(admin, 'PATCH', `/api/admin/partners/${p.id}`, { assignedStaff: null });
    expect((await json(res)).assignedStaff).toBeNull();
  });

  it('lists only my partners with assignedStaff=me', async () => {
    const { req, json, repo } = await setup();
    await repo.createPartner(partnerInput({ name: 'Mine', assignedStaff: clerk.email }), 't');
    await repo.createPartner(partnerInput({ name: 'Veras', assignedStaff: vera.email }), 't');
    const mine = await json(await req(clerk, 'GET', '/api/admin/partners?assignedStaff=me'));
    expect(mine.map((p: { name: string }) => p.name)).toEqual(['Mine']);
    expect(await json(await req(clerk, 'GET', '/api/admin/partners'))).toHaveLength(2);
  });
});

describe('case handler', () => {
  it('a case of an unassigned partner goes to whoever creates it', async () => {
    const { req, json, activePartner } = await setup();
    const p = await activePartner('A1');
    expect((await json(await req(admin, 'POST', '/api/admin/cases', newCase(p.id)))).handledBy).toBe(admin.email);
  });

  it('can be given to another staff member at creation or later, and is audited', async () => {
    const { req, json, repo, activePartner } = await setup();
    const p = await activePartner('A1', { assignedStaff: clerk.email });
    const c = await json(await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { handledBy: vera.email })));
    expect(c.handledBy).toBe(vera.email);
    const res = await req(clerk, 'PATCH', `/api/admin/cases/${c.id}`, { handledBy: admin.email });
    expect(res.status).toBe(200);
    expect((await json(res)).handledBy).toBe(admin.email);
    expect(repo.auditLog.at(-1)).toMatchObject({
      action: 'case.update', details: { handledBy: { from: vera.email, to: admin.email } },
    });
  });

  it('refuses a deactivated handler', async () => {
    const { req, json, activePartner } = await setup();
    const p = await activePartner('A1');
    const res = await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { handledBy: gone.email }));
    expect(res.status).toBe(400);
    expect((await json(res)).fields).toEqual({ handledBy: '请选择有效的员工' });
  });

  it('lists only my cases with handledBy=me', async () => {
    const { req, json, activePartner } = await setup();
    const p = await activePartner('A1', { assignedStaff: clerk.email });
    await req(clerk, 'POST', '/api/admin/cases', newCase(p.id));
    await req(clerk, 'POST', '/api/admin/cases', newCase(p.id, { handledBy: vera.email }));
    expect(await json(await req(clerk, 'GET', '/api/admin/cases?handledBy=me'))).toHaveLength(1);
    expect(await json(await req(vera, 'GET', '/api/admin/cases?handledBy=me'))).toHaveLength(1);
  });
});

describe('GET /api/admin/staff-directory', () => {
  it('any staff member gets active names and emails only', async () => {
    const { req, json } = await setup();
    const res = await req(clerk, 'GET', '/api/admin/staff-directory');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list).toContainEqual({ email: vera.email, name: 'Vera' });
    expect(list.some((s: { email: string }) => s.email === gone.email)).toBe(false);
    expect(Object.keys(list[0]).sort()).toEqual(['email', 'name']);
  });
});
