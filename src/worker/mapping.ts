// All snake_case <-> camelCase mapping for the Supabase tables lives here.
import { DEFAULT_RULES } from '../shared/commission';
import type { StepIndex } from '../shared/status';
import type {
  Case, CaseDocument, Commission, NewCase, NewPartner, Partner, Settings, Staff,
} from '../shared/types';

export type Row = Record<string, any>;

export const DEFAULT_LICENCE_TYPES = ['营业执照', '招牌执照', '清真认证 (JAKIM)', 'SSM 公司注册', '消防证书 (BOMBA)'];
export const DEFAULT_INACTIVE_DAYS = 90;

/** numeric columns arrive as number or string. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const numReq = (v: unknown): number => Number(v);
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

/** Copy only defined keys, renamed through `map` (camel -> snake). */
function toRow(obj: Record<string, unknown>, map: Record<string, string>): Row {
  const out: Row = {};
  for (const [camel, snake] of Object.entries(map)) {
    if (obj[camel] !== undefined) out[snake] = obj[camel];
  }
  return out;
}

const PARTNER_COLS: Record<string, string> = {
  name: 'name', phone: 'phone', email: 'email', tin: 'tin', company: 'company', code: 'code',
  referralName: 'referral_name', filledBy: 'filled_by', source: 'source', bankName: 'bank_name',
  bankAccount: 'bank_account', status: 'status', viewToken: 'view_token', registeredAt: 'registered_at',
  assignedStaff: 'assigned_staff',
};

export const partnerFromRow = (r: Row): Partner => ({
  id: r.id, name: r.name, phone: r.phone, email: r.email, tin: r.tin, company: r.company, code: r.code,
  referralName: r.referral_name, filledBy: r.filled_by, source: r.source, bankName: r.bank_name,
  bankAccount: r.bank_account, status: r.status, viewToken: r.view_token, registeredAt: r.registered_at,
  assignedStaff: r.assigned_staff ?? null,
});
/** Explicit whitelist: only these keys of a create input are ever used (no mass assignment). */
export const pickNewPartner = (i: NewPartner): NewPartner => ({
  name: i.name, phone: i.phone, email: i.email, tin: i.tin, company: i.company, code: i.code,
  referralName: i.referralName, filledBy: i.filledBy, source: i.source, bankName: i.bankName,
  bankAccount: i.bankAccount, assignedStaff: i.assignedStaff ?? null,
});
export const pickNewCase = (i: NewCase): NewCase => ({
  partnerId: i.partnerId, clientName: i.clientName, clientPhone: i.clientPhone, licenceType: i.licenceType,
  council: i.council, missingDocs: i.missingDocs, price: i.price, markup: i.markup, invoiceNo: i.invoiceNo,
  notesInternal: i.notesInternal, handledBy: i.handledBy ?? null,
  ...(i.submittedAt !== undefined ? { submittedAt: i.submittedAt } : {}),
});

/** `id` is never written. */
export const partnerToRow = (p: Partial<Partner>): Row => toRow(p, PARTNER_COLS);

const CASE_COLS: Record<string, string> = {
  partnerId: 'partner_id', clientName: 'client_name', clientPhone: 'client_phone', licenceType: 'licence_type',
  council: 'council', step: 'step', cancelled: 'cancelled', missingDocs: 'missing_docs', submittedAt: 'submitted_at',
  price: 'price', markup: 'markup', invoiceNo: 'invoice_no', clientPaid: 'client_paid',
  clientPaidAt: 'client_paid_at', notesInternal: 'notes_internal', handledBy: 'handled_by',
};

export const caseFromRow = (r: Row): Case => ({
  id: r.id, partnerId: r.partner_id, clientName: r.client_name, clientPhone: r.client_phone,
  licenceType: r.licence_type, council: r.council, step: r.step as StepIndex, cancelled: r.cancelled,
  missingDocs: r.missing_docs, submittedAt: r.submitted_at, price: num(r.price), markup: num(r.markup),
  invoiceNo: r.invoice_no, clientPaid: r.client_paid, clientPaidAt: r.client_paid_at, notesInternal: r.notes_internal,
  handledBy: r.handled_by ?? null,
});
export const caseToRow = (c: Partial<Case> & { submittedAt?: string }): Row => toRow(c, CASE_COLS);

export const commissionFromRow = (r: Row): Commission => ({
  caseId: r.case_id, code: r.code, amount: numReq(r.amount), basis: r.basis, status: r.status,
  paidAt: iso(r.paid_at), paidBy: r.paid_by,
});
export const commissionToRow = (c: Commission): Row => ({
  case_id: c.caseId, code: c.code, amount: c.amount, basis: c.basis, status: c.status,
  paid_at: c.paidAt, paid_by: c.paidBy,
});

export const staffFromRow = (r: Row): Staff => ({
  email: r.email, name: r.name, role: r.role, team: r.team, active: r.active,
});
export const staffToRow = (s: Staff): Row => ({
  email: s.email, name: s.name, role: s.role, team: s.team, active: s.active,
});

export const documentFromRow = (r: Row): CaseDocument => ({
  id: r.id, caseId: r.case_id, storagePath: r.storage_path, filename: r.filename,
  kind: r.kind ?? '', uploadedBy: r.uploaded_by ?? '', uploadedAt: iso(r.uploaded_at)!,
});

export function settingsFromRows(rows: Array<{ key: string; value: unknown }>): Settings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    commissionRules: (byKey.get('commission_rules') as Settings['commissionRules']) ?? structuredClone(DEFAULT_RULES),
    licenceTypes: (byKey.get('licence_types') as string[]) ?? [...DEFAULT_LICENCE_TYPES],
    inactiveDays: Number(byKey.get('inactive_days') ?? DEFAULT_INACTIVE_DAYS),
  };
}
export const settingsToRows = (s: Settings) => [
  { key: 'commission_rules', value: s.commissionRules },
  { key: 'licence_types', value: s.licenceTypes },
  { key: 'inactive_days', value: s.inactiveDays },
];

/** 'YYYY-MM' -> [first day, first day of next month) as 'YYYY-MM-DD'. */
export function monthRange(month: string): [string, string] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`invalid month: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  return [`${month}-01`, next];
}
