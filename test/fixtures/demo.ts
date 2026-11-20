// Demo data mirroring supabase/seed.sql (partner TSP0003 and its 5 cases).
import { DEFAULT_RULES, calcCommission } from '../../src/shared/commission';
import type { Case, Commission, Partner } from '../../src/shared/types';

export const DEMO_BANK_ACCOUNT = '5123-4567-8901';

export const demoPartner = (over: Partial<Partner> = {}): Partner => ({
  id: 'TSP0003',
  name: 'Lim Siew Ling',
  phone: '+60162458830',
  email: 'siewling@limco.my',
  tin: 'C2584463202',
  company: 'Lim & Co. Accounting',
  code: 'C1',
  referralName: null,
  filledBy: '市场部',
  source: '线上',
  bankName: 'Maybank',
  bankAccount: DEMO_BANK_ACCOUNT,
  status: '活跃',
  viewToken: null,
  registeredAt: '2026-08-30',
  ...over,
});

const base = {
  partnerId: 'TSP0003',
  clientPhone: '+60198887777',
  cancelled: false,
  invoiceNo: null,
  notesInternal: 'internal: client was rude on the phone',
};

export const demoCases = (): Case[] => [
  { ...base, id: 'TS-2611-014', clientName: 'Kedai Kopi Ah Seng', licenceType: '营业执照', council: 'MBPJ', step: 2, missingDocs: null, submittedAt: '2026-11-03', price: 1800, markup: 300, clientPaid: false, clientPaidAt: null },
  { ...base, id: 'TS-2611-009', clientName: 'Glow Beauty Studio', licenceType: '招牌执照', council: 'DBKL', step: 1, missingDocs: '缺少：租约', submittedAt: '2026-10-28', price: 900, markup: 150, clientPaid: false, clientPaidAt: null },
  { ...base, id: 'TS-2610-031', clientName: 'Nasi Lemak Corner Sdn Bhd', licenceType: '清真认证 (JAKIM)', council: null, step: 3, missingDocs: null, submittedAt: '2026-10-15', price: 2500, markup: 400, clientPaid: false, clientPaidAt: null },
  { ...base, id: 'TS-2610-020', clientName: 'Bright Tuition Centre', licenceType: '营业执照', council: 'MBSJ', step: 4, missingDocs: null, submittedAt: '2026-10-02', price: 1500, markup: 250, clientPaid: true, clientPaidAt: '2026-10-25T02:00:00.000Z' },
  { ...base, id: 'TS-2609-012', clientName: 'Mega Hardware Trading', licenceType: '招牌执照', council: 'MBPJ', step: 5, missingDocs: null, submittedAt: '2026-09-10', price: 850, markup: 150, clientPaid: true, clientPaidAt: '2026-09-28T02:00:00.000Z' },
];

/** One Commission per case, computed with the default rules. */
export const demoCommissions = (cases: Case[], code: Partner['code'] = 'C1'): Commission[] =>
  cases.map((c) => {
    const r = calcCommission(c, code, DEFAULT_RULES);
    return { caseId: c.id, code, amount: r.amount, basis: r.basis, status: r.status, paidAt: null, paidBy: null };
  });
