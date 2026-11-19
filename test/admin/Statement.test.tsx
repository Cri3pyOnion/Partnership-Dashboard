import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Statement } from '../../src/admin/pages/Statement';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;

const line = (caseId: string, amount: number, over: Record<string, unknown> = {}) => ({
  caseId, clientName: `客户 ${caseId}`, licence: '营业执照', submittedAt: '2026-11-03', amount, code: 'C1', basis: '加价', status: '待处理', cancelled: false, ...over,
});

const totals = (over: Record<string, number> = {}) => ({ commissionPaid: 0, commissionPending: 0, b1Settled: 0, b1Owed: 0, ...over });

function statement(over: Record<string, unknown> = {}) {
  return {
    partner: { id: 'TSP0003', name: 'Lim Siew Ling', company: 'Lim & Co. <Accounting>', code: 'C1' },
    month: '2026-11',
    lines: [line('TS-2611-014', 300), line('TS-2611-016', 150.5)],
    totals: totals({ commissionPending: 450.5 }),
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/statements/TSP0003/2026-11']}>
      <Routes>
        <Route path="/statements/:partnerId/:month" element={<Statement />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Statement', () => {
  it('requests the statement for the partner and month', async () => {
    get.mockResolvedValue(statement());
    renderPage();
    await screen.findByText('Lim Siew Ling');
    expect(get).toHaveBeenCalledWith('/api/admin/statements/TSP0003/2026-11');
  });

  it('renders the partner and company as literal text', async () => {
    get.mockResolvedValue(statement());
    const { container } = renderPage();
    expect(await screen.findByText('Lim & Co. <Accounting>')).toBeTruthy();
    expect(container.querySelector('accounting')).toBeNull();
    expect(screen.getByText(/TSP0003/)).toBeTruthy();
    expect(screen.getByText(/月份 2026-11/)).toBeTruthy();
    expect(screen.getByText(/C1/)).toBeTruthy();
  });

  it('shows every case line and the totals from the API', async () => {
    get.mockResolvedValue(statement());
    renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.getByText('TS-2611-016')).toBeTruthy();
    expect(screen.getByText('RM 300')).toBeTruthy();
    expect(screen.getByText('RM 150.50')).toBeTruthy();
    expect(screen.getByTestId('total-commission-pending').textContent).toBe('RM 450.50');
    expect(screen.getByTestId('total-commission-paid').textContent).toBe('RM 0');
  });

  it('has a 状态 column, shows 已取消 for cancelled lines, and totals paid apart from pending', async () => {
    get.mockResolvedValue(
      statement({
        lines: [
          line('TS-2611-014', 300, { status: '已支付' }),
          line('TS-2611-016', 150, { status: '可发放' }),
          line('TS-2611-017', 0, { status: '待处理', cancelled: true }),
        ],
        totals: totals({ commissionPaid: 300, commissionPending: 150 }),
      }),
    );
    renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.getByRole('columnheader', { name: '状态' })).toBeTruthy();
    expect(within(screen.getByText('TS-2611-014').closest('tr') as HTMLElement).getByText('已支付')).toBeTruthy();
    expect(within(screen.getByText('TS-2611-016').closest('tr') as HTMLElement).getByText('可发放')).toBeTruthy();
    const cx = screen.getByText('TS-2611-017').closest('tr') as HTMLElement;
    expect(within(cx).getByText(/已取消/)).toBeTruthy();
    expect(screen.getByTestId('total-commission-paid').textContent).toBe('RM 300');
    expect(screen.getByTestId('total-commission-pending').textContent).toBe('RM 150');
    expect(screen.getByText(/已支付 Paid/)).toBeTruthy();
    expect(screen.getByText(/待发 Pending/)).toBeTruthy();
  });

  it('marks a pending line as 佣金待计算', async () => {
    get.mockResolvedValue(statement({ lines: [line('TS-2611-014', 300, { pending: true })], totals: totals({ commissionPending: 300 }) }));
    renderPage();
    expect(await screen.findByText('佣金待计算')).toBeTruthy();
  });

  it('adds the B1 footnote only when B1 amounts are present', async () => {
    get.mockResolvedValue(statement());
    const r = renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.queryByText("B1 金额为伙伴应付 Toh's Sign 的款项")).toBeNull();
    r.unmount();
    get.mockResolvedValue(
      statement({ partner: { id: 'TSP0003', name: 'X', company: null, code: 'B1' }, lines: [line('TS-2611-014', 1440, { status: '待付发票', code: 'B1' })], totals: totals({ b1Owed: 1440 }) }),
    );
    renderPage();
    expect(await screen.findByText("B1 金额为伙伴应付 Toh's Sign 的款项")).toBeTruthy();
    expect(screen.getAllByText("应付 Toh's Sign").length).toBeGreaterThan(0);
  });

  it('labels each line by its own code in a mixed month and shows both totals', async () => {
    get.mockResolvedValue(
      statement({
        partner: { id: 'TSP0003', name: 'X', company: null, code: 'B1' },
        lines: [
          line('TS-2611-014', 300, { code: 'C1' }),
          line('TS-2611-016', 1440, { code: 'B1', status: '待付发票' }),
          line('TS-2611-018', 800, { code: 'B1', status: '已结清' }),
        ],
        totals: totals({ commissionPending: 300, b1Owed: 1440, b1Settled: 800 }),
      }),
    );
    renderPage();
    const old = (await screen.findByText('TS-2611-014')).closest('tr') as HTMLElement;
    const now = screen.getByText('TS-2611-016').closest('tr') as HTMLElement;
    expect(within(old).queryByText("应付 Toh's Sign")).toBeNull();
    expect(within(now).getByText("应付 Toh's Sign")).toBeTruthy();
    expect(screen.getByTestId('total-commission-pending').textContent).toBe('RM 300');
    expect(screen.getByTestId('total-b1-owed').textContent).toBe('RM 1,440');
    expect(screen.getByTestId('total-b1-settled').textContent).toBe('RM 800');
    expect(screen.getByText("B1 金额为伙伴应付 Toh's Sign 的款项")).toBeTruthy();
  });

  it('shows only the totals that apply', async () => {
    get.mockResolvedValue(statement());
    renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.queryByTestId('total-b1-owed')).toBeNull();
    expect(screen.queryByTestId('total-b1-settled')).toBeNull();
  });

  it('hides the error banner in print', async () => {
    get.mockResolvedValue(statement());
    renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has an @media print rule hiding the menu and a print button', async () => {
    get.mockResolvedValue(statement());
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { container } = renderPage();
    const btn = await screen.findByRole('button', { name: '打印 / 保存为 PDF' });
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/\.topbar[^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.no-print[^{]*\{[^}]*display:\s*none/);
    await userEvent.setup().click(btn);
    expect(print).toHaveBeenCalled();
    expect(btn.closest('.no-print')).not.toBeNull();
  });

  it('shows an error banner when the statement cannot load', async () => {
    get.mockRejectedValue(Object.assign(new Error('x'), { error: '找不到伙伴' }));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('找不到伙伴');
  });
});
