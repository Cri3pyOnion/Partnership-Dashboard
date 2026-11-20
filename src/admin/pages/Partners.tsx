import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Partner, PartnerStatus } from '../../shared/types';
import { api, errorText, peekRead } from '../api';
import { ErrorBanner } from '../ErrorBanner';
import { klDate } from '../format';
import { staffName, useStaffDirectory } from '../staff-directory';

const STATUSES: PartnerStatus[] = ['待审核', '活跃', '不活跃'];

export function Partners() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const owner = params.get('assignedStaff') ?? '';
  const staff = useStaffDirectory();
  const [text, setText] = useState(q);
  const [rows, setRows] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search as you type, but wait a moment so every key does not hit the server.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim()) next.set('q', text.trim());
      else next.delete('q');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [text, q, params, setParams]);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (q) qs.set('q', q);
    if (owner) qs.set('assignedStaff', owner);
    const url = `/api/admin/partners${qs.size ? `?${qs}` : ''}`;
    // Last time's rows for this exact search show at once; fresh ones replace them when they arrive.
    setRows(peekRead<Partner[]>(url));
    api
      .get<Partner[]>(url)
      .then((r) => live && setRows(r))
      .catch((e) => live && (setError(errorText(e)), setRows([])));
    return () => {
      live = false;
    };
  }, [status, q, owner]);

  return (
    <section>
      <div className="page-head">
        <h1>伙伴</h1>
        <Link className="btn primary" to="/partners/new">
          登记新伙伴
        </Link>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <div className="filters">
        <label>
          <span className="sr">状态</span>
          <select
            aria-label="状态"
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              setParams(next, { replace: true });
            }}
          >
            <option value="">全部状态</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="负责员工"
          value={owner}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('assignedStaff', e.target.value);
            else next.delete('assignedStaff');
            setParams(next, { replace: true });
          }}
        >
          <option value="">全部员工</option>
          <option value="me">我负责的</option>
          {staff.map((s) => (
            <option key={s.email} value={s.email}>
              {s.name}
            </option>
          ))}
        </select>
        <input type="search" aria-label="搜索" placeholder="搜索编号、姓名、公司、电话" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['伙伴编号', '姓名', '电话', '电邮', '公司名称', '代码', '推荐人', '填写团队', '负责员工', '登记日期', '状态'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={11} className="muted">
                  载入中…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  没有符合条件的伙伴
                </td>
              </tr>
            )}
            {rows?.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/partners/${p.id}`}>{p.id}</Link>
                </td>
                <td>
                  <Link to={`/partners/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.phone}</td>
                <td>{p.email}</td>
                <td>{p.company ?? '—'}</td>
                <td>{p.code}</td>
                <td>{p.referralName ?? '—'}</td>
                <td>{p.filledBy}</td>
                <td>{staffName(staff, p.assignedStaff)}</td>
                <td>{klDate(p.registeredAt)}</td>
                <td>
                  <span className={`pill s-${p.status}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
