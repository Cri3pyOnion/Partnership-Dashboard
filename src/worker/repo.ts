import type { PartnerStatus } from '../shared/types';
import type { StepIndex } from '../shared/status';
import type {
  Case, CaseDocument, Commission, NewCase, NewDocument, NewPartner, Partner, Settings, Staff,
} from '../shared/types';

/** Any Supabase or network failure. The HTTP layer maps it to 503. Not-found is never a RepoError. */
export class RepoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RepoError';
  }
}

/** Thrown by update methods when the target row does not exist (gets return null instead). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface CaseHistoryRow {
  step: StepIndex;
  changedAt: string;
  changedBy: string | null;
}

export interface Repo {
  getStaff(email: string): Promise<Staff | null>;
  listStaff(): Promise<Staff[]>;
  /** Upsert by email. */
  saveStaff(s: Staff, by: string): Promise<void>;

  /** `q` matches id, name, company or phone, case-insensitively. Ordered by id. */
  listPartners(f: { status?: PartnerStatus; q?: string }): Promise<Partner[]>;
  getPartner(id: string): Promise<Partner | null>;
  getPartnerByToken(token: string): Promise<Partner | null>;
  createPartner(input: NewPartner, by: string): Promise<Partner>;
  updatePartner(id: string, patch: Partial<Partner>, by: string): Promise<Partner>;

  /** `month` is 'YYYY-MM' on submittedAt. Newest first. */
  listCases(f: { partnerId?: string; step?: StepIndex; month?: string }): Promise<Case[]>;
  getCase(id: string): Promise<Case | null>;
  createCase(input: NewCase, by: string): Promise<Case>;
  /** Writes a case_steps_history row only when `step` actually changes. */
  updateCase(id: string, patch: Partial<Case>, by: string): Promise<Case>;
  /** Oldest first. */
  listCaseHistory(caseId: string): Promise<CaseHistoryRow[]>;

  getCommission(caseId: string): Promise<Commission | null>;
  /** `month` is 'YYYY-MM' on the case's submittedAt. */
  listCommissions(f: { partnerId?: string; month?: string }): Promise<Commission[]>;
  /** Upsert on caseId. */
  saveCommission(c: Commission): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings, by: string): Promise<void>;

  logLinkView(partnerId: string, country: string | null): Promise<void>;
  /** Newest first. */
  listLinkViews(partnerId: string, limit: number): Promise<Array<{ viewedAt: string; country: string | null }>>;

  listDocuments(caseId: string): Promise<CaseDocument[]>;
  addDocument(d: NewDocument, by: string): Promise<CaseDocument>;

  /** Routes call this explicitly; the repo never audits on its own. */
  audit(by: string, action: string, entity: string, id: string, details?: object): Promise<void>;
}
