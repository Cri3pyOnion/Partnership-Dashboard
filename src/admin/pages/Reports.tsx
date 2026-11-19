import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rm } from '../../shared/money';
import type { Partner, PartnerCode } from '../../shared/types';
import { inactiveMessage, whatsappLink } from '../../shared/whatsapp';
import { B1_LABEL, B1_NOTE } from '../Amount';
import { ErrorBanner } from '../ErrorBanner';
import { api, errorText } from '../api';
import { currentMonth } from '../format';

interface MonthRow {
  partnerId: string;
  name: string;
  company: string | null;
  code: PartnerCode;
  cases: number;
  revenue: number;
  commission: number;
  b1Owed: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function Reports() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [inactive, setInactive] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    if (!month) {
      setRows([]);
      return;
    }
    api
      .get<MonthRow[]>(`/api/admin/reports/monthly?month=${encodeURIComponent(month)}`)
      .then((r) => live && setRows(r))
      .catch((e) => live && (setError(errorText(e)), setRows([])));
    return () => {
      live = false;
    };
  }, [month]);

  useEffect(() => {
    let live = true;
    api
      .get<Partner[]>('/api/admin/partners/inactive')
      .then((r) => live && setInactive(r))
      .catch((e) => live && (setError(errorText(e)), setInactive([])));
    return () => {
      live = false;
    };
  }, []);

  const list = rows ?? [];
  // B1 amounts are owed to Toh's Sign, so they never join the commission total.
  const totalCases = list.reduce((s, r) => s + r.cases, 0);
  const totalRevenue = round2(list.reduce((s, r) => s + r.revenue, 0));
  const totalCommission = round2(list.reduce((s, r) => s + r.commission, 0));
  const totalB1 = round2(list.reduce((s, r) => s + r.b1Owed, 0));
  const hasB1 = list.some((r) => r.b1Owed > 0);

  return (
    <section>
      <div className="page-head">
        <h1>报表</h1>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <h2>每月伙伴报表</h2>
      <div className="filters">
        <input type="month" aria-label="月份" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>伙伴</th>
              <th>代码</th>
              <th className="num">案件数</th>
              <th className="num">营业额</th>
              <th className="num">佣金</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={6} className="muted">
                  载入中…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  这个月没有案件
                </td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.partnerId}>
                <td>
                  <Link to={`/partners/${r.partnerId}`}>{r.name}</Link>
                  {r.company && <span className="muted"> {r.company}</span>}
                </td>
                <td>{r.code}</td>
                <td className="num">{r.cases}</td>
                <td className="num">{rm(r.revenue)}</td>
                <td className="num">
                  {rm(r.commission)}
                  {r.b1Owed > 0 && (
                    <div>
                      {rm(r.b1Owed)}
                      <span className="tag b1">{B1_LABEL}</span>
                    </div>
                  )}
                </td>
                <td>
                  <Link to={`/statements/${r.partnerId}/${month}`}>结单</Link>
                </td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr>
                <th colSpan={2}>合计</th>
                <th className="num">{totalCases}</th>
                <th className="num">{rm(totalRevenue)}</th>
                <th className="num">
                  <span data-testid="total-commission">{rm(totalCommission)}</span>
                </th>
                <th />
              </tr>
              {hasB1 && (
                <tr>
                  <th colSpan={4}>B1 {B1_LABEL}（另计）</th>
                  <th className="num">
                    <span data-testid="total-b1">{rm(totalB1)}</span>
                  </th>
                  <th />
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
      {hasB1 && <p className="footnote">{B1_NOTE}</p>}

      <h2>不活跃伙伴</h2>
      <p className="hint">活跃伙伴很久没有新案件时会列在这里。</p>
      {inactive === null && <p className="muted">载入中…</p>}
      {inactive?.length === 0 && <p className="muted">没有需要联系的伙伴</p>}
      {inactive && inactive.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>伙伴</th>
                <th>电话号码</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inactive.map((p) => {
                const wa = whatsappLink(p.phone, inactiveMessage(p));
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/partners/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.phone}</td>
                    <td>
                      {wa ? (
                        <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">
                          WhatsApp
                        </a>
                      ) : (
                        <span className="muted">电话无效</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
