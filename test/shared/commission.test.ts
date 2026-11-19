import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  ValidationError,
  applyCommission,
  calcCommission,
} from '../../src/shared/commission';
import type { Commission } from '../../src/shared/types';

const paid = { clientPaid: true, cancelled: false, markup: null as number | null };

describe('calcCommission', () => {
  it('A1 fixed fee above threshold', () => {
    expect(calcCommission({ ...paid, price: 1800 }, 'A1', DEFAULT_RULES)).toEqual({
      amount: 150,
      basis: '固定推荐费 (A1)',
      status: '可发放',
    });
  });
  it('A1 pending when client unpaid', () => {
    expect(calcCommission({ ...paid, price: 900, clientPaid: false }, 'A1', DEFAULT_RULES).status).toBe('待处理');
  });
  it('A1 below and at threshold', () => {
    expect(calcCommission({ ...paid, price: 900 }, 'A1', DEFAULT_RULES).amount).toBe(100);
    expect(calcCommission({ ...paid, price: 1500 }, 'A1', DEFAULT_RULES).amount).toBe(150);
  });
  it('C1 markup', () => {
    expect(calcCommission({ ...paid, price: 1800, markup: 300 }, 'C1', DEFAULT_RULES)).toEqual({
      amount: 300,
      basis: '在 RM 1,800 上加价（客户支付 RM 2,100）',
      status: '可发放',
    });
  });
  it('C1 null markup gives 0', () => {
    expect(calcCommission({ ...paid, price: 1800 }, 'C1', DEFAULT_RULES).amount).toBe(0);
  });
  it('C1 markup over cap throws ValidationError', () => {
    const rules = { ...DEFAULT_RULES, C1: { maxMarkup: 500 } };
    expect(() => calcCommission({ ...paid, price: 1800, markup: 600 }, 'C1', rules)).toThrow('加价超过上限');
    expect(() => calcCommission({ ...paid, price: 1800, markup: 600 }, 'C1', rules)).toThrow(ValidationError);
  });
  it('B1 partner price', () => {
    expect(calcCommission({ ...paid, price: 1800 }, 'B1', DEFAULT_RULES)).toEqual({
      amount: 1440,
      basis: '伙伴价 = RM 1,800 的 80%',
      status: '已结清',
    });
    expect(calcCommission({ ...paid, price: 1800, clientPaid: false }, 'B1', DEFAULT_RULES).status).toBe('待付发票');
  });
  it('B1 rounds to 2 decimals', () => {
    const rules = { ...DEFAULT_RULES, B1: { partnerPricePercent: 33.333, collectBeforeSubmit: false } };
    expect(calcCommission({ ...paid, price: 100 }, 'B1', rules).amount).toBe(33.33);
  });
  it('cancelled gives zero', () => {
    expect(calcCommission({ ...paid, price: 1800, cancelled: true }, 'A1', DEFAULT_RULES)).toEqual({
      amount: 0,
      basis: '案件已取消',
      status: '待处理',
    });
    expect(calcCommission({ ...paid, price: 1800, cancelled: true }, 'B1', DEFAULT_RULES).status).toBe('待付发票');
  });
});

describe('applyCommission', () => {
  const next = { amount: 100, basis: 'x', status: '可发放' as const };
  it('keeps a paid commission frozen', () => {
    const done: Commission = {
      caseId: 'TS-2609-012',
      code: 'A1',
      amount: 150,
      basis: '固定推荐费 (A1)',
      status: '已支付',
      paidAt: '2026-09-30T00:00:00Z',
      paidBy: 'admin',
    };
    expect(applyCommission('TS-2609-012', done, next, 'C1')).toEqual(done);
  });
  it('keeps the existing code when not paid', () => {
    const open: Commission = {
      caseId: 'TS-2609-013', code: 'A1', amount: 100, basis: 'old', status: '待处理', paidAt: null, paidBy: null,
    };
    expect(applyCommission('TS-2609-013', open, next, 'C1')).toEqual({
      caseId: 'TS-2609-013', code: 'A1', amount: 100, basis: 'x', status: '可发放', paidAt: null, paidBy: null,
    });
  });
  it('creates new commission with given code', () => {
    expect(applyCommission('TS-2609-014', null, next, 'C1').code).toBe('C1');
  });
});
