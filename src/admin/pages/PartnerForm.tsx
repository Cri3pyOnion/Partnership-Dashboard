import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isEmail, normalizePhone, normalizeTin } from '../../shared/validate';
import type { Partner, PartnerCode, Source, Team } from '../../shared/types';
import { ApiError, api, errorText } from '../api';
import { useMe } from '../me';
import { StaffSelect, useStaffDirectory } from '../staff-directory';

interface Values {
  filledBy: Team;
  name: string;
  phone: string; // the part after +60
  email: string;
  tin: string;
  company: string;
  code: PartnerCode | '';
  referralName: string;
  source: Source | '';
  bankName: string;
  bankAccount: string;
  assignedStaff: string; // '' = unassigned
}

const CODES: Array<{ code: PartnerCode; text: string }> = [
  { code: 'A1', text: '仅佣金 RM100–150' },
  { code: 'B1', text: '伙伴直接对接客户，自行开账单' },
  { code: 'C1', text: '加价佣金' },
];

const BLANK: Values = {
  filledBy: 'Transmission',
  name: '',
  phone: '',
  email: '',
  tin: '',
  company: '',
  code: '',
  referralName: '',
  source: '',
  bankName: '',
  bankAccount: '',
  assignedStaff: '',
};

function fromPartner(p: Partner): Values {
  return {
    filledBy: p.filledBy,
    name: p.name,
    phone: p.phone.replace(/^\+60/, ''),
    email: p.email,
    tin: p.tin ?? '',
    company: p.company ?? '',
    code: p.code,
    referralName: p.referralName ?? '',
    source: p.source ?? '',
    bankName: p.bankName ?? '',
    bankAccount: p.bankAccount ?? '',
    assignedStaff: p.assignedStaff ?? '',
  };
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Checks the values; returns the payload when valid, otherwise the red fields. */
function check(v: Values): { errors: Record<string, string>; payload?: Record<string, unknown> } {
  const errors: Record<string, string> = {};
  const phone = normalizePhone('+60' + v.phone);
  if (!v.name.trim()) errors.name = '请填写姓名';
  if (!phone) errors.phone = '电话号码格式不正确';
  if (!isEmail(v.email.trim())) errors.email = '电邮格式不正确';
  const tin = v.tin.trim() ? normalizeTin(v.tin) : null;
  if (v.tin.trim() && !tin) errors.tin = '税号格式不正确';
  if (!v.code) errors.code = '请选择伙伴代码';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    payload: {
      filledBy: v.filledBy,
      name: v.name.trim(),
      phone,
      email: v.email.trim(),
      tin,
      company: orNull(v.company),
      code: v.code,
      referralName: orNull(v.referralName),
      source: v.source || null,
      bankName: orNull(v.bankName),
      bankAccount: orNull(v.bankAccount),
      assignedStaff: v.assignedStaff || null,
    },
  };
}

