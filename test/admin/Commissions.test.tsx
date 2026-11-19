import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Commissions } from '../../src/admin/pages/Commissions';
import { demoPartner } from '../fixtures/demo';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;

const row = (caseId: string, over: Record<string, unknown> = {}) => ({
  caseId, clientName: `客户 ${caseId}`, partnerId: 'TSP0003', code: 'C1', amount: 300, basis: '加价', status: '可发放', paidAt: null, paidBy: null, ...over,
});

let rows: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [
    row('TS-2611-014'),
    row('TS-2611-015', { amount: 100, status: '待处理', pending: true }),
    row('TS-2611-016', { code: 'B1', amount: 1440, status: '待付发票' }),
    row('TS-2611-017', { amount: 200, status: '已支付', paidAt: '2026-11-18T02:00:00Z', paidBy: 'a@x.my' }),
  ];
  get.mockImplementation(async (p: string) => (p.startsWith('/api/admin/partners') ? [demoPartner()] : rows));
});
afterEach(() => vi.restoreAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter>
      <Commissions />
    </MemoryRouter>,
  );

describe('Commissions', () => {
  it('lists the month with totals by status', async () => {
    renderPage();
    await screen.findByText('TS-2611-014');
    const totals = screen.getByRole('group', { name: '按状态合计' });
    expect(within(totals).getByText('可发放').parentElement?.textContent).toContain('RM 300');
    expect(within(totals).getByText('已支付').parentElement?.textContent).toContain('RM 200');
    expect(within(totals).getByText(/待付发票/).parentElement?.textContent).toContain('RM 1,440');
    expect(within(totals).getByText(/待付发票/).parentElement?.textContent).toContain("应付 Toh's Sign");
  });

  it('marks a pending row 佣金待计算 and labels B1 as owed', async () => {
    renderPage();
    await screen.findByText('TS-2611-015');
    expect(screen.getByText('佣金待计算')).toBeTruthy();
    expect(screen.getAllByText("应付 Toh's Sign").length).toBeGreaterThan(0);
  });

  it('offers 标记已支付 only for 可发放 rows', async () => {
    renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.getAllByRole('button', { name: '标记已支付' })).toHaveLength(1);
  });

  it('does nothing when the confirm is cancelled', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await user.click(await screen.findByRole('button', { name: '标记已支付' }));
    expect(confirm).toHaveBeenCalledWith('确认标记为已支付？此操作不可撤销。');
    expect(post).not.toHaveBeenCalled();
  });

  it('marks paid once confirmed and reloads', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    post.mockResolvedValue({});
    renderPage();
    await user.click(await screen.findByRole('button', { name: '标记已支付' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/commissions/TS-2611-014/mark-paid'));
    await waitFor(() => expect(get.mock.calls.filter((c) => String(c[0]).startsWith('/api/admin/commissions')).length).toBe(2));
  });

  it('shows a 403 from mark-paid', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    post.mockRejectedValue(Object.assign(new Error('x'), { status: 403, error: '没有权限' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: '标记已支付' }));
    expect((await screen.findByRole('alert')).textContent).toContain('没有权限');
  });

  it('passes the month and partner filters to the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('TS-2611-014');
    await user.selectOptions(screen.getByLabelText('伙伴'), 'TSP0003');
    await waitFor(() => expect(get.mock.calls.some((c) => /^\/api\/admin\/commissions\?month=\d{4}-\d{2}&partnerId=TSP0003$/.test(String(c[0])))).toBe(true));
  });
});
