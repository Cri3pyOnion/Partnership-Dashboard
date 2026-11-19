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
  tin: string;
  company: string;
  code: PartnerCode;
  referralName: string;
  filledBy: Team;
  source: Source;
  bankName: string;
  bankAccount: string;
  status: PartnerStatus;
  viewToken: string;
  registeredAt: string;
}

export interface Case {
  id: string;
  partnerId: string;
  clientName: string;
  clientPhone: string;
  licenceType: string;
  council: string;
  step: StepIndex;
  cancelled: boolean;
  missingDocs: string;
  submittedAt: string;
  price: number | null;
  markup: number | null;
  invoiceNo: string;
  clientPaid: boolean;
  clientPaidAt: string | null;
  notesInternal: string;
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
}

export interface Staff {
  id: string;
  email: string;
  name: string;
  team: Team;
}
