import { DEFAULT_RULES } from '../src/shared/commission';
import { formatCaseId, formatPartnerId } from '../src/shared/ids';
import { monthRange } from '../src/worker/mapping';
import { DEFAULT_INACTIVE_DAYS, DEFAULT_LICENCE_TYPES } from '../src/worker/mapping';
import { NotFoundError, RepoError } from '../src/worker/repo';
import type { CaseHistoryRow, Repo } from '../src/worker/repo';
import type { StepIndex } from '../src/shared/status';
import type {
  Case, CaseDocument, Commission, NewCase, NewDocument, NewPartner, Partner, PartnerStatus, Settings, Staff,
} from '../src/shared/types';

const clone = <T>(v: T): T => structuredClone(v);

/** 'YYYY-MM-DD' in Asia/Kuala_Lumpur. */
const klDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export interface AuditEntry {
  by: string;
  action: string;
  entity: string;
  id: string;
  details?: object;
  at: string;
}

/** In-memory Repo for tests. Mirrors SupabaseRepo semantics. */
export class FakeRepo implements Repo {
  private now: () => Date;
  private partners = new Map<string, Partner>();
  private cases = new Map<string, Case>();
  private history = new Map<string, CaseHistoryRow[]>();
  private commissions = new Map<string, Commission>();
  private staff = new Map<string, Staff>();
  private docs: CaseDocument[] = [];
  private views: Array<{ partnerId: string; viewedAt: string; country: string | null }> = [];
  private caseCounters = new Map<string, number>();
  private partnerSeq = 0;
  private docSeq = 0;
  private failure: Error | null = null;
  private settings: Settings = {
    commissionRules: clone(DEFAULT_RULES),
    licenceTypes: [...DEFAULT_LICENCE_TYPES],
    inactiveDays: DEFAULT_INACTIVE_DAYS,
  };
  /** Audit rows, for route tests to inspect. */
  readonly auditLog: AuditEntry[] = [];

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Makes the next repo call reject with a RepoError. */
  failNext(err?: Error): void {
    this.failure = err ?? new Error('injected failure');
  }

  private gate(): void {
    if (!this.failure) return;
    const f = this.failure;
    this.failure = null;
    throw f instanceof RepoError ? f : new RepoError(f.message, { cause: f });
  }

  async getStaff(email: string) {
    this.gate();
    const s = this.staff.get(email);
    return s ? clone(s) : null;
  }
  async listStaff() {
    this.gate();
    return [...this.staff.values()].sort((a, b) => a.email.localeCompare(b.email)).map(clone);
  }
  async saveStaff(s: Staff, _by: string) {
    this.gate();
    this.staff.set(s.email, clone(s));
  }

