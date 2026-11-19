// DEV ONLY. A tiny in-memory stand-in for the staff API so the app can be clicked through
// without Cloudflare Access. Loaded by main.tsx behind import.meta.env.DEV, so it never ships.
// Marker for the production-bundle check: TOHS_DEV_MOCK_API
import type { Case, Partner } from '../../shared/types';
import { isEmail, normalizePhone, normalizeTin } from '../../shared/validate';
import { createStaffMock } from './mock-staff';

const MARKER = 'TOHS_DEV_MOCK_API';

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const partners: Partner[] = [
  { id: 'TSP0001', name: 'Tan Wei Ming', phone: '+60123384521', email: 'weiming@tan.my', tin: 'IG12345678901', company: null, code: 'A1', referralName: null, filledBy: 'Transmission', source: '上门', bankName: 'CIMB', bankAccount: '7001234567', status: '活跃', viewToken: token(), registeredAt: '2026-08-12' },
  { id: 'TSP0002', name: 'Lim Siew Ling', phone: '+60162458830', email: 'siewling@limco.my', tin: 'C2584463202', company: 'Lim & Co. Accounting', code: 'C1', referralName: 'Tan Wei Ming', filledBy: '市场部', source: '线上', bankName: 'Maybank', bankAccount: '5123-4567-8901', status: '待审核', viewToken: null, registeredAt: '2026-11-17' },
  { id: 'TSP0003', name: 'Ahmad Faizal', phone: '+60191112222', email: 'faizal@example.my', tin: null, company: 'Faizal Trading', code: 'B1', referralName: null, filledBy: 'Transmission', source: null, bankName: null, bankAccount: null, status: '不活跃', viewToken: token(), registeredAt: '2026-05-02' },
];

const cases: Case[] = [
  { id: 'TS-2611-001', partnerId: 'TSP0001', clientName: 'Kedai Kopi Ah Seng', clientPhone: null, licenceType: '营业执照', council: 'MBPJ', step: 2, cancelled: false, missingDocs: null, submittedAt: '2026-11-03', price: 1800, markup: null, invoiceNo: null, clientPaid: false, clientPaidAt: null, notesInternal: null },
];

const staffRoutes = createStaffMock(partners, cases);

const views = [
  { viewedAt: '2026-11-18T03:12:00Z', country: 'MY' },
  { viewedAt: '2026-11-15T09:40:00Z', country: 'SG' },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function me() {
  const role = new URLSearchParams(location.search).get('role') ?? sessionStorage.getItem('mock-role') ?? 'admin';
  sessionStorage.setItem('mock-role', role);
  return { email: `${role}@example.my`, name: role === 'admin' ? 'Demo Admin' : 'Demo Staff', role, team: 'Transmission' };
}

function validate(b: Record<string, unknown>, create: boolean): { fields: Record<string, string>; out: Record<string, unknown> } {
  const fields: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  const want = (k: string) => create || k in b;
  if (want('name')) (typeof b.name === 'string' && b.name.trim() ? (out.name = b.name.trim()) : (fields.name = '请填写姓名'));
  if (want('phone')) {
    const p = typeof b.phone === 'string' ? normalizePhone(b.phone) : null;
    p ? (out.phone = p) : (fields.phone = '电话号码格式不正确');
  }
  if (want('email')) (typeof b.email === 'string' && isEmail(b.email) ? (out.email = b.email) : (fields.email = '电邮格式不正确'));
  if (want('code')) (['A1', 'B1', 'C1'].includes(b.code as string) ? (out.code = b.code) : (fields.code = '请选择伙伴代码'));
  if ('tin' in b && b.tin !== null) {
    const t = typeof b.tin === 'string' ? normalizeTin(b.tin) : null;
    t ? (out.tin = t) : (fields.tin = '税号格式不正确');
  } else if ('tin' in b) out.tin = null;
  for (const k of ['filledBy', 'company', 'referralName', 'source', 'bankName', 'bankAccount', 'status'] as const) if (k in b) out[k] = b[k];
  return { fields, out };
}

export function installMockApi(): void {
  const realFetch = window.fetch.bind(window);
  console.info(`[${MARKER}] staff API is mocked in memory (?role=staff to try the staff view)`);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith('/api/admin/')) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 120));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/admin', '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (path === '/me') return json(200, me());

    const handled = staffRoutes({ method, path, url, body, rawBody: init?.body, me: me() });
    if (handled) return handled;

    if (path === '/partners' && method === 'GET') {
      const status = url.searchParams.get('status');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return json(200, partners.filter((p) => (!status || p.status === status) && (!q || [p.id, p.name, p.company ?? '', p.phone].some((s) => s.toLowerCase().includes(q)))));
    }
    if (path === '/partners' && method === 'POST') {
      const { fields, out } = validate(body, true);
      if (Object.keys(fields).length) return json(400, { error: '请检查红色栏位', fields });
      const p: Partner = { tin: null, company: null, referralName: null, source: null, bankName: null, bankAccount: null, ...out, id: `TSP${String(partners.length + 1).padStart(4, '0')}`, status: '待审核', viewToken: null, registeredAt: new Date().toISOString().slice(0, 10) } as Partner;
      partners.push(p);
      return json(201, p);
    }

    const m = /^\/partners\/([^/]+)(\/approve|\/reset-link)?$/.exec(path);
    const p = m && partners.find((x) => x.id === m[1]);
    if (m && !p) return json(404, { error: '找不到伙伴' });
    if (m && p) {
      if (!m[2] && method === 'GET') return json(200, { partner: p, cases: cases.filter((c) => c.partnerId === p.id), recentViews: p.viewToken ? views : [] });
      if (!m[2] && method === 'PATCH') {
        const { fields, out } = validate(body, false);
        if (Object.keys(fields).length) return json(400, { error: '请检查红色栏位', fields });
        Object.assign(p, out);
        return json(200, p);
      }
      if (m[2] === '/approve' && method === 'POST') {
        if (me().role !== 'admin') return json(403, { error: '需要管理员权限' });
        p.viewToken ??= token();
        p.status = '活跃';
        return json(200, { link: `${location.origin}/p/${p.viewToken}` });
      }
      if (m[2] === '/reset-link' && method === 'POST') {
        p.viewToken = token();
        return json(200, { link: `${location.origin}/p/${p.viewToken}` });
      }
    }
    return json(404, { error: '演示模式：此接口尚未模拟' });
  };
}
