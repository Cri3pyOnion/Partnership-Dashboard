import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseForm } from '../../src/admin/pages/CaseForm';
import { demoPartner } from '../fixtures/demo';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;

const partners = [
  demoPartner({ id: 'TSP0001', name: 'Alice', code: 'A1' }),
  demoPartner({ id: 'TSP0002', name: 'Pending Pete', code: 'A1', status: '待审核' }),
  demoPartner({ id: 'TSP0003', name: 'Charlie', code: 'C1' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (p: string) => (p === '/api/admin/licence-types' ? { licenceTypes: ['营业执照', '招牌执照'] } : partners));
});

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/cases/new']}>
      <Routes>
        <Route path="/cases/new" element={<CaseForm />} />
        <Route path="/cases/:id" element={<p>case page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CaseForm', () => {
  it('offers only partners that are not 待审核, and licence types from the staff-readable endpoint', async () => {
    renderForm();
    await screen.findByRole('option', { name: /Alice/ });
    expect(screen.queryByRole('option', { name: /Pending Pete/ })).toBeNull();
    expect(screen.getByRole('option', { name: '招牌执照' })).toBeTruthy();
  });

  it('shows the markup field only for a C1 partner', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByRole('option', { name: /Alice/ });
    await user.selectOptions(screen.getByLabelText(/^伙伴/), 'TSP0001');
    expect(screen.queryByLabelText(/^加价/)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/^伙伴/), 'TSP0003');
    expect(screen.getByLabelText(/^加价/)).toBeTruthy();
  });

  it('creates the case and opens it', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ id: 'TS-2611-020' });
    renderForm();
    await screen.findByRole('option', { name: /Alice/ });
    await user.selectOptions(screen.getByLabelText(/^伙伴/), 'TSP0001');
    await user.type(screen.getByLabelText(/^客户姓名/), '李先生');
    await user.type(screen.getByLabelText(/^客户电话/), '0123456789');
    await user.type(screen.getByLabelText(/^州属局/), 'MBPJ');
    await user.type(screen.getByLabelText(/^价格/), '1800');
    await user.click(screen.getByRole('button', { name: '建立案件' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/admin/cases', {
        partnerId: 'TSP0001', licenceType: '营业执照', clientName: '李先生', clientPhone: '0123456789', council: 'MBPJ', price: 1800,
      }),
    );
    expect(await screen.findByText('case page')).toBeTruthy();
  });

  it('shows a server field error next to the field', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(Object.assign(new Error('x'), { error: '请检查红色栏位', fields: { clientName: '请填写客户姓名' } }));
    renderForm();
    await screen.findByRole('option', { name: /Alice/ });
    await user.selectOptions(screen.getByLabelText(/^伙伴/), 'TSP0001');
    await user.click(screen.getByRole('button', { name: '建立案件' }));
    expect(await screen.findByText('请填写客户姓名')).toBeTruthy();
  });
});

describe('CaseForm handler', () => {
  it("suggests the partner's staff member and sends a changed handler", async () => {
    const user = userEvent.setup();
    partners[0] = { ...partners[0], assignedStaff: 'ann@tohsign.com' };
    post.mockResolvedValue({ id: 'TS-2611-021' });
    renderForm();
    await screen.findByRole('option', { name: /Alice/ });
    await user.selectOptions(screen.getByLabelText(/^伙伴/), 'TSP0001');
    expect((screen.getByLabelText('处理员工') as HTMLSelectElement).value).toBe('ann@tohsign.com');
    await user.selectOptions(screen.getByLabelText('处理员工'), 'ben@tohsign.com');
    await user.type(screen.getByLabelText(/^客户姓名/), '李先生');
    await user.click(screen.getByRole('button', { name: '建立案件' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/cases', expect.objectContaining({ handledBy: 'ben@tohsign.com' })));
  });
});
