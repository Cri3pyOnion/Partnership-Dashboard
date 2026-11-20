import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES } from '../../src/shared/commission';
import { Settings } from '../../src/admin/pages/Settings';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;
const put = api.put as ReturnType<typeof vi.fn>;

const settings = { commissionRules: DEFAULT_RULES, licenceTypes: ['营业执照', '招牌执照'], inactiveDays: 90 };
const staffList = [
  { email: 'boss@tohsign.com', name: 'Boss', role: 'admin', team: 'IT', active: true },
  { email: 'clerk@tohsign.com', name: 'Clerk', role: 'staff', team: '市场部', active: true },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (p: string) => (p === '/api/admin/settings' ? settings : staffList));
});

describe('Settings', () => {
  it('shows the note under the commission rules', async () => {
    renderPage();
    expect(await screen.findByText('新规则只会在案件下次更新时生效，已支付的佣金不会改变。')).toBeTruthy();
  });

  it('saves the changed rules with a PUT', async () => {
    const user = userEvent.setup();
    put.mockResolvedValue(settings);
    renderPage();
    const threshold = await screen.findByLabelText('A1 门槛 (RM)');
    await user.clear(threshold);
    await user.type(threshold, '2000');
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [path, body] = put.mock.calls[0];
    expect(path).toBe('/api/admin/settings');
    expect(body.commissionRules.A1).toEqual({ threshold: 2000, below: 100, above: 150 });
    expect(body.licenceTypes).toEqual(['营业执照', '招牌执照']);
    expect(body.inactiveDays).toBe(90);
  });

  it('shows the server field errors', async () => {
    const user = userEvent.setup();
    put.mockRejectedValue(Object.assign(new Error('x'), { error: '请检查红色栏位', fields: { inactiveDays: '请填写 1 到 365' } }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: '保存设置' }));
    expect((await screen.findByRole('alert')).textContent).toContain('请检查红色栏位');
    expect(screen.getByText('请填写 1 到 365')).toBeTruthy();
  });

  it('lists staff and shows the last-admin error from the server', async () => {
    const user = userEvent.setup();
    put.mockRejectedValue(Object.assign(new Error('x'), { error: '至少需要一位管理员' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = (await screen.findByText('boss@tohsign.com')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: '停用' }));
    expect((await screen.findByRole('alert')).textContent).toContain('至少需要一位管理员');
    expect(put).toHaveBeenCalledWith('/api/admin/staff/boss%40tohsign.com', { name: 'Boss', role: 'admin', team: 'IT', active: false });
  });

  it('asks before deactivating a staff member', async () => {
    const user = userEvent.setup();
    put.mockResolvedValue({});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    const row = (await screen.findByText('clerk@tohsign.com')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: '停用' }));
    expect(confirm).toHaveBeenCalledWith('确定停用？');
    expect(put).not.toHaveBeenCalled();
    await user.click(within(row).getByRole('button', { name: '停用' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
  });

  it('shows the self-demotion error when editing a role', async () => {
    const user = userEvent.setup();
    put.mockRejectedValue(Object.assign(new Error('x'), { error: '不能降级自己的账号' }));
    renderPage();
    const row = (await screen.findByText('boss@tohsign.com')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: '编辑' }));
    await user.selectOptions(screen.getByLabelText('角色'), 'staff');
    await user.click(screen.getByRole('button', { name: '保存员工' }));
    expect((await screen.findByRole('alert')).textContent).toContain('不能降级自己的账号');
  });

  it('adds a staff member', async () => {
    const user = userEvent.setup();
    put.mockResolvedValue({});
    renderPage();
    await user.click(await screen.findByRole('button', { name: '新增员工' }));
    await user.type(screen.getByLabelText('电邮'), 'New@Tohsign.com');
    await user.type(screen.getByLabelText('姓名'), 'Newbie');
    await user.click(screen.getByRole('button', { name: '保存员工' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/admin/staff/new%40tohsign.com', { name: 'Newbie', role: 'staff', team: null, active: true }),
    );
  });
});
