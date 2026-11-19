import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rm } from '../../shared/money';
import type { PartnerCode } from '../../shared/types';
import { Amount, B1_LABEL, B1_NOTE } from '../Amount';
import { ErrorBanner } from '../ErrorBanner';
import { api, errorText } from '../api';
import { klDate } from '../format';

interface Line {
  caseId: string;
  clientName: string;
  licence: string;
  submittedAt: string;
  amount: number;
  basis: string;
  status: string;
  pending?: true;
}

interface Data {
  partner: { id: string; name: string; company: string | null; code: PartnerCode };
  month: string;
  lines: Line[];
  total: number;
}

// The menu, the buttons and the page padding disappear on paper; the table fills the page.
const PRINT_CSS = `@media print {
  .topbar, .no-print { display: none !important; }
  .shell { display: block; }
  .content { padding: 0; max-width: none; }
  body { background: #fff; }
  .table-wrap { border: 0; overflow: visible; }
  table { min-width: 0; }
  th, td { white-space: normal; }
}`;

export function Statement() {
  const { partnerId = '', month = '' } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    api
      .get<Data>(`/api/admin/statements/${encodeURIComponent(partnerId)}/${encodeURIComponent(month)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [partnerId, month]);

  if (!data) {
    return (
      <section>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {!error && <p className="muted">载入中…</p>}
      </section>
    );
  }

  const { partner, lines } = data;
  const b1 = partner.code === 'B1' || lines.some((l) => l.status === '待付发票' || l.status === '已结清');

  return (
    <section>
      <style>{PRINT_CSS}</style>
      <div className="page-head no-print">
        <Link className="btn" to={`/commissions`}>
          返回佣金
        </Link>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          打印 / 保存为 PDF
        </button>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <header className="statement-head">
        <h1>月结单 Statement</h1>
        <p>
          <strong>{partner.name}</strong>
        </p>
        {partner.company && <p>{partner.company}</p>}
        <p className="muted">
          伙伴编号 {partner.id} · 代码 {partner.code} · 月份 {data.month}
        </p>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>案件编号</th>
              <th>客户</th>
              <th>类型</th>
              <th>提交日期</th>
              <th>依据</th>
              <th className="num">{b1 ? `金额（${B1_LABEL}）` : '佣金'}</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  这个月没有案件
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.caseId}>
                <td>{l.caseId}</td>
                <td>{l.clientName}</td>
                <td>{l.licence}</td>
                <td>{klDate(l.submittedAt)}</td>
                <td>{l.basis}</td>
                <td className="num">
                  <Amount amount={l.amount} code={partner.code === 'B1' ? 'B1' : undefined} pending={l.pending} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={5}>合计 Total</th>
              <th className="num" data-testid="total">
                {rm(data.total)}
              </th>
            </tr>
          </tfoot>
        </table>
      </div>
      {b1 && <p className="footnote">{B1_NOTE}</p>}
    </section>
  );
}
