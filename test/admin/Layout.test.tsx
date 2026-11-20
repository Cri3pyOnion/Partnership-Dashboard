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

  it('shows the company logo with 伙伴后台 under it', async () => {
    get.mockImplementation(async (p: string) =>
      p === '/api/admin/me' ? { email: 's@x.my', name: 'Sam Staff', role: 'staff', team: null } : [],
    );
    renderApp();
    expect((await screen.findByRole('img', { name: "Toh's Sign" })).getAttribute('src')).toBeTruthy();
    expect(screen.getByText('伙伴后台')).toBeTruthy();
  });

  it('shows 设置 for an admin', async () => {
    get.mockImplementation(async (p: string) =>
      p === '/api/admin/me' ? { email: 'a@x.my', name: 'Ada Admin', role: 'admin', team: null } : [],
    );
    renderApp();
    expect(await screen.findByRole('link', { name: '设置' })).toBeTruthy();
  });

  it('loads a list page alongside the sign-in check instead of after it', async () => {
    get.mockImplementation((p: string) => (p === '/api/admin/me' ? new Promise(() => {}) : Promise.resolve([])));
    renderApp('/partners');
    expect(await screen.findByRole('heading', { name: '伙伴' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/admin/partners');
  });

  it('a new-partner form waits for the sign-in check (it defaults the assignee to you)', async () => {
    get.mockImplementation((p: string) => (p === '/api/admin/me' ? new Promise(() => {}) : Promise.resolve([])));
    renderApp('/partners/new');
    expect(await screen.findByText('载入中…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '登记新伙伴' })).toBeNull();
  });

  it('renders the commissions page for the route', async () => {
    get.mockImplementation(async (p: string) =>
      p === '/api/admin/me' ? { email: 'a@x.my', name: 'Ada Admin', role: 'admin', team: null } : [],
    );
    renderApp('/commissions');
    expect(await screen.findByRole('heading', { name: '佣金' })).toBeTruthy();
  });
});

describe('Profile', () => {
  const me = { email: 'vera@x.my', name: 'Vera', role: 'staff', team: 'Marketing' };

  it('shows name, email and role, with a sign-out link to Cloudflare Access', async () => {
    get.mockImplementation(async (p: string) => (p === '/api/admin/me' ? me : []));
    renderApp();
    const profile = await screen.findByRole('region', { name: '我的账号' });
    expect(profile.textContent).toContain('Vera');
    expect(profile.textContent).toContain('vera@x.my');
    expect(profile.textContent).toContain('员工 · Marketing');
    const out = screen.getByRole('link', { name: '退出登录' }) as HTMLAnchorElement;
    expect(out.getAttribute('href')).toBe('/cdn-cgi/access/logout');
  });

  it('asks first, and stays when cancelled', async () => {
    get.mockImplementation(async (p: string) => (p === '/api/admin/me' ? me : []));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp();
    const out = await screen.findByRole('link', { name: '退出登录' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    out.dispatchEvent(click);
    expect(confirm).toHaveBeenCalledWith('确定退出登录？');
    expect(click.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });
});

describe('Not on the staff list', () => {
  it('a 403 from /me shows 没有权限 with a way to sign out and switch email', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../src/admin/api')>('../../src/admin/api');
    get.mockImplementation(async (p: string) => {
      if (p === '/api/admin/me') throw new ApiError(403, '没有权限');
      return [];
    });
    renderApp();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('不在员工名单');
    const out = screen.getByRole('link', { name: '退出并换个电邮' }) as HTMLAnchorElement;
    expect(out.getAttribute('href')).toBe('/cdn-cgi/access/logout');
    expect(screen.queryByRole('link', { name: '伙伴' })).toBeNull();
  });
});