  async listPartners(f: { status?: PartnerStatus; q?: string }) {
    this.gate();
    const q = f.q?.trim().toLowerCase();
    return [...this.partners.values()]
      .filter((p) => !f.status || p.status === f.status)
      .filter((p) => !q || [p.id, p.name, p.company, p.phone].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(clone);
  }
  async getPartner(id: string) {
    this.gate();
    const p = this.partners.get(id);
    return p ? clone(p) : null;
  }
  async getPartnerByToken(token: string) {
    this.gate();
    for (const p of this.partners.values()) if (p.viewToken !== null && p.viewToken === token) return clone(p);
    return null;
  }
  async createPartner(input: NewPartner, _by: string) {
    this.gate();
    const p: Partner = {
      ...clone(input),
      id: formatPartnerId(++this.partnerSeq),
      status: '待审核',
      viewToken: null,
      registeredAt: klDate(this.now()),
    };
    this.partners.set(p.id, p);
    return clone(p);
  }
  async updatePartner(id: string, patch: Partial<Partner>, _by: string) {
    this.gate();
    const cur = this.partners.get(id);
    if (!cur) throw new NotFoundError(`partner ${id} not found`);
    const { id: _ignored, ...rest } = patch;
    const next = { ...cur, ...definedOnly(rest) };
    this.partners.set(id, next);
    return clone(next);
  }

  async listCases(f: { partnerId?: string; step?: StepIndex; month?: string }) {
    this.gate();
    const range = f.month ? monthRange(f.month) : null;
    return [...this.cases.values()]
      .filter((c) => !f.partnerId || c.partnerId === f.partnerId)
      .filter((c) => f.step === undefined || c.step === f.step)
      .filter((c) => !range || (c.submittedAt >= range[0] && c.submittedAt < range[1]))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id))
      .map(clone);
  }
  async getCase(id: string) {
    this.gate();
    const c = this.cases.get(id);
    return c ? clone(c) : null;
  }
  async createCase(input: NewCase, _by: string) {
    this.gate();
    if (!this.partners.has(input.partnerId)) throw new RepoError(`unknown partner ${input.partnerId}`);
    const at = this.now();
    const key = formatCaseId(at, 0).slice(3, 7); // YYMM in Kuala Lumpur
    const n = (this.caseCounters.get(key) ?? 0) + 1;
    this.caseCounters.set(key, n);
    const { submittedAt, ...rest } = clone(input);
    const c: Case = {
      ...rest,
      id: formatCaseId(at, n),
      step: 0,
      cancelled: false,
      clientPaid: false,
      clientPaidAt: null,
      submittedAt: submittedAt ?? klDate(at),
    };
    this.cases.set(c.id, c);
    return clone(c);
  }
  async updateCase(id: string, patch: Partial<Case>, by: string) {
    this.gate();
    const cur = this.cases.get(id);
    if (!cur) throw new NotFoundError(`case ${id} not found`);
    const { id: _ignored, ...rest } = patch;
    const next = { ...cur, ...definedOnly(rest) };
    this.cases.set(id, next);
    if (next.step !== cur.step) {
      const rows = this.history.get(id) ?? [];
      rows.push({ step: next.step, changedAt: this.now().toISOString(), changedBy: by });
      this.history.set(id, rows);
    }
    return clone(next);
  }
  async listCaseHistory(caseId: string) {
    this.gate();
    return clone(this.history.get(caseId) ?? []);
  }

  async getCommission(caseId: string) {
    this.gate();
    const c = this.commissions.get(caseId);
    return c ? clone(c) : null;
  }
  async listCommissions(f: { partnerId?: string; month?: string }) {
    this.gate();
    const range = f.month ? monthRange(f.month) : null;
    return [...this.commissions.values()]
      .filter((cm) => {
        const c = this.cases.get(cm.caseId);
        if (!c) return false;
        if (f.partnerId && c.partnerId !== f.partnerId) return false;
        return !range || (c.submittedAt >= range[0] && c.submittedAt < range[1]);
      })
      .sort((a, b) => a.caseId.localeCompare(b.caseId))
      .map(clone);
  }
  async saveCommission(c: Commission) {
    this.gate();
    if (!this.cases.has(c.caseId)) throw new RepoError(`unknown case ${c.caseId}`);
    this.commissions.set(c.caseId, clone(c));
  }

  async getSettings() {
    this.gate();
    return clone(this.settings);
  }
  async saveSettings(s: Settings, _by: string) {
    this.gate();
    this.settings = clone(s);
  }

  async logLinkView(partnerId: string, country: string | null) {
    this.gate();
    if (!this.partners.has(partnerId)) throw new RepoError(`unknown partner ${partnerId}`);
    this.views.push({ partnerId, viewedAt: this.now().toISOString(), country });
  }
  async listLinkViews(partnerId: string, limit: number) {
    this.gate();
    return this.views
      .filter((v) => v.partnerId === partnerId)
      .reverse() // insertion order breaks timestamp ties, newest first
      .sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))
      .slice(0, limit)
      .map((v) => ({ viewedAt: v.viewedAt, country: v.country }));
  }

  async listDocuments(caseId: string) {
    this.gate();
    return this.docs.filter((d) => d.caseId === caseId).map(clone);
  }
  async addDocument(d: NewDocument, by: string) {
    this.gate();
    if (!this.cases.has(d.caseId)) throw new RepoError(`unknown case ${d.caseId}`);
    const doc: CaseDocument = {
      ...clone(d),
      id: `00000000-0000-4000-8000-${String(++this.docSeq).padStart(12, '0')}`,
      uploadedBy: by,
      uploadedAt: this.now().toISOString(),
    };
    this.docs.push(doc);
    return clone(doc);
  }

  async audit(by: string, action: string, entity: string, id: string, details?: object) {
    this.gate();
    this.auditLog.push({ by, action, entity, id, details: details && clone(details), at: this.now().toISOString() });
  }
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
