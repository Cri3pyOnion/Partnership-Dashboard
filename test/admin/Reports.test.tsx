import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reports } from '../../src/admin/pages/Reports';
import { demoPartner } from '../fixtures/demo';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (p: string) => {
    if (p.startsWith('/api/admin/reports/monthly')) {
      return [
        { partnerId: 'TSP0001', name: 'Alice', company: null, code: 'A1', cases: 2, revenue: 2800, commission: 250 },
        { partnerId: 'TSP0003', name: 'Bob', company: 'Bob & Co', code: 'B1', cases: 1, revenue: 1000, commission: 800 },
      ];
    }
    if (p === '/api/admin/partners/inactive') return [demoPartner({ name: 'Idle Ida', phone: '+60123456789' })];
    throw new Error(`unexpected ${p}`);
  });
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <Reports />
    </MemoryRouter>,
  );

describe('Reports', () => {
  it('asks for the current month and lists each partner', async () => {
    renderPage();
    await screen.findByText('Alice');
    expect(get.mock.calls.some((c) => /^\/api\/admin\/reports\/monthly\?month=\d{4}-\d{2}$/.test(String(c[0])))).toBe(true);
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('keeps B1 amounts apart from the commission total', async () => {
    renderPage();
    await screen.findByText('Alice');
    expect(screen.getByTestId('total-commission').textContent).toBe('RM 250');
    expect(screen.getByTestId('total-b1').textContent).toBe('RM 800');
    expect(screen.getAllByText("应付 Toh's Sign").length).toBeGreaterThan(0);
    expect(screen.getByText("B1 金额为伙伴应付 Toh's Sign 的款项")).toBeTruthy();
  });

  it('lists inactive partners with a WhatsApp link carrying the greeting', async () => {
    renderPage();
    const a = (await screen.findByRole('link', { name: /WhatsApp/ })) as HTMLAnchorElement;
    expect(a.href.startsWith('https://wa.me/60123456789')).toBe(true);
    expect(decodeURIComponent(a.href)).toContain("您好 Idle Ida，好久不见！Toh's Sign 最近有新服务，欢迎随时联系我们。");
    expect(a.rel).toBe('noopener noreferrer');
  });
});
