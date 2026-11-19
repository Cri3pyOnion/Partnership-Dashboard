import { describe, expect, it } from 'vitest';
import { formatCaseId, formatPartnerId } from '../../src/shared/ids';
import { rm } from '../../src/shared/money';

describe('ids', () => {
  it('formats partner ids', () => {
    expect(formatPartnerId(1)).toBe('TSP0001');
    expect(formatPartnerId(123)).toBe('TSP0123');
  });
  it('formats case ids using Kuala Lumpur year and month', () => {
    expect(formatCaseId(new Date('2026-11-03T02:00:00Z'), 14)).toBe('TS-2611-014');
    expect(formatCaseId(new Date('2026-11-30T16:30:00Z'), 1)).toBe('TS-2612-001'); // 00:30 MYT on 1 Dec
  });
});

describe('rm', () => {
  it('formats money', () => {
    expect(rm(1800)).toBe('RM 1,800');
    expect(rm(1440.5)).toBe('RM 1,440.50');
  });
});
