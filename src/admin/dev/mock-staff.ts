// DEV ONLY. The in-memory cases, commissions, settings, staff, reports and statements behind
// `npm run preview:admin`. Imported only by mock-api.ts, which main.tsx loads behind import.meta.env.DEV.
// Marker for the production-bundle check: TOHS_DEV_MOCK_API
import { DEFAULT_RULES, ValidationError, calcCommission, isFrozen } from '../../shared/commission';
import type { Case, Commission, Partner, Settings, Staff } from '../../shared/types';
import { isEmail } from '../../shared/validate';

interface Me {
  email: string;
  role: string;
}

interface Ctx {
  method: string;
  path: string;
  url: URL;
  body: Record<string, unknown>;
  rawBody: BodyInit | null | undefined;
  me: Me;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const settings: Settings = {
  commissionRules: structuredClone(DEFAULT_RULES),
  licenceTypes: ['营业执照', '招牌执照', '清真认证 (JAKIM)'],
  inactiveDays: 90,
};

const staffList: Staff[] = [
  { email: 'admin@example.my', name: 'Demo Admin', role: 'admin', team: 'IT', active: true },
  { email: 'staff@example.my', name: 'Demo Staff', role: 'staff', team: 'Transmission', active: true },
];

const commissions = new Map<string, Commission>();
const docs: Array<{ id: string; caseId: string; filename: string; kind: string; uploadedBy: string; uploadedAt: string }> = [];
const history = new Map<string, Array<{ step: number; changedAt: string; changedBy: string | null }>>();

const monthOf = (c: Case) => c.submittedAt.slice(0, 7);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function createStaffMock(partners: Partner[], cases: Case[]) {
  const codeOf = (c: Case) => partners.find((p) => p.id === c.partnerId)?.code ?? 'A1';

  /** Mirrors the Worker: recompute from the case and the rules; 已支付 and 已结清 stay frozen (unless un-settled). */
  function recalc(c: Case, opts: { unsettle?: boolean } = {}): Commission {
    const prev = commissions.get(c.id) ?? null;
    if (isFrozen(prev, opts)) return prev;
    const code = prev?.code ?? codeOf(c);
    const r = calcCommission(c, code, settings.commissionRules);
    const next: Commission = { caseId: c.id, code, amount: r.amount, basis: r.basis, status: r.status, paidAt: null, paidBy: null };
    commissions.set(c.id, next);
    return next;
  }
  for (const c of cases) recalc(c);

  function patchCase(c: Case, ctx: Ctx): Response {
    const before = { ...c };
    const allowed = ['clientName', 'clientPhone', 'council', 'missingDocs', 'invoiceNo', 'notesInternal', 'price', 'markup', 'step', 'cancelled', 'clientPaid', 'clientPaidAt'];
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(ctx.body).filter(([k]) => allowed.includes(k)));
    if ('clientPaid' in patch) patch.clientPaidAt = patch.clientPaid ? (c.clientPaidAt ?? new Date().toISOString().slice(0, 10)) : null;
    const prevCommission = commissions.get(c.id);
    try {
      if (patch.markup != null && (prevCommission?.code ?? codeOf(c)) !== 'C1') throw new ValidationError('只有 C1 伙伴可以加价');
      Object.assign(c, patch);
      const next = recalc(c, { unsettle: patch.clientPaid === false });
      if (typeof patch.step === 'number' && patch.step >= 2 && next.code === 'B1' && settings.commissionRules.B1.collectBeforeSubmit && next.status !== '已结清') {
        throw new ValidationError('B1 案件需先结清才能递交');
      }
      if (typeof patch.step === 'number' && patch.step !== before.step) {
        history.set(c.id, [...(history.get(c.id) ?? []), { step: patch.step, changedAt: new Date().toISOString(), changedBy: ctx.me.email }]);
      }
      return json(200, { ...c, commission: next });
    } catch (e) {
      Object.assign(c, before);
      if (prevCommission) commissions.set(c.id, prevCommission);
      if (e instanceof ValidationError) return json(400, { error: e.message });
      throw e;
    }
  }

