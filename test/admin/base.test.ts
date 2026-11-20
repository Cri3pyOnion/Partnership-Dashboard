import { describe, expect, it } from 'vitest';
import { correctedUrl, currentBase, homeFor } from '../../src/admin/base';

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('admin and staff addresses', () => {
  it('admins live at /admin, staff at /dashboard', () => {
    expect(homeFor('admin')).toBe('/admin');
    expect(homeFor('staff')).toBe('/dashboard');
  });

  it('reads the router base from the path', () => {
    expect(currentBase('/admin/partners')).toBe('/admin');
    expect(currentBase('/admin')).toBe('/admin');
    expect(currentBase('/dashboard/cases')).toBe('/dashboard');
    expect(currentBase('/administrator')).toBe('/dashboard');
  });

  it('leaves people already in the right place alone', () => {
    expect(correctedUrl('admin', at('/admin/partners'))).toBeNull();
    expect(correctedUrl('staff', at('/dashboard/'))).toBeNull();
  });

  it('moves staff off /admin and admins off /dashboard, keeping the page', () => {
    expect(correctedUrl('staff', at('/admin/partners/TSP0001', '?tab=cases', '#x'))).toBe('/dashboard/partners/TSP0001?tab=cases#x');
    expect(correctedUrl('admin', at('/dashboard'))).toBe('/admin/');
    expect(correctedUrl('admin', at('/dashboard/cases'))).toBe('/admin/cases');
  });

  it('ignores paths outside both addresses', () => {
    expect(correctedUrl('admin', at('/'))).toBeNull();
  });
});
