import { describe, expect, it } from 'vitest';
import { isEmail, normalizePhone, normalizeTin } from '../../src/shared/validate';

describe('normalizePhone', () => {
  it('normalizes Malaysian mobile numbers', () => {
    expect(normalizePhone('+60 12-338 4521')).toBe('+60123384521');
    expect(normalizePhone('012-338 4521')).toBe('+60123384521');
  });
  it('rejects landlines', () => {
    expect(normalizePhone('03-1234 5678')).toBeNull();
  });
});

describe('normalizeTin', () => {
  it('uppercases and strips spaces', () => {
    expect(normalizeTin('ig 2301 9844 050')).toBe('IG23019844050');
    expect(normalizeTin('C2584463202')).toBe('C2584463202');
  });
  it('rejects malformed TINs', () => {
    expect(normalizeTin('12345')).toBeNull();
  });
});

describe('isEmail', () => {
  it('validates emails', () => {
    expect(isEmail('weiming@twmaccounting.my')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
  });
});
