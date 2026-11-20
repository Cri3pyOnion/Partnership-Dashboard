import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../src/shared/commission';
import type { Repo } from '../../src/worker/repo';
import type { Commission, NewCase, NewPartner, Settings, Staff } from '../../src/shared/types';

const run = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniq = (label: string) => `${label}-${run}-${++seq}`;

export const partnerInput = (over: Partial<NewPartner> = {}): NewPartner => ({
  name: uniq('Partner'),
  phone: '0123456789',
  email: `${uniq('p')}@example.com`,
  tin: null,
  company: null,
  code: 'A1',
  referralName: null,
  filledBy: 'Transmission',
  source: '上门',
  bankName: 'Maybank',
  bankAccount: '1122334455',
  ...over,
});

export const caseInput = (partnerId: string, over: Partial<NewCase> = {}): NewCase => ({
  partnerId,
  clientName: uniq('Client'),
  clientPhone: '0198765432',
  licenceType: '营业执照',
  council: 'MBPJ',
  missingDocs: null,
  price: 1800,
  markup: null,
  invoiceNo: null,
  notesInternal: null,
  ...over,
});

export function runRepoContract(make: () => Promise<Repo>): void {
  describe('partners', () => {
    it('assigns sequential ids, status 待审核 and no token', async () => {
      const repo = await make();
      const a = await repo.createPartner(partnerInput(), 'a@x.com');
      const b = await repo.createPartner(partnerInput(), 'a@x.com');
      const n = Number(a.id.slice(3));
      expect(a.id).toMatch(/^TSP\d{4,}$/);
      expect(b.id).toBe(`TSP${String(n + 1).padStart(4, '0')}`);
      expect(a.status).toBe('待审核');
      expect(a.viewToken).toBeNull();
      expect(a.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('round-trips nullable fields', async () => {
      const repo = await make();
      const input = partnerInput({ tin: 'IG123', company: uniq('Co'), referralName: 'Ali', source: '线上' });
      const p = await repo.createPartner(input, 'a@x.com');
      expect(await repo.getPartner(p.id)).toEqual(p);
      expect(p).toMatchObject(input);
      const bare = await repo.createPartner(partnerInput({ bankName: null, bankAccount: null, source: null }), 'a@x.com');
      expect(bare).toMatchObject({ tin: null, company: null, bankName: null, bankAccount: null, source: null });
    });

    it('ignores status and viewToken in the create input', async () => {
      const repo = await make();
      const evil = { ...partnerInput(), status: '活跃', viewToken: 'x'.repeat(43), registeredAt: '2000-01-01' } as unknown as NewPartner;
      const p = await repo.createPartner(evil, 'a@x.com');
      expect(p.status).toBe('待审核');
      expect(p.viewToken).toBeNull();
      expect(p.registeredAt).not.toBe('2000-01-01');
    });

    it('returns null for unknown id and unknown token', async () => {
      const repo = await make();
      expect(await repo.getPartner('TSP9999999')).toBeNull();
      expect(await repo.getPartnerByToken('x'.repeat(43))).toBeNull();
    });

    it('updates a partner and finds it by token', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const token = uniq('tok').padEnd(43, 'z');
      const u = await repo.updatePartner(p.id, { status: '活跃', viewToken: token }, 'a@x.com');
      expect(u.status).toBe('活跃');
      expect(u.name).toBe(p.name);
      expect((await repo.getPartnerByToken(token))?.id).toBe(p.id);
    });

    it('filters by status and by q (id, name, company, phone; case-insensitive)', async () => {
      const repo = await make();
      const tag = uniq('Zq');
      const a = await repo.createPartner(partnerInput({ name: `${tag}-Name` }), 'a@x.com');
      const b = await repo.createPartner(partnerInput({ company: `${tag}-Co Sdn Bhd` }), 'a@x.com');
      const phone = `01${String(Date.now()).slice(-8)}`;
      const c = await repo.createPartner(partnerInput({ phone }), 'a@x.com');
      await repo.updatePartner(b.id, { status: '活跃' }, 'a@x.com');
      const ids = async (f: Parameters<Repo['listPartners']>[0]) => (await repo.listPartners(f)).map((p) => p.id).sort();
      expect(await ids({ q: tag.toLowerCase() })).toEqual([a.id, b.id].sort());
      expect(await ids({ q: tag.toUpperCase(), status: '活跃' })).toEqual([b.id]);
      expect(await ids({ q: phone })).toEqual([c.id]);
      expect(await ids({ q: c.id.toLowerCase() })).toContain(c.id);
      expect(await ids({ q: `${tag},(odd)*%` })).toEqual([]);
    });
  });

  describe('cases', () => {
    it('creates 5 cases concurrently with distinct ids at step 0', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const cases = await Promise.all([1, 2, 3, 4, 5].map(() => repo.createCase(caseInput(p.id), 'a@x.com')));
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(5);
      for (const c of cases) {
        expect(c.id).toMatch(/^TS-\d{4}-\d{3,}$/);
        expect(c).toMatchObject({ step: 0, cancelled: false, clientPaid: false, clientPaidAt: null, partnerId: p.id });
      }
    });

    it('ignores step, cancelled and clientPaid in the create input', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const evil = { ...caseInput(p.id), step: 4, cancelled: true, clientPaid: true, clientPaidAt: '2026-01-01' } as unknown as NewCase;
      const c = await repo.createCase(evil, 'a@x.com');
      expect(c).toMatchObject({ step: 0, cancelled: false, clientPaid: false, clientPaidAt: null });
    });

    it('round-trips money as numbers and getCase returns null when missing', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id, { price: 1800.5, markup: 200 }), 'a@x.com');
      expect(c.price).toBe(1800.5);
      expect(c.markup).toBe(200);
      expect(await repo.getCase(c.id)).toEqual(c);
      expect(await repo.getCase('TS-0000-999')).toBeNull();
    });

    it('adds exactly one history row when the step changes 0 -> 2', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id), 'a@x.com');
      const before = await repo.listCaseHistory(c.id);
      const u = await repo.updateCase(c.id, { step: 2 }, 'staff@x.com');
      expect(u.step).toBe(2);
      const after = await repo.listCaseHistory(c.id);
      expect(after.length).toBe(before.length + 1);
      expect(after[after.length - 1]).toMatchObject({ step: 2, changedBy: 'staff@x.com' });
    });

    it('adds no history row when step is absent or unchanged', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id), 'a@x.com');
      await repo.updateCase(c.id, { step: 1 }, 'a@x.com');
      const n = (await repo.listCaseHistory(c.id)).length;
      const u1 = await repo.updateCase(c.id, { council: 'MBSJ', missingDocs: 'IC copy' }, 'a@x.com');
      const u2 = await repo.updateCase(c.id, { step: 1 }, 'a@x.com');
      expect(u1).toMatchObject({ council: 'MBSJ', missingDocs: 'IC copy', step: 1 });
      expect(u2.step).toBe(1);
      expect((await repo.listCaseHistory(c.id)).length).toBe(n);
    });

    it('updates payment and cancel fields', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id), 'a@x.com');
      const u = await repo.updateCase(c.id, { clientPaid: true, clientPaidAt: '2026-11-05', cancelled: true }, 'a@x.com');
      expect(u).toMatchObject({ clientPaid: true, clientPaidAt: '2026-11-05', cancelled: true });
    });

    it('filters by partnerId, step and month (YYYY-MM on submittedAt)', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const other = await repo.createPartner(partnerInput(), 'a@x.com');
      const oct = await repo.createCase(caseInput(p.id, { submittedAt: '2026-10-31' }), 'a@x.com');
      const nov = await repo.createCase(caseInput(p.id, { submittedAt: '2026-11-01' }), 'a@x.com');
      await repo.createCase(caseInput(other.id, { submittedAt: '2026-11-02' }), 'a@x.com');
      await repo.updateCase(nov.id, { step: 3 }, 'a@x.com');
      const ids = async (f: Parameters<Repo['listCases']>[0]) => (await repo.listCases(f)).map((c) => c.id).sort();
      expect(oct.submittedAt).toBe('2026-10-31');
      expect(await ids({ partnerId: p.id })).toEqual([oct.id, nov.id].sort());
      expect(await ids({ partnerId: p.id, month: '2026-10' })).toEqual([oct.id]);
      expect(await ids({ partnerId: p.id, month: '2026-11' })).toEqual([nov.id]);
      expect(await ids({ partnerId: p.id, step: 3 })).toEqual([nov.id]);
      expect(await ids({ partnerId: p.id, step: 5 })).toEqual([]);
    });
  });

  describe('commissions', () => {
    it('upserts on caseId and lists by partner and month', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const oct = await repo.createCase(caseInput(p.id, { submittedAt: '2026-10-10' }), 'a@x.com');
      const nov = await repo.createCase(caseInput(p.id, { submittedAt: '2026-11-10' }), 'a@x.com');
      const base: Commission = { caseId: oct.id, code: 'A1', amount: 150, basis: 'above', status: '待处理', paidAt: null, paidBy: null };
      expect(await repo.getCommission(oct.id)).toBeNull();
      await repo.saveCommission(base);
      await repo.saveCommission({ ...base, status: '已支付', paidAt: '2026-11-12T03:00:00.000Z', paidBy: 'admin@x.com' });
      await repo.saveCommission({ ...base, caseId: nov.id, amount: 100 });
      expect(await repo.getCommission(oct.id)).toEqual({ ...base, status: '已支付', paidAt: '2026-11-12T03:00:00.000Z', paidBy: 'admin@x.com' });
      const all = await repo.listCommissions({ partnerId: p.id });
      expect(all.map((c) => c.caseId).sort()).toEqual([oct.id, nov.id].sort());
      const octOnly = await repo.listCommissions({ partnerId: p.id, month: '2026-10' });
      expect(octOnly.map((c) => c.caseId)).toEqual([oct.id]);
    });

    it('ignores any save over an 已支付 row (a concurrent recalc cannot unfreeze it)', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id), 'a@x.com');
      const paid: Commission = { caseId: c.id, code: 'A1', amount: 150, basis: 'above', status: '已支付', paidAt: '2026-11-12T03:00:00.000Z', paidBy: 'admin@x.com' };
      await repo.saveCommission(paid);
      await repo.saveCommission({ ...paid, amount: 100, status: '可发放', paidAt: null, paidBy: null });
      expect(await repo.getCommission(c.id)).toEqual(paid);
      // 已结清 is frozen in app code, not in the repo, so an explicit un-settle can still be saved.
      const settled: Commission = { caseId: c.id, code: 'B1', amount: 1440, basis: 'b', status: '已结清', paidAt: null, paidBy: null };
      const c2 = await repo.createCase(caseInput(p.id), 'a@x.com');
      await repo.saveCommission({ ...settled, caseId: c2.id });
      await repo.saveCommission({ ...settled, caseId: c2.id, status: '待付发票' });
      expect((await repo.getCommission(c2.id))?.status).toBe('待付发票');
    });
  });

  describe('settings', () => {
    it('returns the defaults, then round-trips a save', async () => {
      const repo = await make();
      const original = await repo.getSettings();
      expect(original.commissionRules).toEqual(DEFAULT_RULES);
      expect(original.inactiveDays).toBe(90);
      expect(original.licenceTypes).toEqual(['营业执照', '招牌执照', '清真认证 (JAKIM)', 'SSM 公司注册', '消防证书 (BOMBA)']);
      const next: Settings = {
        commissionRules: { ...DEFAULT_RULES, A1: { threshold: 2000, below: 120, above: 180 } },
        licenceTypes: [...original.licenceTypes, '其他'],
        inactiveDays: 60,
      };
      try {
        await repo.saveSettings(next, 'admin@x.com');
        expect(await repo.getSettings()).toEqual(next);
      } finally {
        await repo.saveSettings(original, 'admin@x.com');
      }
      expect(await repo.getSettings()).toEqual(original);
    });
  });

  describe('staff', () => {
    it('saves, updates, gets and lists', async () => {
      const repo = await make();
      expect(await repo.getStaff('nobody@example.com')).toBeNull();
      const s: Staff = { email: `${uniq('s')}@example.com`, name: 'Siti', role: 'staff', team: 'Marketing', active: true };
      await repo.saveStaff(s, 'admin@x.com');
      expect(await repo.getStaff(s.email)).toEqual(s);
      const changed: Staff = { ...s, role: 'admin', team: null, active: false };
      await repo.saveStaff(changed, 'admin@x.com');
      expect(await repo.getStaff(s.email)).toEqual(changed);
      const all = await repo.listStaff();
      expect(all.filter((x) => x.email === s.email)).toEqual([changed]);
    });
  });

  describe('link views', () => {
    it('drops a repeat view of the same partner and country inside the window', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      expect(await repo.logLinkView(p.id, 'MY')).toBe(true);
      expect(await repo.logLinkView(p.id, 'MY')).toBe(false);
      expect(await repo.logLinkView(p.id, 'SG')).toBe(true);
      expect(await repo.logLinkView(p.id, null)).toBe(true);
      expect(await repo.logLinkView(p.id, null)).toBe(false);
      expect(await repo.listLinkViews(p.id, 10)).toHaveLength(3);
    });

    it('keeps only the newest 100 views per partner', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const other = await repo.createPartner(partnerInput(), 'a@x.com');
      await repo.logLinkView(other.id, 'MY');
      for (let i = 0; i < 105; i++) await repo.logLinkView(p.id, `X${i}`);
      const views = await repo.listLinkViews(p.id, 200);
      expect(views).toHaveLength(100);
      expect(views[0].country).toBe('X104');
      expect(views.some((v) => v.country === 'X4')).toBe(false);
      expect(await repo.listLinkViews(other.id, 10)).toHaveLength(1);
    });

    it('lists newest first and honours the limit', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      for (const country of ['MY', 'SG', null, 'ID']) {
        await repo.logLinkView(p.id, country);
        await new Promise((r) => setTimeout(r, 15));
      }
      const views = await repo.listLinkViews(p.id, 10);
      expect(views.map((v) => v.country)).toEqual(['ID', null, 'SG', 'MY']);
      expect(views[0].viewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect((await repo.listLinkViews(p.id, 2)).map((v) => v.country)).toEqual(['ID', null]);
    });
  });

  describe('documents and audit', () => {
    it('adds and lists documents per case', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id), 'a@x.com');
      expect(await repo.listDocuments(c.id)).toEqual([]);
      const d = await repo.addDocument({ caseId: c.id, storagePath: `${c.id}/a.pdf`, filename: 'a.pdf', kind: 'IC' }, 'staff@x.com');
      expect(d).toMatchObject({ caseId: c.id, filename: 'a.pdf', kind: 'IC', uploadedBy: 'staff@x.com' });
      expect(d.id).toBeTruthy();
      expect(await repo.listDocuments(c.id)).toEqual([d]);
    });

    it('gets one document by id, or null', async () => {
      const repo = await make();
      const p = await repo.createPartner(partnerInput(), 'a@x.com');
      const c = await repo.createCase(caseInput(p.id), 'a@x.com');
      const d = await repo.addDocument({ caseId: c.id, storagePath: `${c.id}/a.pdf`, filename: 'a.pdf', kind: 'IC' }, 'staff@x.com');
      expect(await repo.getDocument(d.id)).toEqual(d);
      expect(await repo.getDocument('11111111-1111-4111-8111-111111111111')).toBeNull();
    });

    it('writes audit rows without error', async () => {
      const repo = await make();
      await expect(repo.audit('a@x.com', 'partner.approve', 'partner', 'TSP0001', { note: 'ok' })).resolves.toBeUndefined();
      await expect(repo.audit('a@x.com', 'noop', 'partner', 'TSP0001')).resolves.toBeUndefined();
    });
  });
}