  function createCase(ctx: Ctx): Response {
    const b = ctx.body;
    const p = partners.find((x) => x.id === b.partnerId);
    const fields: Record<string, string> = {};
    if (!p) fields.partnerId = '请选择伙伴';
    if (typeof b.clientName !== 'string' || !b.clientName.trim()) fields.clientName = '请填写客户姓名';
    if (!settings.licenceTypes.includes(b.licenceType as string)) fields.licenceType = '执照类型不正确';
    if (b.markup != null && p?.code !== 'C1') fields.markup = '只有 C1 伙伴可以加价';
    if (Object.keys(fields).length) return json(400, { error: '请检查红色栏位', fields });
    if (p!.status === '待审核') return json(400, { error: '伙伴尚未批准' });
    const today = new Date().toISOString().slice(0, 10);
    const ym = today.slice(2, 4) + today.slice(5, 7);
    const n = cases.filter((c) => c.id.startsWith(`TS-${ym}-`)).length + 1;
    const c: Case = {
      id: `TS-${ym}-${String(n).padStart(3, '0')}`,
      partnerId: p!.id,
      clientName: String(b.clientName).trim(),
      clientPhone: (b.clientPhone as string) ?? null,
      licenceType: b.licenceType as string,
      council: (b.council as string) ?? null,
      step: 0,
      cancelled: false,
      missingDocs: null,
      submittedAt: today,
      price: (b.price as number) ?? null,
      markup: (b.markup as number) ?? null,
      invoiceNo: null,
      clientPaid: false,
      clientPaidAt: null,
      notesInternal: null,
    };
    try {
      cases.push(c);
      const commission = recalc(c);
      history.set(c.id, [{ step: 0, changedAt: new Date().toISOString(), changedBy: ctx.me.email }]);
      return json(201, { ...c, commission });
    } catch (e) {
      cases.pop();
      if (e instanceof ValidationError) return json(400, { error: e.message });
      throw e;
    }
  }

