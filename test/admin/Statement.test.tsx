import { render, screen } from '@testing-library/react';
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
  caseId, clientName: `客户 ${caseId}`, licence: '营业执照', submittedAt: '2026-11-03', amount, basis: '加价', status: '待处理', ...over,
});

function statement(over: Record<string, unknown> = {}) {
  return {
    partner: { id: 'TSP0003', name: 'Lim Siew Ling', company: 'Lim & Co. <Accounting>', code: 'C1' },
    month: '2026-11',
    lines: [line('TS-2611-014', 300), line('TS-2611-016', 150.5)],
    total: 450.5,
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

  it('shows every case line and a total equal to the sum', async () => {
    get.mockResolvedValue(statement());
    renderPage();
    await screen.findByText('TS-2611-014');
    expect(screen.getByText('TS-2611-016')).toBeTruthy();
    expect(screen.getByText('RM 300')).toBeTruthy();
    expect(screen.getByText('RM 150.50')).toBeTruthy();
    expect(screen.getByTestId('total').textContent).toBe('RM 450.50');
  });

  it('marks a pending line as 佣金待计算', async () => {
    get.mockResolvedValue(statement({ lines: [line('TS-2611-014', 300, { pending: true })], total: 300 }));
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
      statement({ partner: { id: 'TSP0003', name: 'X', company: null, code: 'B1' }, lines: [line('TS-2611-014', 1440, { status: '待付发票' })], total: 1440 }),
    );
    renderPage();
    expect(await screen.findByText("B1 金额为伙伴应付 Toh's Sign 的款项")).toBeTruthy();
    expect(screen.getAllByText("应付 Toh's Sign").length).toBeGreaterThan(0);
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
