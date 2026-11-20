import { describe, expect, it } from 'vitest';
import type { Case, Commission } from '../../src/shared/types';
import { buildPartnerView, whatsappLink, type MoneyKind, type PartnerView } from '../../src/worker/view-model';
import { DEMO_BANK_ACCOUNT, demoCases, demoCommissions, demoPartner } from '../fixtures/demo';

const WA = '+60 12-345 6789';

/** The money tile pair of one kind, or undefined when the page does not show it. */
const money = (v: PartnerView, kind: MoneyKind) => v.tiles.money.find((m) => m.kind === kind);
const total = (m: PartnerView['months'][number]) => m.commission + m.b1;

describe('buildPartnerView', () => {
  it('never leaks bank, phone, notes or document fields', () => {
    const cases = demoCases();
    const json = JSON.stringify(buildPartnerView(demoPartner(), cases, demoCommissions(cases), WA));
    for (const bad of ['bankAccount', DEMO_BANK_ACCOUNT, 'bankName', 'Maybank', 'clientPhone', '+60198887777',
      'notesInternal', 'internal: client', 'storage_path', 'storagePath', 'siewling@limco.my', 'C2584463202', 'price']) {
      expect(json).not.toContain(bad);
    }
  });

  it('copies only id, name, company and code of the partner', () => {
    const v = buildPartnerView(demoPartner(), [], [], WA);
    expect(v.partner).toEqual({ id: 'TSP0003', name: 'Lim Siew Ling', company: 'Lim & Co. Accounting', code: 'C1' });
  });

  it('uses A1/C1 labels and B1 labels; with no rows, the partner code decides the one pair shown', () => {
    for (const code of ['A1', 'C1'] as const) {
      const v = buildPartnerView(demoPartner({ code }), [], [], WA);
      expect(v.tiles.money).toEqual([{ kind: 'commission', pending: 0, paid: 0, pendingLabel: '待发佣金', paidLabel: '已发佣金' }]);
    }
    const b = buildPartnerView(demoPartner({ code: 'B1' }), [], [], WA);
    expect(b.tiles.money).toEqual([{ kind: 'b1', pending: 0, paid: 0, pendingLabel: "待付给 Toh's Sign", paidLabel: "已与 Toh's Sign 结清" }]);
  });

  it('counts the 5 demo cases as active 4, done 1 and sums money', () => {
    const cases = demoCases();
    const comms = demoCommissions(cases);
    comms[4] = { ...comms[4], status: '已支付' };
    const v = buildPartnerView(demoPartner(), cases, comms, WA);
    expect(v.tiles.active).toBe(4);
    expect(v.tiles.done).toBe(1);
    expect(v.tiles.money).toHaveLength(1);
    expect(money(v, 'commission')).toMatchObject({ pending: 300 + 150 + 400 + 250, paid: 150 });
  });

  it('excludes cancelled cases from active/done and marks their step', () => {
    const cases: Case[] = [...demoCases(), { ...demoCases()[0], id: 'TS-2611-020', step: 5, cancelled: true }];
    const v = buildPartnerView(demoPartner(), cases, demoCommissions(cases), WA);
    expect(v.tiles.active).toBe(4);
    expect(v.tiles.done).toBe(1);
    expect(v.cases.find((c) => c.id === 'TS-2611-020')!.step).toBe('cancelled');
    expect(v.months).toEqual([
      { month: '2026-11', commission: 300, b1: 0 },
      { month: '2026-10', commission: 150 + 400 + 250, b1: 0 },
      { month: '2026-09', commission: 150, b1: 0 },
    ]);
    expect(v.monthKinds).toEqual(['commission']);
  });

  it('tiles and months both count by commission status, cancelled cases included (R23)', () => {
    const cancelled: Case = { ...demoCases()[4], id: 'TS-2609-020', cancelled: true };
    const cases: Case[] = [...demoCases(), cancelled];
    const comms = demoCommissions(demoCases());
    comms.push({ caseId: cancelled.id, code: 'C1', amount: 120, basis: 'frozen', status: '已支付', paidAt: '2026-09-30T00:00:00Z', paidBy: 'a' });
    const v = buildPartnerView(demoPartner(), cases, comms, WA);
    const m = money(v, 'commission')!;
    expect(m.paid).toBe(120);
    expect(m.pending).toBe(300 + 150 + 400 + 250 + 150);
    expect(total(v.months.find((x) => x.month === '2026-09')!)).toBe(150 + 120);
    const monthSum = v.months.reduce((a, x) => a + total(x), 0);
    expect(monthSum).toBe(m.pending + m.paid);
  });

  it('a partner whose code changed keeps old rows labelled and counted by their own code', () => {
    const cases = demoCases().slice(0, 2);
    const comms = demoCommissions(cases, 'C1'); // old C1 rows at 待处理
    const v = buildPartnerView(demoPartner({ code: 'B1' }), [...cases, { ...demoCases()[2] }], comms, WA);
    const old = v.cases.find((c) => c.id === 'TS-2611-014')!;
    expect(old.amountLabel).toBe('你的佣金');
    expect(old.commissionStatus).toBe('待处理');
    expect(money(v, 'commission')).toMatchObject({ pending: 300 + 150, pendingLabel: '待发佣金' });
    const fresh = v.cases.find((c) => c.id === 'TS-2610-031')!; // no row: current code decides
    expect([fresh.amountLabel, fresh.commissionStatus, fresh.amount]).toEqual(["应付 Toh's Sign", '待付发票', null]);
    expect(money(v, 'b1')).toBeUndefined(); // no B1 row counted yet
    const back = buildPartnerView(demoPartner({ code: 'C1' }), cases, demoCommissions(cases, 'B1'), WA);
    expect(back.cases.every((c) => c.amountLabel === "应付 Toh's Sign")).toBe(true);
    expect(back.tiles.money).toEqual([{ kind: 'b1', pending: 1440 + 720, paid: 0, pendingLabel: "待付给 Toh's Sign", paidLabel: "已与 Toh's Sign 结清" }]);
  });

  it('a mixed-code partner (A1/C1 and B1 rows) gets two separate pairs and two monthly columns', () => {
    const cases = demoCases(); // 2026-11: 014; 2026-10: 009, 031, 020; 2026-09: 012
    const c1 = demoCommissions(cases.slice(0, 3), 'C1'); // 014 300, 009 150, 031 400, all 待处理
    c1[1] = { ...c1[1], status: '已支付' };
    const b1 = demoCommissions(cases.slice(3), 'B1'); // 020 1200 已结清, 012 680 已结清
    b1[0] = { ...b1[0], status: '待付发票' };
    const v = buildPartnerView(demoPartner({ code: 'B1' }), cases, [...c1, ...b1], WA);
    expect(v.tiles.money).toEqual([
      { kind: 'b1', pending: 1200, paid: 680, pendingLabel: "待付给 Toh's Sign", paidLabel: "已与 Toh's Sign 结清" },
      { kind: 'commission', pending: 300 + 400, paid: 150, pendingLabel: '待发佣金', paidLabel: '已发佣金' },
    ]);
    expect(v.monthKinds).toEqual(['commission', 'b1']);
    expect(v.months).toEqual([
      { month: '2026-11', commission: 300, b1: 0 },
      { month: '2026-10', commission: 150 + 400, b1: 1200 },
      { month: '2026-09', commission: 0, b1: 680 },
    ]);
    // Money flowing to the partner is never added to money owed by the partner.
    expect(v.tiles.money.every((m) => m.pending !== 300 + 400 + 1200)).toBe(true);
  });

  it('sorts newest submittedAt first and shapes each case', () => {
    const cases = demoCases().reverse();
    const v = buildPartnerView(demoPartner(), cases, demoCommissions(cases), WA);
    expect(v.cases.map((c) => c.id)).toEqual(['TS-2611-014', 'TS-2611-009', 'TS-2610-031', 'TS-2610-020', 'TS-2609-012']);
    expect(v.cases[0]).toEqual({
      id: 'TS-2611-014', clientName: 'Kedai Kopi Ah Seng', licence: '营业执照 (MBPJ)', submittedAt: '2026-11-03',
      step: 2, missingDocs: null, amount: 300, amountLabel: '你的佣金', commissionStatus: '待处理',
    });
    expect(v.cases[2].licence).toBe('清真认证 (JAKIM)');
    expect(v.cases[1].missingDocs).toBe('缺少：租约');
  });

  it('a case without a commission row has amount null and the default status', () => {
    const cases = demoCases();
    const a = buildPartnerView(demoPartner(), cases, [], WA);
    expect(a.cases.every((c) => c.amount === null && c.commissionStatus === '待处理')).toBe(true);
    expect(money(a, 'commission')!.pending).toBe(0);
    expect(a.months).toEqual([]);
    const b = buildPartnerView(demoPartner({ code: 'B1' }), cases, [], WA);
    expect(b.cases.every((c) => c.commissionStatus === '待付发票' && c.amountLabel === "应付 Toh's Sign")).toBe(true);
  });

  it('B1 pending counts 待付发票 and paid counts 已结清', () => {
    const cases = demoCases();
    const comms: Commission[] = demoCommissions(cases, 'B1');
    const v = buildPartnerView(demoPartner({ code: 'B1' }), cases, comms, WA);
    expect(v.tiles.money).toHaveLength(1);
    expect(money(v, 'b1')).toMatchObject({ pending: 1440 + 720 + 2000, paid: 1200 + 680 });
  });

  it('builds the WhatsApp link, or none when the number is empty', () => {
    const v = buildPartnerView(demoPartner(), [], [], WA);
    expect(v.whatsapp).toBe(`https://wa.me/60123456789?text=${encodeURIComponent('您好，我是伙伴 TSP0003 Lim Siew Ling')}`);
    expect(buildPartnerView(demoPartner(), [], [], '').whatsapp).toBe('');
    expect(whatsappLink('', 'x')).toBe('');
  });
});
