import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/admin/App';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;

function renderApp(path = '/cases') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Layout', () => {
  it('hides 设置 for staff and shows the signed-in name', async () => {
    get.mockImplementation(async (p: string) =>
      p === '/api/admin/me' ? { email: 's@x.my', name: 'Sam Staff', role: 'staff', team: 'Transmission' } : [],
    );
    renderApp();
    await screen.findByText('Sam Staff');
    for (const label of ['伙伴', '案件', '佣金', '报表']) expect(screen.getByRole('link', { name: label })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '设置' })).toBeNull();
  });

  it('shows 设置 for an admin', async () => {
    get.mockImplementation(async (p: string) =>
      p === '/api/admin/me' ? { email: 'a@x.my', name: 'Ada Admin', role: 'admin', team: null } : [],
    );
    renderApp();
    expect(await screen.findByRole('link', { name: '设置' })).toBeTruthy();
  });

  it('renders the commissions page for the route', async () => {
    get.mockImplementation(async (p: string) =>
      p === '/api/admin/me' ? { email: 'a@x.my', name: 'Ada Admin', role: 'admin', team: null } : [],
    );
    renderApp('/commissions');
    expect(await screen.findByRole('heading', { name: '佣金' })).toBeTruthy();
  });
});
