import { rm } from './money';
import type { Case, Commission, CommissionRules, CommissionStatus, PartnerCode } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const DEFAULT_RULES: CommissionRules = {
  A1: { threshold: 1500, below: 100, above: 150 },
  B1: { partnerPricePercent: 80, collectBeforeSubmit: false },
  C1: { maxMarkup: null },
  paidMarkedBy: 'admin',
};

export interface CommissionCalc {
  amount: number;
  basis: string;
  status: CommissionStatus;
}

export function calcCommission(
  c: Pick<Case, 'price' | 'markup' | 'clientPaid' | 'cancelled'>,
  code: PartnerCode,
  rules: CommissionRules,
): CommissionCalc {
  if (c.cancelled) {
    return { amount: 0, basis: '案件已取消', status: code === 'B1' ? '待付发票' : '待处理' };
  }
  const price = c.price ?? 0;
  if (code === 'A1') {
    const { threshold, below, above } = rules.A1;
    return {
      amount: price >= threshold ? above : below,
      basis: '固定推荐费 (A1)',
      status: c.clientPaid ? '可发放' : '待处理',
    };
  }
  if (code === 'C1') {
    const markup = c.markup ?? 0;
    const max = rules.C1.maxMarkup;
    if (max !== null && markup > max) throw new ValidationError('加价超过上限');
    return {
      amount: markup,
      basis: `在 ${rm(price)} 上加价（客户支付 ${rm(price + markup)}）`,
      status: c.clientPaid ? '可发放' : '待处理',
    };
  }
  const pct = rules.B1.partnerPricePercent;
  return {
    amount: Math.round(price * pct) / 100,
    basis: `伙伴价 = ${rm(price)} 的 ${pct}%`,
    status: c.clientPaid ? '已结清' : '待付发票',
  };
}

export function applyCommission(
  caseId: string,
  existing: Commission | null,
  next: CommissionCalc,
  code: PartnerCode,
): Commission {
  if (existing?.status === '已支付') return existing;
  return {
    caseId,
    code: existing?.code ?? code,
    amount: next.amount,
    basis: next.basis,
    status: next.status,
    paidAt: null,
    paidBy: null,
  };
}
