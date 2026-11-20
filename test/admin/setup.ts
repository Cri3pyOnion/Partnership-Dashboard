import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

/** The staff directory every screen test sees (the per-file api mocks answer every path alike). */
export const TEST_STAFF = [
  { email: 'ann@tohsign.com', name: 'Ann' },
  { email: 'ben@tohsign.com', name: 'Ben' },
];

vi.mock('../../src/admin/staff-directory', async (orig) => {
  const real = await orig<typeof import('../../src/admin/staff-directory')>();
  return { ...real, useStaffDirectory: () => TEST_STAFF };
});

// Screens are tested in Chinese, the source language, whatever the test machine's language is.
localStorage.setItem('lang', 'zh');
