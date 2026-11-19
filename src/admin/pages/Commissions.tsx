import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rm } from '../../shared/money';
import type { CommissionStatus, Partner, PartnerCode } from '../../shared/types';
import { Amount, B1_LABEL, B1_NOTE } from '../Amount';
import { ErrorBanner } from '../ErrorBanner';
import { api, errorText } from '../api';
import { currentMonth, klDateTime } from '../format';

interface Row {
  caseId: string;
  clientName: string;
  partnerId: string;
  code: PartnerCode;
  amount: number;
  basis: string;
  status: CommissionStatus;
  paidAt: string | null;
  paidBy: string | null;
  pending?: true;
}

const B1_STATUSES: CommissionStatus[] = ['待付发票', '已结清'];

export function Commissions() {
  const [month, setMonth] = useState(currentMonth());
  const [partnerId, setPartnerId] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Partner[]>('/api/admin/partners')
      .then(setPartners)
      .catch((e) => setError(errorText(e)));
  }, []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (month) qs.set('month', month);
    if (partnerId) qs.set('partnerId', partnerId);
    try {
      setRows(await api.get<Row[]>(`/api/admin/commissions${qs.size ? `?${qs}` : ''}`));
    } catch (e) {
      setError(errorText(e));
      setRows([]);
    }
  }, [month, partnerId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  /** Sends the amount on screen: the server refuses (409) if the recomputed amount is different. */
  async function markPaid(r: Row) {
    if (busy || !window.confirm(`确认标记 ${rm(r.amount)} 为已支付？此操作不可撤销。`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/commissions/${encodeURIComponent(r.caseId)}/mark-paid`, { expectedAmount: r.amount });
      await load();
    } catch (e) {
      setError(errorText(e));
      // The amount changed since the list loaded: show the new one so the admin can confirm it.
      if ((e as { status?: unknown })?.status === 409) await load();
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const sums = new Map<CommissionStatus, number>();
  for (const r of rows ?? []) sums.set(r.status, Math.round(((sums.get(r.status) ?? 0) + r.amount) * 100) / 100);
  const hasB1 = (rows ?? []).some((r) => r.code === 'B1');

  return (
    <section>
      <div className="page-head">
        <h1>佣金</h1>
        {partnerId && month && (
          <Link className="btn" to={`/statements/${encodeURIComponent(partnerId)}/${month}`}>
            查看结单
          </Link>
        )}
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <div className="filters">
        <input type="month" aria-label="月份" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select aria-label="伙伴" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          <option value="">全部伙伴</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="totals" role="group" aria-label="按状态合计">
        {[...sums.entries()].map(([status, total]) => (
          <div key={status}>
            <span>
              {status}
              {B1_STATUSES.includes(status) && <span className="tag b1">{B1_LABEL}</span>}
            </span>
            <strong>{rm(total)}</strong>
          </div>
        ))}
        {rows?.length === 0 && <span className="muted">这个月没有佣金记录</span>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['案件', '客户', '伙伴', '代码', '金额', '状态', '依据', ''].map((h, i) => (
                <th key={i}>{h}</th>
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
            {rows?.map((r) => (
              <tr key={r.caseId}>
                <td>
                  <Link to={`/cases/${r.caseId}`}>{r.caseId}</Link>
                </td>
                <td>{r.clientName}</td>
                <td>{nameOf(r.partnerId)}</td>
                <td>{r.code}</td>
                <td>
                  <Amount amount={r.amount} code={r.code} pending={r.pending} />
                </td>
                <td>
                  {r.status}
                  {r.paidAt && <span className="muted"> · {klDateTime(r.paidAt)}</span>}
                </td>
                <td className="muted">{r.basis}</td>
                <td>
                  {r.status === '可发放' && r.code !== 'B1' && (
                    <button type="button" className="btn" disabled={busy} onClick={() => markPaid(r)}>
                      标记已支付
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasB1 && <p className="footnote">{B1_NOTE}</p>}
    </section>
  );
}
