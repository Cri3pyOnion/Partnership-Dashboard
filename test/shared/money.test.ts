import { describe, expect, it } from 'vitest';
import { rm } from '../../src/shared/money';

describe('rm', () => {
  it('formats money', () => {
    expect(rm(1800)).toBe('RM 1,800');
    expect(rm(1440.5)).toBe('RM 1,440.50');
  });
});