function Field({ id, label, en, required, error, hint, children }: { id: string; label: string; en?: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {en && <span className="en"> {en}</span>}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function PartnerForm({ partner, onSaved, onCancel }: { partner?: Partner; onSaved?: (p: Partner) => void; onCancel?: () => void }) {
  const navigate = useNavigate();
  const editing = partner !== undefined;
  const me = useMe();
  const staff = useStaffDirectory();
  // A new partner is assigned to the person registering them unless they pick someone else.
  const blank = (): Values => ({ ...BLANK, assignedStaff: me?.email.toLowerCase() ?? '' });
  const [v, setV] = useState<Values>(partner ? fromPartner(partner) : blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setV((x) => ({ ...x, [k]: val }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };
  const bad = (k: string) => (errors[k] ? true : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const { errors: errs, payload } = check(v);
    if (!payload) {
      setErrors(errs);
      const parts: string[] = [];
      if (Object.keys(errs).some((k) => k !== 'code')) parts.push('请检查红色栏位');
      if (errs.code) parts.push('请选择伙伴代码');
      setSummary(parts.join(' · '));
      return;
    }
    setErrors({});
    setSummary(null);

    let send: Record<string, unknown> = payload;
    if (partner) {
      send = {};
      const current = partner as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(payload)) if (val !== current[k]) send[k] = val;
      if (Object.keys(send).length === 0) {
        setSummary('没有修改任何内容');
        return;
      }
    }

    setBusy(true);
    try {
      if (partner) {
        const saved = await api.patch<Partner>(`/api/admin/partners/${partner.id}`, send);
        onSaved?.(saved);
      } else {
        const created = await api.post<Partner>('/api/admin/partners', send);
        navigate(`/partners/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setSummary(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const teams: Team[] = v.filledBy === 'IT' ? ['Transmission', '市场部', 'IT'] : ['Transmission', '市场部'];

  return (
    <form className="form" onSubmit={submit} noValidate>
      <fieldset className="field">
        <legend>填写团队</legend>
        <div className="toggle">
          {teams.map((t) => (
            <label key={t} className={v.filledBy === t ? 'on' : undefined}>
              <input type="radio" name="filledBy" value={t} checked={v.filledBy === t} onChange={() => set('filledBy', t)} />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <Field id="f-staff" label="负责员工" en="Staff in charge" error={errors.assignedStaff} hint="新案件默认交给这位员工">
        <StaffSelect id="f-staff" label="负责员工" value={v.assignedStaff} list={staff} invalid={bad('assignedStaff')} onChange={(x) => set('assignedStaff', x)} />
      </Field>

      <Field id="f-name" label="姓名" en="Name" required error={errors.name}>
        <input id="f-name" value={v.name} aria-invalid={bad('name')} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
      </Field>

      <Field id="f-phone" label="电话号码" en="Phone Number" required error={errors.phone}>
        <div className="phone">
          <span className="prefix">+60</span>
          <input id="f-phone" type="tel" inputMode="tel" placeholder="12-345 6789" value={v.phone} aria-invalid={bad('phone')} onChange={(e) => set('phone', e.target.value)} />
        </div>
      </Field>

      <Field id="f-email" label="电邮" en="Email" required error={errors.email}>
        <input id="f-email" type="email" value={v.email} aria-invalid={bad('email')} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
      </Field>

      <Field id="f-tin" label="税号" en="TIN" error={errors.tin} hint="个人以 IG 开头，公司以 C 开头（LHDN 税号）">
        <input id="f-tin" value={v.tin} aria-invalid={bad('tin')} onChange={(e) => set('tin', e.target.value)} autoComplete="off" />
      </Field>

      <Field id="f-company" label="公司名称" en="Company Name" error={errors.company}>
        <input id="f-company" value={v.company} aria-invalid={bad('company')} onChange={(e) => set('company', e.target.value)} />
      </Field>

      <fieldset className={`field${errors.code ? ' has-error' : ''}`}>
        <legend>
          伙伴代码<span className="req"> *</span>
        </legend>
        <div className="cards">
          {CODES.map((c) => (
            <label key={c.code} className={`card${v.code === c.code ? ' on' : ''}`}>
              <input type="radio" name="code" value={c.code} checked={v.code === c.code} onChange={() => set('code', c.code)} />
              <strong>{c.code}</strong>
              <span>{c.text}</span>
            </label>
          ))}
        </div>
        {errors.code && <p className="field-error">{errors.code}</p>}
      </fieldset>

      <Field id="f-ref" label="推荐人姓名" en="Referral Name" error={errors.referralName}>
        <input id="f-ref" value={v.referralName} aria-invalid={bad('referralName')} onChange={(e) => set('referralName', e.target.value)} />
      </Field>

      <Field id="f-source" label="来源" en="Source" error={errors.source}>
        <select id="f-source" value={v.source} aria-invalid={bad('source')} onChange={(e) => set('source', e.target.value as Source | '')}>
          <option value="">未选择</option>
          <option value="上门">上门</option>
          <option value="线上">线上</option>
        </select>
      </Field>

      <Field id="f-bank" label="银行名称" en="Bank（仅限内部 – internal only）" error={errors.bankName}>
        <input id="f-bank" value={v.bankName} aria-invalid={bad('bankName')} onChange={(e) => set('bankName', e.target.value)} />
      </Field>

      <Field id="f-acct" label="银行户口" en="Bank Account（仅限内部 – internal only）" error={errors.bankAccount}>
        <input id="f-acct" inputMode="numeric" value={v.bankAccount} aria-invalid={bad('bankAccount')} onChange={(e) => set('bankAccount', e.target.value)} autoComplete="off" />
      </Field>

      {summary && (
        <p className="banner error" role="alert">
          {summary}
        </p>
      )}

      <div className="actions">
        {editing ? (
          <>
            <button type="button" className="btn" onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              保存
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setV(blank());
                setErrors({});
                setSummary(null);
              }}
            >
              清空
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              提交登记
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/** The /partners/new page. */
export function PartnerNew() {
  return (
    <section>
      <div className="page-head">
        <h1>登记新伙伴</h1>
      </div>
      <PartnerForm />
    </section>
  );
}
