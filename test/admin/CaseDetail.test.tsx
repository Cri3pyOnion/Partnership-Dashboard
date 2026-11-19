import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeContext, type Me } from '../../src/admin/me';
import { CaseDetail } from '../../src/admin/pages/CaseDetail';
import { demoCases, demoPartner } from '../fixtures/demo';

vi.mock('../../src/admin/api', async (orig) => {
  const real = await orig<typeof import('../../src/admin/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), raw: vi.fn() } };
});
vi.mock('../../src/admin/lib/compress-image', () => ({ compressImage: vi.fn() }));
import { api } from '../../src/admin/api';
import { compressImage } from '../../src/admin/lib/compress-image';

const get = api.get as ReturnType<typeof vi.fn>;
const patch = api.patch as ReturnType<typeof vi.fn>;
const raw = api.raw as ReturnType<typeof vi.fn>;
const compress = compressImage as ReturnType<typeof vi.fn>;

const staff: Me = { email: 's@x.my', name: 'Sam', role: 'staff', team: 'Transmission' };
const base = demoCases()[0]; // TS-2611-014, step 2, C1, price 1800, markup 300
const commission = { caseId: base.id, code: 'C1', amount: 300, basis: '加价', status: '待处理', paidAt: null, paidBy: null };

let current: Record<string, unknown>;
let partner = demoPartner({ viewToken: 'tok123' });
let docs: unknown[] = [];

function wire() {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/documents')) return docs;
    if (path.startsWith('/api/admin/partners/')) return { partner, cases: [], recentViews: [] };
    if (path.startsWith('/api/admin/cases/')) return current;
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderDetail() {
  return render(
    <MeContext.Provider value={staff}>
      <MemoryRouter initialEntries={[`/cases/${base.id}`]}>
        <Routes>
          <Route path="/cases/:id" element={<CaseDetail />} />
        </Routes>
      </MemoryRouter>
    </MeContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  current = { ...base, commission, history: [{ step: 2, changedAt: '2026-11-04T02:00:00Z', changedBy: 'a@x.my' }] };
  partner = demoPartner({ viewToken: 'tok123' });
  docs = [];
  wire();
});
afterEach(() => vi.restoreAllMocks());

describe('CaseDetail steps', () => {
  it('shows six step buttons with the current one highlighted', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: /TS-2611-014/ });
    const group = screen.getByRole('group', { name: '进度' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['已收件', '待补文件', '已递交政府部门', '实地检查', '已批准', '已完成']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false']);
  });

  it('PATCHes the step when a button is clicked', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ ...base, step: 4, commission });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '已批准' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/cases/TS-2611-014', { step: 4 }));
  });

  it('shows a server 400 in an error banner', async () => {
    const user = userEvent.setup();
    patch.mockRejectedValue(Object.assign(new Error('x'), { status: 400, error: 'B1 案件需先结清才能递交' }));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '已批准' }));
    expect((await screen.findByRole('alert')).textContent).toContain('B1 案件需先结清才能递交');
  });
});

describe('CaseDetail fields', () => {
  it('saves missing documents, price and notes as PATCHes', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ ...base, commission });
    renderDetail();
    const missing = await screen.findByLabelText('缺少文件');
    await user.type(missing, '租约');
    await user.click(screen.getByRole('button', { name: '保存缺少文件' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/cases/TS-2611-014', { missingDocs: '租约' }));

    const price = screen.getByLabelText(/^价格/);
    await user.clear(price);
    await user.type(price, '2000');
    await user.click(screen.getByRole('button', { name: '保存付款资料' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/cases/TS-2611-014', { price: 2000 }));

    await user.type(screen.getByLabelText('内部备注'), 'call back');
    await user.click(screen.getByRole('button', { name: '保存备注' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/cases/TS-2611-014', { notesInternal: expect.stringContaining('call back') }));
  });

  it('marks the client as paid', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ ...base, clientPaid: true, commission });
    renderDetail();
    await user.click(await screen.findByLabelText('客户已付款'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/cases/TS-2611-014', { clientPaid: true }));
  });

  it('shows the markup field only for a C1 case', async () => {
    const r = renderDetail();
    expect(await screen.findByLabelText(/^加价/)).toBeTruthy();
    r.unmount();
    current = { ...base, markup: null, commission: { ...commission, code: 'A1' }, history: [] };
    partner = demoPartner({ code: 'A1', viewToken: 'tok123' });
    renderDetail();
    await screen.findByLabelText(/^价格/);
    expect(screen.queryByLabelText(/^加价/)).toBeNull();
  });

  it('asks before cancelling', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ ...base, cancelled: true, commission });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderDetail();
    const btn = await screen.findByRole('button', { name: '取消案件' });
    await user.click(btn);
    expect(confirm).toHaveBeenCalledWith('确定取消此案件？');
    expect(patch).not.toHaveBeenCalled();
    await user.click(btn);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/cases/TS-2611-014', { cancelled: true }));
  });
});

describe('CaseDetail commission', () => {
  it('shows the amount, and 佣金待计算 when the case write returned commissionPending', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ ...base, step: 3, commission, commissionPending: true });
    renderDetail();
    expect(await screen.findByText('RM 300')).toBeTruthy();
    expect(screen.queryByText('佣金待计算')).toBeNull();
    await user.click(screen.getByRole('button', { name: '实地检查' }));
    expect(await screen.findByText('佣金待计算')).toBeTruthy();
  });

  it("labels a B1 amount as owed to Toh's Sign", async () => {
    partner = demoPartner({ code: 'B1', viewToken: 'tok123' });
    current = { ...base, markup: null, commission: { ...commission, code: 'B1', amount: 1440, status: '待付发票' }, history: [] };
    renderDetail();
    expect(await screen.findByText("应付 Toh's Sign")).toBeTruthy();
    expect(screen.getByText('RM 1,440')).toBeTruthy();
  });
});

