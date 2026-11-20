import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CASE_STEPS, STEP_CANCELLED } from '../../shared/status';
import { rm } from '../../shared/money';
import type { Case, Partner } from '../../shared/types';
import { api, errorText, peekRead } from '../api';
import { ErrorBanner } from '../ErrorBanner';
import { klDate } from '../format';
import { staffName, useStaffDirectory } from '../staff-directory';

export function Cases() {
  const [params, setParams] = useSearchParams();
  const partnerId = params.get('partnerId') ?? '';
  const step = params.get('step') ?? '';
  const month = params.get('month') ?? '';
  const handler = params.get('handledBy') ?? '';
  const staff = useStaffDirectory();
  const [rows, setRows] = useState<Case[] | null>(null);
  const [partners, setPartners] = useState<Partner[]>(() => peekRead<Partner[]>('/api/admin/partners') ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Partner[]>('/api/admin/partners')
      .then(setPartners)
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams();
    if (partnerId) qs.set('partnerId', partnerId);
    if (step) qs.set('step', step);
    if (month) qs.set('month', month);
    if (handler) qs.set('handledBy', handler);
    const url = `/api/admin/cases${qs.size ? `?${qs}` : ''}`;
    setRows(peekRead<Case[]>(url));
    api
      .get<Case[]>(url)
      .then((r) => live && setRows(r))
      .catch((e) => live && (setError(errorText(e)), setRows([])));
    return () => {
      live = false;
    };
  }, [partnerId, step, month, handler]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const nameOf = (id: string) => partners.find((p) => p.id === id)?.name ?? id;

  return (
    <section>
      <div className="page-head">
        <h1 data-en="Cases">案件</h1>
        <Link className="btn primary" to="/cases/new">
          新增案件
        </Link>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <div className="filters">
        <select aria-label="伙伴" value={partnerId} onChange={(e) => setFilter('partnerId', e.target.value)}>
          <option value="">全部伙伴</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} {p.name}
            </option>
          ))}
        </select>
        <select aria-label="进度" value={step} onChange={(e) => setFilter('step', e.target.value)}>
          <option value="">全部进度</option>
          {CASE_STEPS.map((s, i) => (
            <option key={s} value={String(i)}>
              {s}
            </option>
          ))}
        </select>
        <select aria-label="处理员工" value={handler} onChange={(e) => setFilter('handledBy', e.target.value)}>
          <option value="">全部员工</option>
          <option value="me">我负责的</option>
          {staff.map((s) => (
            <option key={s.email} value={s.email}>
              {s.name}
            </option>
          ))}
        </select>
        <input type="month" aria-label="月份" value={month} onChange={(e) => setFilter('month', e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['案件编号', '客户', '伙伴', '执照类型', '处理员工', '进度', '提交日期', '价格'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={8} className="muted">
                  载入中…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  没有符合条件的案件
                </td>
              </tr>
            )}
            {rows?.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/cases/${c.id}`}>{c.id}</Link>
                </td>
                <td>{c.clientName}</td>
                <td>{nameOf(c.partnerId)}</td>
                <td>{c.licenceType}</td>
                <td>{staffName(staff, c.handledBy)}</td>
                <td>{c.cancelled ? STEP_CANCELLED : CASE_STEPS[c.step]}</td>
                <td>{klDate(c.submittedAt)}</td>
                <td>{c.price === null ? '—' : rm(c.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
