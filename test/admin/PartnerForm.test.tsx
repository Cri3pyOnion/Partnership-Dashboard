import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/admin/api';
import { PartnerForm } from '../../src/admin/pages/PartnerForm';
import { demoPartner } from '../fixtures/demo';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
import { api } from '../../src/admin/api';

const post = api.post as ReturnType<typeof vi.fn>;
const patch = api.patch as ReturnType<typeof vi.fn>;

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/partners/new']}>
      <Routes>
        <Route path="/partners/new" element={<PartnerForm />} />
        <Route path="/partners/:id" element={<div>detail page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^姓名/), 'Lim Siew Ling');
  await user.type(screen.getByLabelText(/^电话号码/), '12-338 4521');
  await user.type(screen.getByLabelText(/^电邮/), 'siewling@limco.my');
}

const invalid = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true';

beforeEach(() => vi.clearAllMocks());

describe('PartnerForm (create)', () => {
  it('marks required fields red and says what is wrong on an empty submit', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole('button', { name: '提交登记' }));
    expect(invalid(screen.getByLabelText(/^姓名/))).toBe(true);
    expect(invalid(screen.getByLabelText(/^电话号码/))).toBe(true);
    expect(invalid(screen.getByLabelText(/^电邮/))).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('请检查红色栏位 · 请选择伙伴代码');
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the normalised partner and goes to its page', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ ...demoPartner({ id: 'TSP0009' }) });
    renderCreate();
    await fillValid(user);
    await user.click(screen.getByLabelText(/C1/));
    await user.click(screen.getByRole('button', { name: '提交登记' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/api/admin/partners');
    expect(body).toMatchObject({ name: 'Lim Siew Ling', phone: '+60123384521', email: 'siewling@limco.my', code: 'C1', filledBy: 'Transmission' });
    expect(await screen.findByText('detail page')).toBeTruthy();
  });

  it('rejects a bad TIN on the client', async () => {
    const user = userEvent.setup();
    renderCreate();
    await fillValid(user);
    await user.click(screen.getByLabelText(/C1/));
    await user.type(screen.getByLabelText(/^税号/), 'XYZ');
    await user.click(screen.getByRole('button', { name: '提交登记' }));
    expect(invalid(screen.getByLabelText(/^税号/))).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('shows a server field error under the right field', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new ApiError(400, '请检查红色栏位', { email: '电邮格式不正确' }));
    renderCreate();
    await fillValid(user);
    await user.click(screen.getByLabelText(/B1/));
    await user.click(screen.getByRole('button', { name: '提交登记' }));
    const msg = await screen.findByText('电邮格式不正确');
    const email = screen.getByLabelText(/^电邮/);
    expect(invalid(email)).toBe(true);
    expect(email.closest('.field')!.contains(msg)).toBe(true);
  });

  it('clears the form', async () => {
    const user = userEvent.setup();
    renderCreate();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: '清空' }));
    expect((screen.getByLabelText(/^姓名/) as HTMLInputElement).value).toBe('');
  });
});

describe('PartnerForm (edit)', () => {
  it('patches only the changed fields', async () => {
    const user = userEvent.setup();
    const p = demoPartner();
    patch.mockResolvedValue({ ...p, name: 'Lim S. L.' });
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <PartnerForm partner={p} onSaved={onSaved} />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText(/^电话号码/) as HTMLInputElement).value).toBe('162458830');
    const name = screen.getByLabelText(/^姓名/);
    await user.clear(name);
    await user.type(name, 'Lim S. L.');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/api/admin/partners/TSP0003', { name: 'Lim S. L.' });
    expect(onSaved).toHaveBeenCalled();
  });
});