describe('CaseDetail WhatsApp', () => {
  it('links to wa.me with the progress message and the partner link', async () => {
    renderDetail();
    const a = (await screen.findByRole('link', { name: /发送进度 WhatsApp/ })) as HTMLAnchorElement;
    expect(a.href.startsWith('https://wa.me/')).toBe(true);
    const text = decodeURIComponent(a.href);
    expect(text).toContain('案件 TS-2611-014（Kedai Kopi Ah Seng）进度更新：已递交政府部门。查看：');
    expect(text).toContain(`${location.origin}/p/tok123`);
    expect(a.rel).toBe('noopener noreferrer');
  });

  it('is disabled with a hint when the partner has no link yet', async () => {
    partner = demoPartner({ status: '待审核', viewToken: null });
    renderDetail();
    expect(await screen.findByText('伙伴尚未批准')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /发送进度 WhatsApp/ })).toBeNull();
    expect((screen.getByRole('button', { name: /发送进度 WhatsApp/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CaseDetail documents', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, file: File) => {
    await user.selectOptions(await screen.findByLabelText('文件类型'), '租约');
    await user.upload(screen.getByLabelText('选择文件'), file);
    await user.click(screen.getByRole('button', { name: '上传' }));
  };

  it('lists documents with a download link and the filename as plain text', async () => {
    docs = [{ id: 'd1', caseId: base.id, filename: '<b>ssm</b>.pdf', kind: 'SSM', uploadedBy: 'a@x.my', uploadedAt: '2026-11-04T02:00:00Z' }];
    renderDetail();
    const a = (await screen.findByText('<b>ssm</b>.pdf')).closest('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/admin/documents/d1/download');
  });

  it('compresses an image and uploads image/jpeg with a .jpg name', async () => {
    const user = userEvent.setup();
    const jpeg = new Blob(['small'], { type: 'image/jpeg' });
    compress.mockResolvedValue(jpeg);
    raw.mockResolvedValue(new Response('{}', { status: 201 }));
    renderDetail();
    await pick(user, new File(['big'], 'shop front.PNG', { type: 'image/png' }));
    await waitFor(() => expect(raw).toHaveBeenCalled());
    const [url, init] = raw.mock.calls[0];
    expect(url).toBe(`/api/admin/cases/TS-2611-014/documents?filename=${encodeURIComponent('shop front.jpg')}&kind=${encodeURIComponent('租约')}`);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(init.body).toBe(jpeg);
  });

  it('uploads a PDF unchanged', async () => {
    const user = userEvent.setup();
    compress.mockImplementation(async (f: File) => f);
    raw.mockResolvedValue(new Response('{}', { status: 201 }));
    renderDetail();
    await pick(user, new File(['%PDF'], 'ssm.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(raw).toHaveBeenCalled());
    const [url, init] = raw.mock.calls[0];
    expect(url).toContain('filename=ssm.pdf&');
    expect(init.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect((init.body as Blob).size).toBe(4);
  });

  it('keeps a HEIC file with an empty type, deriving image/heic from the extension', async () => {
    const user = userEvent.setup();
    compress.mockImplementation(async (f: File) => f);
    raw.mockResolvedValue(new Response('{}', { status: 201 }));
    renderDetail();
    await pick(user, new File(['heic'], 'IMG_0001.HEIC', { type: '' }));
    await waitFor(() => expect(raw).toHaveBeenCalled());
    const [url, init] = raw.mock.calls[0];
    expect(url).toContain('filename=IMG_0001.HEIC&');
    expect(init.headers).toEqual({ 'Content-Type': 'image/heic' });
  });

  it('rejects a file over 10 MB without uploading', async () => {
    const user = userEvent.setup();
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'application/pdf' });
    compress.mockResolvedValue(big);
    renderDetail();
    await pick(user, new File(['x'], 'big.pdf', { type: 'application/pdf' }));
    expect((await screen.findByRole('alert')).textContent).toContain('文件不能超过 10 MB');
    expect(raw).not.toHaveBeenCalled();
  });

  it('shows the server error when an upload fails', async () => {
    const user = userEvent.setup();
    compress.mockImplementation(async (f: File) => f);
    raw.mockResolvedValue(new Response(JSON.stringify({ error: '只接受图片或 PDF' }), { status: 400 }));
    renderDetail();
    await pick(user, new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    expect((await screen.findByRole('alert')).textContent).toContain('只接受图片或 PDF');
  });
});
