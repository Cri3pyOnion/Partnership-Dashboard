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

/** Repeat views of one partner from one country inside this window are not stored. */
export const VIEW_LOG_WINDOW_MINUTES = 30;
/** Only this many views are kept per partner (the newest). */
export const MAX_VIEWS_PER_PARTNER = 100;

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
  listPartners(f: { status?: PartnerStatus; q?: string; assignedStaff?: string }): Promise<Partner[]>;
  getPartner(id: string): Promise<Partner | null>;
  getPartnerByToken(token: string): Promise<Partner | null>;
  createPartner(input: NewPartner, by: string): Promise<Partner>;
  updatePartner(id: string, patch: Partial<Partner>, by: string): Promise<Partner>;

  /** `month` is 'YYYY-MM' on submittedAt. Newest first. */
  listCases(f: { partnerId?: string; step?: StepIndex; month?: string; handledBy?: string }): Promise<Case[]>;
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

  /**
   * Records a partner page view, at most once per partner and country every
   * VIEW_LOG_WINDOW_MINUTES, keeping the newest MAX_VIEWS_PER_PARTNER rows. True when a row was added.
   */
  logLinkView(partnerId: string, country: string | null): Promise<boolean>;
  /** Newest first. */
  listLinkViews(partnerId: string, limit: number): Promise<Array<{ viewedAt: string; country: string | null }>>;

  listDocuments(caseId: string): Promise<CaseDocument[]>;
  getDocument(id: string): Promise<CaseDocument | null>;
  addDocument(d: NewDocument, by: string): Promise<CaseDocument>;

  /** Routes call this explicitly; the repo never audits on its own. */
  audit(by: string, action: string, entity: string, id: string, details?: object): Promise<void>;
}
