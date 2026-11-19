import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rm } from '../../shared/money';
import type { PartnerCode } from '../../shared/types';
import { Amount, B1_NOTE } from '../Amount';
import { ErrorBanner } from '../ErrorBanner';
import { api, errorText } from '../api';
import { klDate } from '../format';

interface Line {
  caseId: string;
  clientName: string;
  licence: string;
  submittedAt: string;
  amount: number;
  code: PartnerCode;
  basis: string;
  status: string;
  cancelled: boolean;
  pending?: true;
}

interface Data {
  partner: { id: string; name: string; company: string | null; code: PartnerCode };
  month: string;
  lines: Line[];
  /** A1/C1 paid and still due; B1 settled and still owed. Never summed together. */
  totals: { commissionPaid: number; commissionPending: number; b1Settled: number; b1Owed: number };
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

  const { partner, lines, totals } = data;
  // Each line is labelled by its own commission code, which was frozen when it was calculated.
  const hasB1 = lines.some((l) => l.code === 'B1');
  const hasPaid = lines.some((l) => l.code !== 'B1');

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
      <div className="no-print">
        <ErrorBanner message={error} onClose={() => setError(null)} />
      </div>

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
              <th>状态</th>
              <th className="num">金额</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
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
                <td>
                  {l.status}
                  {l.cancelled && <span className="muted"> · 已取消</span>}
                </td>
                <td className="num">
                  <Amount amount={l.amount} code={l.code} pending={l.pending} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {(hasPaid || !hasB1) && (
              <>
                <tr>
                  <th colSpan={6}>佣金 已支付 Paid to partner</th>
                  <th className="num" data-testid="total-commission-paid">
                    {rm(totals.commissionPaid)}
                  </th>
                </tr>
                <tr>
                  <th colSpan={6}>佣金 待发 Pending (待处理 + 可发放)</th>
                  <th className="num" data-testid="total-commission-pending">
                    {rm(totals.commissionPending)}
                  </th>
                </tr>
              </>
            )}
            {hasB1 && (
              <>
                <tr>
                  <th colSpan={6}>{`伙伴应付 Toh's Sign 已结清 Settled`}</th>
                  <th className="num" data-testid="total-b1-settled">
                    {rm(totals.b1Settled)}
                  </th>
                </tr>
                <tr>
                  <th colSpan={6}>{`伙伴应付 Toh's Sign 待付 Owed (待付发票)`}</th>
                  <th className="num" data-testid="total-b1-owed">
                    {rm(totals.b1Owed)}
                  </th>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>
      {hasB1 && <p className="footnote">{B1_NOTE}</p>}
    </section>
  );
}
