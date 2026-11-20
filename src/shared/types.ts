import type { StepIndex } from './status';

export type PartnerCode = 'A1' | 'B1' | 'C1';
export type PartnerStatus = '待审核' | '活跃' | '不活跃';
export type Team = 'Transmission' | '市场部' | 'IT';
export type Source = '上门' | '线上';
export type CommissionStatus = '待处理' | '可发放' | '已支付' | '待付发票' | '已结清';

export interface Partner {
  id: string;
  name: string;
  phone: string;
  email: string;
  tin: string | null;
  company: string | null;
  code: PartnerCode;
  referralName: string | null;
  filledBy: Team;
  source: Source | null;
  bankName: string | null;
  bankAccount: string | null;
  status: PartnerStatus;
  viewToken: string | null;
  registeredAt: string;
  /** Email of the responsible staff member, or null when unassigned. */
  assignedStaff: string | null;
}

export interface Case {
  id: string;
  partnerId: string;
  clientName: string;
  clientPhone: string | null;
  licenceType: string;
  council: string | null;
  step: StepIndex;
  cancelled: boolean;
  missingDocs: string | null;
  submittedAt: string;
  price: number | null;
  markup: number | null;
  invoiceNo: string | null;
  clientPaid: boolean;
  clientPaidAt: string | null;
  notesInternal: string | null;
  /** Email of the staff member handling this case, or null when unassigned. */
  handledBy: string | null;
}

export interface CommissionRules {
  A1: { threshold: number; below: number; above: number };
  B1: { partnerPricePercent: number; collectBeforeSubmit: boolean };
  C1: { maxMarkup: number | null };
  paidMarkedBy: 'admin' | 'staff';
}

export interface Commission {
  caseId: string;
  code: PartnerCode;
  amount: number;
  basis: string;
  status: CommissionStatus;
  paidAt: string | null;
  paidBy: string | null;
}

export interface Settings {
  commissionRules: CommissionRules;
  licenceTypes: string[];
  inactiveDays: number;
}

export interface Staff {
  email: string;
  name: string;
  role: 'admin' | 'staff';
  team: Team | null;
  active: boolean;
}

export type NewPartner = Omit<Partner, 'id' | 'status' | 'viewToken' | 'registeredAt' | 'assignedStaff'> & {
  assignedStaff?: string | null;
};

export type NewCase = Omit<Case, 'id' | 'step' | 'cancelled' | 'clientPaid' | 'clientPaidAt' | 'submittedAt' | 'handledBy'> & {
  submittedAt?: string;
  handledBy?: string | null;
};

export interface CaseDocument {
  id: string;
  caseId: string;
  storagePath: string;
  filename: string;
  kind: string;
  uploadedBy: string;
  uploadedAt: string;
}

export type NewDocument = Omit<CaseDocument, 'id' | 'uploadedBy' | 'uploadedAt'>;
