// The partner view model. This is the ONLY place that chooses which partner data reaches
// the public /p/:token page. Every field is copied by name; objects are never spread.
import type { StepIndex } from '../shared/status';
import { whatsappLink } from '../shared/whatsapp';
import type { Case, Commission, CommissionStatus, Partner, PartnerCode } from '../shared/types';

export { whatsappLink };

export interface PartnerViewCase {
  id: string;
  clientName: string;
  licence: string;
  submittedAt: string;
  step: StepIndex | 'cancelled';
  missingDocs: string | null;
  /** null when the case has no Commission row yet. */
  amount: number | null;
  amountLabel: string;
  commissionStatus: CommissionStatus;
}

/** Money that flows to the partner (A1/C1 commission) or from the partner to Toh's Sign (B1). Never mixed. */
export type MoneyKind = 'commission' | 'b1';

export interface MoneyTiles {
  kind: MoneyKind;
  pending: number;
  paid: number;
  pendingLabel: string;
  paidLabel: string;
}

export interface PartnerView {
  partner: { id: string; name: string; company: string | null; code: PartnerCode };
  /** `money` has one pair per kind that has rows (the partner's own code first), or the partner code's pair when none. */
  /**
   * `total` counts every case referred, dropped ones included. `pipelineRate` is the share not
   * dropped, (total − dropped) ÷ total, as a percentage with one decimal; null when there are no cases.
   */
  tiles: { total: number; active: number; done: number; dropped: number; pipelineRate: number | null; money: MoneyTiles[] };
  cases: PartnerViewCase[];
  /** Per month, each kind summed apart. */
  months: Array<{ month: string; commission: number; b1: number }>;
  /** The kinds the monthly table shows: one column each. */
  monthKinds: MoneyKind[];
  /** Full wa.me link, or '' when no marketing number is configured. */
  whatsapp: string;
}

const PENDING: CommissionStatus[] = ['待处理', '可发放', '待付发票'];

const kindOf = (code: PartnerCode): MoneyKind => (code === 'B1' ? 'b1' : 'commission');

const LABELS: Record<MoneyKind, { pendingLabel: string; paidLabel: string }> = {
  commission: { pendingLabel: '待发佣金', paidLabel: '已发佣金' },
  b1: { pendingLabel: "待付给 Toh's Sign", paidLabel: "已与 Toh's Sign 结清" },
};

const amountLabel = (code: PartnerCode): string => (code === 'B1' ? "应付 Toh's Sign" : '你的佣金');

/** 'YYYY-MM' of a date or timestamp, in Asia/Kuala_Lumpur. */
function klMonth(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' })
    .format(new Date(s))
    .slice(0, 7);
}

/** Avoid float drift when summing RM amounts with cents. */
const add = (a: number, b: number): number => Math.round((a + b) * 100) / 100;

/**
 * `comms` should hold a row for every case: the caller previews missing rows (view-cache build).
 * A case with no row at all shows no amount and counts nowhere.
 */
export function buildPartnerView(p: Partner, cases: Case[], comms: Commission[], whatsapp: string): PartnerView {
  const byCase = new Map<string, Commission>();
  for (const cm of comms) byCase.set(cm.caseId, cm);

  const sorted = [...cases].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
  let active = 0;
  let done = 0;
  let dropped = 0;
  const buckets = new Map<MoneyKind, { pending: number; paid: number }>();
  const monthTotals = new Map<string, { commission: number; b1: number }>();

  const viewCases: PartnerViewCase[] = sorted.map((c) => {
    const cm = byCase.get(c.id);
    // The row's own code decides its bucket and label; the partner's current code only when there is no row.
    const code = cm ? cm.code : p.code;
    const amount = cm ? cm.amount : null;
    const status: CommissionStatus = cm ? cm.status : code === 'B1' ? '待付发票' : '待处理';

    if (c.cancelled) dropped++;
    else if (c.step === 5) done++;
    else active++;
    // Money (tiles and monthly totals alike) counts by commission status, cancelled cases included:
    // the Commission row is the source of truth (a cancelled case's row is normally RM 0).
    if (cm) {
      const kind = kindOf(cm.code);
      const b = buckets.get(kind) ?? { pending: 0, paid: 0 };
      if (PENDING.includes(cm.status)) b.pending = add(b.pending, cm.amount);
      else b.paid = add(b.paid, cm.amount);
      buckets.set(kind, b);
      const m = klMonth(c.submittedAt);
      const t = monthTotals.get(m) ?? { commission: 0, b1: 0 };
      t[kind] = add(t[kind], cm.amount);
      monthTotals.set(m, t);
    }

    return {
      id: c.id,
      clientName: c.clientName,
      licence: c.council ? `${c.licenceType} (${c.council})` : c.licenceType,
      submittedAt: c.submittedAt,
      step: c.cancelled ? 'cancelled' : c.step,
      missingDocs: c.missingDocs,
      amount,
      amountLabel: amountLabel(code),
      commissionStatus: status,
    };
  });

  const own = kindOf(p.code);
  const kinds: MoneyKind[] = [own, own === 'b1' ? 'commission' : 'b1'];
  let shown = kinds.filter((k) => buckets.has(k));
  if (shown.length === 0) shown = [own];
  const money = shown.map((kind) => ({ kind, ...(buckets.get(kind) ?? { pending: 0, paid: 0 }), ...LABELS[kind] }));

  const months = [...monthTotals.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, t]) => ({ month, commission: t.commission, b1: t.b1 }));
  const monthKinds = (['commission', 'b1'] as const).filter((k) => buckets.has(k));

  return {
    partner: { id: p.id, name: p.name, company: p.company, code: p.code },
    tiles: {
      total: viewCases.length, active, done, dropped,
      pipelineRate: viewCases.length ? Math.round(((viewCases.length - dropped) / viewCases.length) * 1000) / 10 : null,
      money,
    },
    cases: viewCases,
    months,
    monthKinds: monthKinds.length ? [...monthKinds] : [own],
    whatsapp: whatsappLink(whatsapp, `您好，我是伙伴 ${p.id} ${p.name}`),
  };
}
