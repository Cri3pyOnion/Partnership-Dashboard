import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Partner, PartnerStatus } from '../../shared/types';
import { api, errorText } from '../api';
import { ErrorBanner } from '../ErrorBanner';
import { klDate } from '../format';

const STATUSES: PartnerStatus[] = ['待审核', '活跃', '不活跃'];

export function Partners() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
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
    setRows(null);
    api
      .get<Partner[]>(`/api/admin/partners${qs.size ? `?${qs}` : ''}`)
      .then((r) => live && setRows(r))
      .catch((e) => live && (setError(errorText(e)), setRows([])));
    return () => {
      live = false;
    };
  }, [status, q]);

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
        <input type="search" aria-label="搜索" placeholder="搜索编号、姓名、公司、电话" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['伙伴编号', '姓名', '电话', '电邮', '公司名称', '代码', '推荐人', '填写团队', '登记日期', '状态'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={10} className="muted">
                  载入中…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
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
