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

export interface PartnerView {
  partner: { id: string; name: string; company: string | null; code: PartnerCode };
  tiles: { active: number; done: number; pending: number; paid: number; pendingLabel: string; paidLabel: string };
  cases: PartnerViewCase[];
  months: Array<{ month: string; total: number }>;
  /** Full wa.me link, or '' when no marketing number is configured. */
  whatsapp: string;
}

// One status-based bucket list for every code, so a partner whose code changed keeps old rows counted.
const PENDING: CommissionStatus[] = ['待处理', '可发放', '待付发票'];
const PAID: CommissionStatus[] = ['已支付', '已结清'];

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

export function buildPartnerView(p: Partner, cases: Case[], comms: Commission[], whatsapp: string): PartnerView {
  const b1 = p.code === 'B1';
  const byCase = new Map<string, Commission>();
  for (const cm of comms) byCase.set(cm.caseId, cm);

  const sorted = [...cases].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
  const tiles = {
    active: 0,
    done: 0,
    pending: 0,
    paid: 0,
    pendingLabel: b1 ? "待付给 Toh's Sign" : '待发佣金',
    paidLabel: b1 ? "已与 Toh's Sign 结清" : '已发佣金',
  };
  const monthTotals = new Map<string, number>();

  const viewCases: PartnerViewCase[] = sorted.map((c) => {
    const cm = byCase.get(c.id);
    const amount = cm ? cm.amount : null;
    const status: CommissionStatus = cm ? cm.status : b1 ? '待付发票' : '待处理';

    if (!c.cancelled) {
      if (c.step === 5) tiles.done++;
      else tiles.active++;
    }
    // Money (tiles and monthly totals alike) counts by commission status, cancelled cases included:
    // the Commission row is the source of truth (a cancelled case's row is normally RM 0).
    if (amount !== null && (PENDING.includes(status) || PAID.includes(status))) {
      if (PENDING.includes(status)) tiles.pending = add(tiles.pending, amount);
      else tiles.paid = add(tiles.paid, amount);
      const m = klMonth(c.submittedAt);
      monthTotals.set(m, add(monthTotals.get(m) ?? 0, amount));
    }

    return {
      id: c.id,
      clientName: c.clientName,
      licence: c.council ? `${c.licenceType} (${c.council})` : c.licenceType,
      submittedAt: c.submittedAt,
      step: c.cancelled ? 'cancelled' : c.step,
      missingDocs: c.missingDocs,
      amount,
      // The row's own code decides the label; the partner's current code only for the no-row default.
      amountLabel: amountLabel(cm ? cm.code : p.code),
      commissionStatus: status,
    };
  });

  const months = [...monthTotals.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, total]) => ({ month, total }));

  return {
    partner: { id: p.id, name: p.name, company: p.company, code: p.code },
    tiles,
    cases: viewCases,
    months,
    whatsapp: whatsappLink(whatsapp, `您好，我是伙伴 ${p.id} ${p.name}`),
  };
}
