import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CASE_STEPS, STEP_CANCELLED } from '../../shared/status';
import type { Case, Partner, PartnerCode } from '../../shared/types';
import { linkMessage, whatsappLink } from '../../shared/whatsapp';
import { api, errorText } from '../api';
import { ErrorBanner } from '../ErrorBanner';
import { klDate, klDateTime } from '../format';
import { useMe } from '../me';
import { PartnerForm } from './PartnerForm';

interface Detail {
  partner: Partner;
  cases: Case[];
  recentViews: Array<{ viewedAt: string; country: string | null }>;
}

const CODE_TEXT: Record<PartnerCode, string> = { A1: 'A1 仅佣金', B1: 'B1 伙伴直接对接客户', C1: 'C1 加价佣金' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PartnerDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [code, setCode] = useState<PartnerCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const load = useCallback(async () => {
    try {
      const d = await api.get<Detail>(`/api/admin/partners/${encodeURIComponent(id)}`);
      setData(d);
      setCode(d.partner.code);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    setFreshLink(null);
    setEditing(false);
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <section>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {!error && <p className="muted">载入中…</p>}
      </section>
    );
  }

  const { partner, cases, recentViews } = data;
  const isAdmin = me?.role === 'admin';
  // Shown on screen only; never logged.
  const link = freshLink ?? (partner.viewToken ? `${location.origin}/p/${partner.viewToken}` : null);
  const base = `/api/admin/partners/${partner.id}`;

  const approve = () =>
    run(async () => {
      const r = await api.post<{ link: string }>(`${base}/approve`);
      setFreshLink(r.link);
      await load();
    });

  const reset = () => {
    if (!window.confirm('旧链接将立即失效，确定重置？')) return;
    return run(async () => {
      const r = await api.post<{ link: string }>(`${base}/reset-link`);
      setFreshLink(r.link);
      await load();
    });
  };

  const changeCode = () =>
    run(async () => {
      await api.patch(base, { code });
      await load();
    });

  const deactivate = () => {
    if (!window.confirm('确定设为不活跃？')) return;
    return run(async () => {
      await api.patch(base, { status: '不活跃' });
      await load();
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('无法复制，请手动选取链接');
    }
  };

  return (
    <section>
      <div className="page-head">
        <h1>
          {partner.name} <span className="muted">{partner.id}</span>
        </h1>
        <span className={`pill s-${partner.status}`}>{partner.status}</span>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="toolbar">
        {isAdmin && (partner.status === '待审核' || partner.status === '不活跃') && (
          <button type="button" className="btn primary" disabled={busy} onClick={approve}>
            批准
          </button>
        )}
        {link && (
          <>
            <button type="button" className="btn" onClick={copy}>
              复制链接
            </button>
            <a className="btn" href={whatsappLink(partner.phone, linkMessage(partner, link))} target="_blank" rel="noopener noreferrer">
              发送链接 WhatsApp
            </a>
            <button type="button" className="btn" disabled={busy} onClick={reset}>
              重置链接
            </button>
          </>
        )}
        {partner.status !== '不活跃' && (
          <button type="button" className="btn danger" disabled={busy} onClick={deactivate}>
            设为不活跃
          </button>
        )}
        {!editing && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            编辑
          </button>
        )}
      </div>

      {link && (
        <p className="link-box">
          <span className="sr">伙伴链接</span>
          <code>{link}</code>
          {copied && <span className="ok"> 已复制</span>}
        </p>
      )}

      {editing ? (
        <PartnerForm
          partner={partner}
          onCancel={() => setEditing(false)}
          onSaved={(p) => {
            setData({ ...data, partner: p });
            setEditing(false);
            void load();
          }}
        />
      ) : (
        <dl className="details">
          <Row label="填写团队">{partner.filledBy}</Row>
          <Row label="电话号码">{partner.phone}</Row>
          <Row label="电邮">{partner.email}</Row>
          <Row label="税号">{partner.tin ?? '—'}</Row>
          <Row label="公司名称">{partner.company ?? '—'}</Row>
          <Row label="伙伴代码">{CODE_TEXT[partner.code]}</Row>
          <Row label="推荐人姓名">{partner.referralName ?? '—'}</Row>
          <Row label="来源">{partner.source ?? '—'}</Row>
          <Row label="登记日期">{klDate(partner.registeredAt)}</Row>
          <Row label="银行名称（仅限内部 – internal only）">{partner.bankName ?? '—'}</Row>
          <Row label="银行户口（仅限内部 – internal only）">{partner.bankAccount ?? '—'}</Row>
        </dl>
      )}

      <div className="inline-form">
        <label htmlFor="chg-code">更改代码</label>
        <select id="chg-code" value={code ?? partner.code} onChange={(e) => setCode(e.target.value as PartnerCode)}>
          {(['A1', 'B1', 'C1'] as const).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={busy || code === partner.code} onClick={changeCode}>
          确认更改
        </button>
      </div>

      <h2>案件</h2>
      {cases.length === 0 ? (
        <p className="muted">还没有案件</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>案件编号</th>
                <th>客户</th>
                <th>类型</th>
                <th>进度</th>
                <th>提交日期</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cases/${c.id}`}>{c.id}</Link>
                  </td>
                  <td>{c.clientName}</td>
                  <td>{c.licenceType}</td>
                  <td>{c.cancelled ? STEP_CANCELLED : CASE_STEPS[c.step]}</td>
                  <td>{klDate(c.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>最近链接浏览</h2>
      {recentViews.length === 0 ? (
        <p className="muted">还没有人打开过链接</p>
      ) : (
        <ul className="plain">
          {recentViews.map((v, i) => (
            <li key={`${v.viewedAt}-${i}`}>
              {klDateTime(v.viewedAt)} · <span>{v.country ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
