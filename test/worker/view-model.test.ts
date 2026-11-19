import { describe, expect, it } from 'vitest';
import type { Case, Commission } from '../../src/shared/types';
import { buildPartnerView, whatsappLink } from '../../src/worker/view-model';
import { DEMO_BANK_ACCOUNT, demoCases, demoCommissions, demoPartner } from '../fixtures/demo';

const WA = '+60 12-345 6789';

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

  it('uses A1/C1 labels and B1 labels', () => {
    for (const code of ['A1', 'C1'] as const) {
      const v = buildPartnerView(demoPartner({ code }), [], [], WA);
      expect([v.tiles.pendingLabel, v.tiles.paidLabel]).toEqual(['待发佣金', '已发佣金']);
    }
    const b = buildPartnerView(demoPartner({ code: 'B1' }), [], [], WA);
    expect([b.tiles.pendingLabel, b.tiles.paidLabel]).toEqual(["待付给 Toh's Sign", "已与 Toh's Sign 结清"]);
  });

  it('counts the 5 demo cases as active 4, done 1 and sums money', () => {
    const cases = demoCases();
    const comms = demoCommissions(cases);
    comms[4] = { ...comms[4], status: '已支付' };
    const v = buildPartnerView(demoPartner(), cases, comms, WA);
    expect(v.tiles.active).toBe(4);
    expect(v.tiles.done).toBe(1);
    expect(v.tiles.pending).toBe(300 + 150 + 400 + 250);
    expect(v.tiles.paid).toBe(150);
  });

  it('excludes cancelled cases from active/done and marks their step', () => {
    const cases: Case[] = [...demoCases(), { ...demoCases()[0], id: 'TS-2611-020', step: 5, cancelled: true }];
    const v = buildPartnerView(demoPartner(), cases, demoCommissions(cases), WA);
    expect(v.tiles.active).toBe(4);
    expect(v.tiles.done).toBe(1);
    expect(v.cases.find((c) => c.id === 'TS-2611-020')!.step).toBe('cancelled');
    expect(v.months).toEqual([
      { month: '2026-11', total: 300 },
      { month: '2026-10', total: 150 + 400 + 250 },
      { month: '2026-09', total: 150 },
    ]);
  });

  it('tiles and months both count by commission status, cancelled cases included (R23)', () => {
    const cancelled: Case = { ...demoCases()[4], id: 'TS-2609-020', cancelled: true };
    const cases: Case[] = [...demoCases(), cancelled];
    const comms = demoCommissions(demoCases());
    comms.push({ caseId: cancelled.id, code: 'C1', amount: 120, basis: 'frozen', status: '已支付', paidAt: '2026-09-30T00:00:00Z', paidBy: 'a' });
    const v = buildPartnerView(demoPartner(), cases, comms, WA);
    expect(v.tiles.paid).toBe(120);
    expect(v.tiles.pending).toBe(300 + 150 + 400 + 250 + 150);
    expect(v.months.find((m) => m.month === '2026-09')!.total).toBe(150 + 120);
    const monthSum = v.months.reduce((a, m) => a + m.total, 0);
    expect(monthSum).toBe(v.tiles.pending + v.tiles.paid);
  });

  it('a partner whose code changed keeps old rows labelled and counted by their own code', () => {
    const cases = demoCases().slice(0, 2);
    const comms = demoCommissions(cases, 'C1'); // old C1 rows at 待处理
    const v = buildPartnerView(demoPartner({ code: 'B1' }), [...cases, { ...demoCases()[2] }], comms, WA);
    const old = v.cases.find((c) => c.id === 'TS-2611-014')!;
    expect(old.amountLabel).toBe('你的佣金');
    expect(old.commissionStatus).toBe('待处理');
    expect(v.tiles.pending).toBe(300 + 150);
    const fresh = v.cases.find((c) => c.id === 'TS-2610-031')!; // no row: current code decides
    expect([fresh.amountLabel, fresh.commissionStatus, fresh.amount]).toEqual(["应付 Toh's Sign", '待付发票', null]);
    expect(v.tiles.pendingLabel).toBe("待付给 Toh's Sign");
    const back = buildPartnerView(demoPartner({ code: 'C1' }), cases, demoCommissions(cases, 'B1'), WA);
    expect(back.cases.every((c) => c.amountLabel === "应付 Toh's Sign")).toBe(true);
    expect(back.tiles.pending).toBe(1440 + 720);
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
    expect(a.tiles.pending).toBe(0);
    expect(a.months).toEqual([]);
    const b = buildPartnerView(demoPartner({ code: 'B1' }), cases, [], WA);
    expect(b.cases.every((c) => c.commissionStatus === '待付发票' && c.amountLabel === "应付 Toh's Sign")).toBe(true);
  });

  it('B1 pending counts 待付发票 and paid counts 已结清', () => {
    const cases = demoCases();
    const comms: Commission[] = demoCommissions(cases, 'B1');
    const v = buildPartnerView(demoPartner({ code: 'B1' }), cases, comms, WA);
    expect(v.tiles.pending).toBe(1440 + 720 + 2000);
    expect(v.tiles.paid).toBe(1200 + 680);
  });

  it('builds the WhatsApp link, or none when the number is empty', () => {
    const v = buildPartnerView(demoPartner(), [], [], WA);
    expect(v.whatsapp).toBe(`https://wa.me/60123456789?text=${encodeURIComponent('您好，我是伙伴 TSP0003 Lim Siew Ling')}`);
    expect(buildPartnerView(demoPartner(), [], [], '').whatsapp).toBe('');
    expect(whatsappLink('', 'x')).toBe('');
  });
});
