import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { CommissionRules, Settings as SettingsData, Staff, Team } from '../../shared/types';
import { ErrorBanner } from '../ErrorBanner';
import { api, errorText } from '../api';

const TEAMS: Team[] = ['Transmission', '市场部', 'IT'];

interface Form {
  threshold: string;
  below: string;
  above: string;
  percent: string;
  collect: boolean;
  maxMarkup: string;
  paidBy: 'admin' | 'staff';
  licences: string;
  inactiveDays: string;
}

function toForm(s: SettingsData): Form {
  const r = s.commissionRules;
  return {
    threshold: String(r.A1.threshold),
    below: String(r.A1.below),
    above: String(r.A1.above),
    percent: String(r.B1.partnerPricePercent),
    collect: r.B1.collectBeforeSubmit,
    maxMarkup: r.C1.maxMarkup === null ? '' : String(r.C1.maxMarkup),
    paidBy: r.paidMarkedBy,
    licences: s.licenceTypes.join('\n'),
    inactiveDays: String(s.inactiveDays),
  };
}

/** A number from the text, or null when it is blank or not a number (the server then names the field). */
const num = (t: string): number | null => {
  const s = t.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function toBody(f: Form) {
  const rules = {
    A1: { threshold: num(f.threshold), below: num(f.below), above: num(f.above) },
    B1: { partnerPricePercent: num(f.percent), collectBeforeSubmit: f.collect },
    C1: { maxMarkup: num(f.maxMarkup) },
    paidMarkedBy: f.paidBy,
  } as unknown as CommissionRules;
  return {
    commissionRules: rules,
    licenceTypes: f.licences.split('\n').map((x) => x.trim()).filter(Boolean),
    inactiveDays: num(f.inactiveDays),
  };
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

interface StaffEdit {
  isNew: boolean;
  email: string;
  name: string;
  role: 'admin' | 'staff';
  team: Team | '';
  active: boolean;
}

export function Settings() {
  const [form, setForm] = useState<Form | null>(null);
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<StaffEdit | null>(null);

  const loadStaff = useCallback(async () => {
    setStaff(await api.get<Staff[]>('/api/admin/staff'));
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([api.get<SettingsData>('/api/admin/settings'), api.get<Staff[]>('/api/admin/staff')])
      .then(([s, st]) => {
        if (!live) return;
        setForm(toForm(s));
        setStaff(st);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  if (!form) {
    return (
      <section>
        <h1>设置</h1>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {!error && <p className="muted">载入中…</p>}
      </section>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const fe = (k: string) => fields[k];

  async function saveSettings() {
    if (busy || !form) return;
    setBusy(true);
    setError(null);
    setFields({});
    setSaved(false);
    try {
      const next = await api.put<SettingsData>('/api/admin/settings', toBody(form));
      if (next && typeof next === 'object' && 'commissionRules' in next) setForm(toForm(next));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
      const f = (e as { fields?: Record<string, string> }).fields;
      if (f) setFields(f);
    } finally {
      setBusy(false);
    }
  }

  async function saveStaff(s: Staff) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/staff/${encodeURIComponent(s.email)}`, { name: s.name, role: s.role, team: s.team, active: s.active });
      await loadStaff();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const submitEdit = async () => {
    if (!edit) return;
    const ok = await saveStaff({
      email: edit.email.trim().toLowerCase(),
      name: edit.name.trim(),
      role: edit.role,
      team: edit.team === '' ? null : edit.team,
      active: edit.active,
    });
    if (ok) setEdit(null);
  };

  return (
    <section>
      <div className="page-head">
        <h1>设置</h1>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="panel">
        <h2>佣金规则</h2>
        <div className="grid2">
          <Field id="a1-th" label="A1 门槛 (RM)" error={fe('commissionRules.A1.threshold')}>
            <input id="a1-th" inputMode="decimal" value={form.threshold} onChange={(e) => set('threshold', e.target.value)} />
          </Field>
          <Field id="a1-lo" label="A1 低于门槛 (RM)" error={fe('commissionRules.A1.below')}>
            <input id="a1-lo" inputMode="decimal" value={form.below} onChange={(e) => set('below', e.target.value)} />
          </Field>
          <Field id="a1-hi" label="A1 达到门槛 (RM)" error={fe('commissionRules.A1.above')}>
            <input id="a1-hi" inputMode="decimal" value={form.above} onChange={(e) => set('above', e.target.value)} />
          </Field>
          <Field id="b1-pct" label="B1 伙伴价 (% 价格)" error={fe('commissionRules.B1.partnerPricePercent')}>
            <input id="b1-pct" inputMode="decimal" value={form.percent} onChange={(e) => set('percent', e.target.value)} />
          </Field>
          <Field id="c1-max" label="C1 加价上限 (RM，留空 = 不设上限)" error={fe('commissionRules.C1.maxMarkup')}>
            <input id="c1-max" inputMode="decimal" value={form.maxMarkup} onChange={(e) => set('maxMarkup', e.target.value)} />
          </Field>
          <Field id="paid-by" label="谁可以标记已支付" error={fe('commissionRules.paidMarkedBy')}>
            <select id="paid-by" value={form.paidBy} onChange={(e) => set('paidBy', e.target.value as 'admin' | 'staff')}>
              <option value="admin">仅管理员</option>
              <option value="staff">所有员工</option>
            </select>
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.collect} onChange={(e) => set('collect', e.target.checked)} />
          B1 案件需先结清才能递交
        </label>
        <p className="hint">新规则只会在案件下次更新时生效，已支付的佣金不会改变。</p>
      </div>

      <div className="panel">
        <h2>执照类型</h2>
        <Field id="licences" label="每行一个执照类型" error={fe('licenceTypes')}>
          <textarea id="licences" value={form.licences} onChange={(e) => set('licences', e.target.value)} />
        </Field>
        <h2>不活跃天数</h2>
        <Field id="inactive" label="多少天没有新案件算不活跃" error={fe('inactiveDays')}>
          <input id="inactive" inputMode="numeric" value={form.inactiveDays} onChange={(e) => set('inactiveDays', e.target.value)} />
        </Field>
      </div>

      <div className="toolbar">
        <button type="button" className="btn primary" disabled={busy} onClick={saveSettings}>
          保存设置
        </button>
        {saved && <span className="ok">已保存</span>}
      </div>

      <h2>员工</h2>
      <div className="toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => setEdit({ isNew: true, email: '', name: '', role: 'staff', team: '', active: true })}
        >
          新增员工
        </button>
      </div>

      {edit && (
        <div className="panel">
          <div className="grid2">
            <Field id="st-email" label="电邮">
              <input
                id="st-email"
                type="email"
                value={edit.email}
                disabled={!edit.isNew}
                onChange={(e) => setEdit({ ...edit, email: e.target.value })}
              />
            </Field>
            <Field id="st-name" label="姓名">
              <input id="st-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field id="st-role" label="角色">
              <select id="st-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as 'admin' | 'staff' })}>
                <option value="staff">员工</option>
                <option value="admin">管理员</option>
              </select>
            </Field>
            <Field id="st-team" label="团队">
              <select id="st-team" value={edit.team} onChange={(e) => setEdit({ ...edit, team: e.target.value as Team | '' })}>
                <option value="">无</option>
                {TEAMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={submitEdit}>
              保存员工
            </button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['电邮', '姓名', '角色', '团队', '状态', ''].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff === null && (
              <tr>
                <td colSpan={6} className="muted">
                  载入中…
                </td>
              </tr>
            )}
            {staff?.map((s) => (
              <tr key={s.email}>
                <td>{s.email}</td>
                <td>{s.name}</td>
                <td>{s.role === 'admin' ? '管理员' : '员工'}</td>
                <td>{s.team ?? '—'}</td>
                <td>{s.active ? '启用' : '已停用'}</td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setEdit({ isNew: false, email: s.email, name: s.name, role: s.role, team: s.team ?? '', active: s.active })
                      }
                    >
                      编辑
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => {
                        if (s.active && !window.confirm('确定停用？')) return;
                        void saveStaff({ ...s, active: !s.active });
                      }}>
                      {s.active ? '停用' : '启用'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
