import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeContext, type Me } from '../../src/admin/me';
import { PartnerDetail } from '../../src/admin/pages/PartnerDetail';
import { demoCases, demoPartner } from '../fixtures/demo';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const patch = api.patch as ReturnType<typeof vi.fn>;

const admin: Me = { email: 'a@x.my', name: 'Ada', role: 'admin', team: null };
const staff: Me = { email: 's@x.my', name: 'Sam', role: 'staff', team: 'Transmission' };

function detail(partner = demoPartner({ viewToken: 'tok123' })) {
  return { partner, cases: demoCases().slice(0, 2), recentViews: [{ viewedAt: '2026-11-18T03:00:00Z', country: 'MY' }] };
}

function renderDetail(me: Me) {
  return render(
    <MeContext.Provider value={me}>
      <MemoryRouter initialEntries={['/partners/TSP0003']}>
        <Routes>
          <Route path="/partners/:id" element={<PartnerDetail />} />
        </Routes>
      </MemoryRouter>
    </MeContext.Provider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('PartnerDetail', () => {
  it('hides 批准 from staff and shows it to an admin when pending', async () => {
    get.mockResolvedValue(detail(demoPartner({ status: '待审核', viewToken: null })));
    const r = renderDetail(staff);
    await screen.findByText('Lim Siew Ling');
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    r.unmount();
    renderDetail(admin);
    expect(await screen.findByRole('button', { name: '批准' })).toBeTruthy();
  });

  it('does not offer 批准 for an active partner', async () => {
    get.mockResolvedValue(detail());
    renderDetail(admin);
    await screen.findByText('Lim Siew Ling');
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
  });

  it('opens WhatsApp on a wa.me link to the partner', async () => {
    get.mockResolvedValue(detail());
    renderDetail(staff);
    const a = (await screen.findByRole('link', { name: /发送链接 WhatsApp/ })) as HTMLAnchorElement;
    expect(a.href.startsWith('https://wa.me/60')).toBe(true);
    expect(decodeURIComponent(a.href)).toContain('/p/tok123');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
  });

  it('asks before resetting and does nothing when cancelled', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '重置链接' }));
    expect(confirm).toHaveBeenCalledWith('旧链接将立即失效，确定重置？');
    expect(post).not.toHaveBeenCalled();
  });

  it('resets the link once confirmed and shows the new one', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    post.mockResolvedValue({ link: 'https://partners.example.com/p/newtok' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '重置链接' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/partners/TSP0003/reset-link'));
    expect(await screen.findByText('https://partners.example.com/p/newtok')).toBeTruthy();
  });

  it('copies the link', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '复制链接' }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/p/tok123`);
  });

  it('lists cases and the recent link views', async () => {
    get.mockResolvedValue(detail());
    renderDetail(staff);
    const link = (await screen.findByRole('link', { name: /TS-2611-014/ })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/cases/TS-2611-014');
    expect(screen.getByText('MY')).toBeTruthy();
  });

  it('edits with only the changed fields', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    patch.mockResolvedValue(demoPartner({ company: 'New Co', viewToken: 'tok123' }));
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '编辑' }));
    const company = screen.getByLabelText(/^公司名称/);
    await user.clear(company);
    await user.type(company, 'New Co');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/partners/TSP0003', { company: 'New Co' }));
  });

  it('changes the code with a PATCH', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    patch.mockResolvedValue(demoPartner({ code: 'A1', viewToken: 'tok123' }));
    renderDetail(staff);
    await user.selectOptions(await screen.findByLabelText('更改代码'), 'A1');
    await user.click(screen.getByRole('button', { name: '确认更改' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/partners/TSP0003', { code: 'A1' }));
  });

  it('shows API errors in a dismissible banner', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    patch.mockRejectedValue(Object.assign(new Error('x'), { error: '没有权限' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '设为不活跃' }));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('没有权限');
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks before 设为不活跃 and does nothing when cancelled', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '设为不活跃' }));
    expect(confirm).toHaveBeenCalledWith('确定设为不活跃？');
    expect(patch).not.toHaveBeenCalled();
  });

  it('deactivates once confirmed', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    patch.mockResolvedValue(demoPartner({ status: '不活跃' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '设为不活跃' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/partners/TSP0003', { status: '不活跃' }));
  });

  it('clears the copied timer on unmount', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(detail());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const r = renderDetail(staff);
    await user.click(await screen.findByRole('button', { name: '复制链接' }));
    await screen.findByText(/已复制/);
    clear.mockClear();
    r.unmount();
    expect(clear).toHaveBeenCalled();
  });
});