  function saveSettings(ctx: Ctx): Response {
    const b = ctx.body;
    const rules = b.commissionRules as Settings['commissionRules'] | undefined;
    const fields: Record<string, string> = {};
    const days = b.inactiveDays;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) fields.inactiveDays = '请填写 1 到 365';
    if (rules) {
      for (const k of ['threshold', 'below', 'above'] as const) if (typeof rules.A1[k] !== 'number') fields[`commissionRules.A1.${k}`] = '金额不正确';
      if (typeof rules.B1.partnerPricePercent !== 'number') fields['commissionRules.B1.partnerPricePercent'] = '请填写 0 到 100';
    }
    if (!Array.isArray(b.licenceTypes) || b.licenceTypes.length < 1) fields.licenceTypes = '请填写 1 到 30 个不重复的执照类型（每个不超过 50 字）';
    if (Object.keys(fields).length) return json(400, { error: '请检查红色栏位', fields });
    if (rules) settings.commissionRules = rules;
    settings.licenceTypes = b.licenceTypes as string[];
    settings.inactiveDays = days as number;
    return json(200, settings);
  }

  function saveStaff(emailRaw: string, ctx: Ctx): Response {
    const b = ctx.body;
    const email = decodeURIComponent(emailRaw).trim().toLowerCase();
    const self = ctx.me.email.toLowerCase();
    const active = b.active !== false;
    if (!isEmail(email)) return json(400, { error: '请检查红色栏位', fields: { email: '电邮格式不正确' } });
    if (!String(b.name ?? '').trim()) return json(400, { error: '请检查红色栏位', fields: { name: '请填写姓名' } });
    if (!active && email === self) return json(400, { error: '不能停用自己的账号' });
    if (b.role === 'staff' && email === self) return json(400, { error: '不能降级自己的账号' });
    const cur = staffList.find((x) => x.email === email);
    const otherAdmins = staffList.filter((x) => x.email !== email && x.role === 'admin' && x.active);
    if ((b.role !== 'admin' || !active) && cur?.role === 'admin' && cur.active && otherAdmins.length === 0) return json(400, { error: '至少需要一位管理员' });
    const next: Staff = { email, name: String(b.name).trim(), role: b.role as Staff['role'], team: (b.team as Staff['team']) ?? null, active };
    if (cur) Object.assign(cur, next);
    else staffList.push(next);
    return json(200, next);
  }

  /** The response for a new-page route, or null when the path is not one of them. */
  return function handle(ctx: Ctx): Response | null {
    const { method, path, url } = ctx;
    const isAdmin = ctx.me.role === 'admin';

    if (path === '/licence-types') return json(200, { licenceTypes: settings.licenceTypes });

    if (path === '/settings') {
      if (!isAdmin) return json(403, { error: '需要管理员权限' });
      return method === 'PUT' ? saveSettings(ctx) : json(200, settings);
    }

    const sm = /^\/staff(?:\/([^/]+))?$/.exec(path);
    if (sm) {
      if (!isAdmin) return json(403, { error: '需要管理员权限' });
      return sm[1] ? saveStaff(sm[1], ctx) : json(200, staffList);
    }

    if (path === '/partners/inactive') {
      const cutoff = new Date(Date.now() - settings.inactiveDays * 86400000).toISOString().slice(0, 10);
      return json(200, partners.filter((p) => p.status === '活跃' && !cases.some((c) => c.partnerId === p.id && c.submittedAt >= cutoff)));
    }

    if (path === '/cases') {
      if (method === 'POST') return createCase(ctx);
      const pid = url.searchParams.get('partnerId');
      const step = url.searchParams.get('step');
      const month = url.searchParams.get('month');
      return json(200, cases.filter((c) => (!pid || c.partnerId === pid) && (step === null || c.step === Number(step)) && (!month || monthOf(c) === month)));
    }

    const cm = /^\/cases\/([^/]+)(\/documents)?$/.exec(path);
    if (cm) {
      const c = cases.find((x) => x.id === decodeURIComponent(cm[1]));
      if (!c) return json(404, { error: '找不到案件' });
      if (cm[2]) {
        if (method === 'GET') return json(200, docs.filter((d) => d.caseId === c.id));
        const size = ctx.rawBody instanceof Blob ? ctx.rawBody.size : 0;
        if (!size) return json(400, { error: '文件不能为空' });
        if (size > 10 * 1024 * 1024) return json(400, { error: '文件不能超过 10 MB' });
        const d = {
          id: crypto.randomUUID(),
          caseId: c.id,
          filename: url.searchParams.get('filename') ?? 'file',
          kind: url.searchParams.get('kind') ?? '其他',
          uploadedBy: ctx.me.email,
          uploadedAt: new Date().toISOString(),
        };
        docs.push(d);
        return json(201, d);
      }
      if (method === 'PATCH') return patchCase(c, ctx);
      return json(200, { ...c, commission: commissions.get(c.id) ?? null, history: history.get(c.id) ?? [] });
    }

    if (path === '/commissions') {
      const pid = url.searchParams.get('partnerId');
      const month = url.searchParams.get('month');
      return json(
        200,
        cases
          .filter((c) => (!pid || c.partnerId === pid) && (!month || monthOf(c) === month))
          .flatMap((c) => {
            const k = commissions.get(c.id);
            return k
              ? [{ caseId: c.id, clientName: c.clientName, partnerId: c.partnerId, code: k.code, amount: k.amount, basis: k.basis, status: k.status, paidAt: k.paidAt, paidBy: k.paidBy }]
              : [];
          }),
      );
    }

    const pm = /^\/commissions\/([^/]+)\/mark-paid$/.exec(path);
    if (pm && method === 'POST') {
      if (settings.commissionRules.paidMarkedBy === 'admin' && !isAdmin) return json(403, { error: '没有权限' });
      const k = commissions.get(decodeURIComponent(pm[1]));
      if (!k) return json(404, { error: '找不到佣金' });
      if (k.code === 'B1') return json(400, { error: '此佣金不能标记为已支付' });
      if (k.status !== '可发放') return json(400, { error: '佣金尚未可发放' });
      Object.assign(k, { status: '已支付', paidAt: new Date().toISOString(), paidBy: ctx.me.email });
      return json(200, k);
    }

    if (path === '/reports/monthly') {
      const month = url.searchParams.get('month') ?? '';
      return json(
        200,
        partners.flatMap((p) => {
          const mine = cases.filter((c) => c.partnerId === p.id && monthOf(c) === month);
          if (!mine.length) return [];
          const live = mine.filter((c) => !c.cancelled);
          return [
            {
              partnerId: p.id, name: p.name, company: p.company, code: p.code, cases: live.length,
              revenue: round2(live.reduce((a, c) => a + (c.price ?? 0), 0)),
              commission: round2(mine.reduce((a, c) => a + (commissions.get(c.id)?.code !== 'B1' ? (commissions.get(c.id)?.amount ?? 0) : 0), 0)),
              b1Owed: round2(mine.reduce((a, c) => a + (commissions.get(c.id)?.code === 'B1' ? commissions.get(c.id)!.amount : 0), 0)),
            },
          ];
        }),
      );
    }

    const stm = /^\/statements\/([^/]+)\/([^/]+)$/.exec(path);
    if (stm) {
      const p = partners.find((x) => x.id === decodeURIComponent(stm[1]));
      if (!p) return json(404, { error: '找不到伙伴' });
      const lines = cases
        .filter((c) => c.partnerId === p.id && monthOf(c) === stm[2] && commissions.has(c.id))
        .map((c) => {
          const k = commissions.get(c.id)!;
          return { caseId: c.id, clientName: c.clientName, licence: c.licenceType, submittedAt: c.submittedAt, code: k.code, amount: k.amount, basis: k.basis, status: k.status };
        });
      return json(200, {
        partner: { id: p.id, name: p.name, company: p.company, code: p.code },
        month: stm[2],
        lines,
        totalCommission: round2(lines.filter((l) => l.code !== 'B1').reduce((a, l) => a + l.amount, 0)),
        totalB1: round2(lines.filter((l) => l.code === 'B1').reduce((a, l) => a + l.amount, 0)),
      });
    }

    if (/^\/documents\/[^/]+\/download$/.test(path)) return json(404, { error: '演示模式：没有真实文件' });
    return null;
  };
}
