import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CASE_STEPS, STEP_CANCELLED } from '../../shared/status';
import type { Case, CaseDocument, Commission, Partner } from '../../shared/types';
import { caseUpdateMessage, whatsappLink } from '../../shared/whatsapp';
import { Amount } from '../Amount';
import { ErrorBanner } from '../ErrorBanner';
import { api, errorText } from '../api';
import { klDate, klDateTime } from '../format';
import { compressImage } from '../lib/compress-image';
import { StaffSelect, staffName, useStaffDirectory } from '../staff-directory';

interface Detail extends Case {
  commission: Commission | null;
  history: Array<{ step: number; changedAt: string; changedBy: string | null }>;
}

type PublicDoc = Omit<CaseDocument, 'storagePath'>;

const KINDS = ['SSM', 'IC', '租约', '店面照片', '其他'];
const MAX_BYTES = 10 * 1024 * 1024;

const numText = (n: number | null) => (n === null ? '' : String(n));

/** '' is null; otherwise a finite number of at least 0, or undefined when the text is not one. */
function parseMoney(t: string): number | null | undefined {
  const s = t.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function CaseDetail() {
  const { id = '' } = useParams();
  const base = `/api/admin/cases/${encodeURIComponent(id)}`;
  const [data, setData] = useState<Detail | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [docs, setDocs] = useState<PublicDoc[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState('');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');
  const [markup, setMarkup] = useState('');
  const [invoice, setInvoice] = useState('');
  const [kind, setKind] = useState(KINDS[0]);
  const [handler, setHandler] = useState('');
  const staff = useStaffDirectory();
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setDocs(await api.get<PublicDoc[]>(`${base}/documents`));
  }, [base]);

  const load = useCallback(
    async (commissionPending?: boolean) => {
      try {
        const d = await api.get<Detail>(base);
        setData(d);
        setPending(commissionPending === true || d.commission === null);
        setMissing(d.missingDocs ?? '');
        setNotes(d.notesInternal ?? '');
        setPrice(numText(d.price));
        setMarkup(numText(d.markup));
        setInvoice(d.invoiceNo ?? '');
        setHandler(d.handledBy ?? '');
        const [p] = await Promise.all([api.get<{ partner: Partner }>(`/api/admin/partners/${encodeURIComponent(d.partnerId)}`), loadDocs()]);
        setPartner(p.partner);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [base, loadDocs],
  );

  useEffect(() => {
    setData(null);
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

  /** One PATCH, then a reload so the commission and history are what the server now holds. */
  const save = (body: Record<string, unknown>) =>
    run(async () => {
      const r = await api.patch<{ commissionPending?: boolean }>(base, body);
      await load(r?.commissionPending === true);
    });

  if (!data) {
    return (
      <section>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {!error && <p className="muted">载入中…</p>}
      </section>
    );
  }

  const code = data.commission?.code ?? partner?.code;
  const link = partner?.viewToken ? `${location.origin}/p/${partner.viewToken}` : null;
  const wa = link && partner ? whatsappLink(partner.phone, caseUpdateMessage(data, link)) : '';

  const savePayment = () => {
    const body: Record<string, unknown> = {};
    const p = parseMoney(price);
    if (p === undefined) return setError('价格不是有效金额');
    if (p !== data.price) body.price = p;
    if (code === 'C1') {
      const m = parseMoney(markup);
      if (m === undefined) return setError('加价不是有效金额');
      if (m !== data.markup) body.markup = m;
    }
    const inv = invoice.trim() === '' ? null : invoice.trim();
    if (inv !== data.invoiceNo) body.invoiceNo = inv;
    if (Object.keys(body).length === 0) return setError('没有需要保存的更改');
    return save(body);
  };

  const cancelCase = () => {
    if (!window.confirm('确定取消此案件？')) return;
    return save({ cancelled: true });
  };

  const upload = () =>
    run(async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw { error: '请先选择文件' };
      const blob = await compressImage(file);
      if (blob.size > MAX_BYTES) throw { error: '文件不能超过 10 MB' };
      // A phone may give HEIC an empty type; the extension then says what it is.
      const heic = /\.(heic|heif)$/i.test(file.name) ? 'image/heic' : '';
      const type = blob.type || file.type || heic;
      if (!type) throw { error: '只接受图片或 PDF' };
      // A shrunk photo is always a JPEG, so its name says so.
      const name = type === 'image/jpeg' && blob !== file ? `${file.name.replace(/\.[^./\\]*$/, '')}.jpg` : file.name;
      const res = await api.raw(`${base}/documents?filename=${encodeURIComponent(name)}&kind=${encodeURIComponent(kind)}`, {
        method: 'PUT',
        headers: { 'Content-Type': type },
        body: blob,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw { error: typeof b.error === 'string' && b.error ? b.error : `上传失败（${res.status}）` };
      }
      if (fileRef.current) fileRef.current.value = '';
      await loadDocs();
    });

  return (
    <section>
      <div className="page-head">
        <h1>
          {data.id} <span className="muted">{data.clientName}</span>
        </h1>
        {data.cancelled && <span className="pill">{STEP_CANCELLED}</span>}
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="steps" role="group" aria-label="进度">
        {CASE_STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`btn${!data.cancelled && data.step === i ? ' on' : ''}`}
            aria-pressed={!data.cancelled && data.step === i}
            disabled={busy}
            onClick={() => save({ step: i })}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="toolbar">
        {wa ? (
          <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">
            发送进度 WhatsApp
          </a>
        ) : (
          <>
            <button type="button" className="btn" disabled>
              发送进度 WhatsApp
            </button>
            <span className="hint">{link ? '伙伴电话号码无效' : '伙伴尚未批准'}</span>
          </>
        )}
        {data.cancelled ? (
          <button type="button" className="btn" disabled={busy} onClick={() => save({ cancelled: false })}>
            恢复案件
          </button>
        ) : (
          <button type="button" className="btn danger" disabled={busy} onClick={cancelCase}>
            取消案件
          </button>
        )}
      </div>

      <dl className="details">
        <Row label="伙伴">
          <Link to={`/partners/${data.partnerId}`}>{partner?.name ?? data.partnerId}</Link>
        </Row>
        <Row label="处理员工">
          <span className="inline-form">
            <StaffSelect id="handler" label="处理员工" value={handler} list={staff} onChange={setHandler} />
            <button
              type="button"
              className="btn"
              disabled={busy || handler === (data.handledBy ?? '')}
              onClick={() => save({ handledBy: handler || null })}
            >
              更改
            </button>
            {partner && partner.assignedStaff !== data.handledBy && (
              <span className="muted"> 伙伴负责员工：{staffName(staff, partner.assignedStaff)}</span>
            )}
          </span>
        </Row>
        <Row label="客户电话">{data.clientPhone ?? '—'}</Row>
        <Row label="执照类型">{data.licenceType}</Row>
        <Row label="州属局">{data.council ?? '—'}</Row>
        <Row label="提交日期">{klDate(data.submittedAt)}</Row>
        <Row label="佣金">
          {data.commission ? (
            <>
              <Amount amount={data.commission.amount} code={data.commission.code} pending={pending} />
              <span className="muted"> · {data.commission.status}</span>
              <div className="hint">{data.commission.basis}</div>
            </>
          ) : (
            <span className="tag pending">佣金待计算</span>
          )}
        </Row>
      </dl>

      <div className="panel">
        <h2>缺少文件</h2>
        <div className="field">
          <label htmlFor="missing">缺少文件</label>
          <textarea id="missing" value={missing} onChange={(e) => setMissing(e.target.value)} />
        </div>
        <div>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => save({ missingDocs: missing.trim() === '' ? null : missing.trim() })}
          >
            保存缺少文件
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>付款</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="price">价格 Price (RM)</label>
            <input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          {code === 'C1' && (
            <div className="field">
              <label htmlFor="markup">加价 Markup (RM)</label>
              <input id="markup" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="invoice">发票号码 Invoice no.</label>
            <input id="invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </div>
        </div>
        <div>
          <button type="button" className="btn" disabled={busy} onClick={savePayment}>
            保存付款资料
          </button>
        </div>
        <div className="grid2">
          <label className="check">
            <input
              type="checkbox"
              checked={data.clientPaid}
              disabled={busy}
              onChange={(e) => save({ clientPaid: e.target.checked })}
            />
            {code === 'B1' ? '伙伴已结清' : '客户已付款'}
          </label>
          <div className="field">
            <label htmlFor="paid-at">付款日期</label>
            <input
              id="paid-at"
              type="date"
              disabled={busy || !data.clientPaid}
              value={data.clientPaidAt ? klDate(data.clientPaidAt) : ''}
              onChange={(e) => e.target.value && save({ clientPaidAt: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>内部备注</h2>
        <div className="field">
          <label htmlFor="notes">内部备注</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => save({ notesInternal: notes.trim() === '' ? null : notes.trim() })}
          >
            保存备注
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>文件</h2>
        {docs.length === 0 ? (
          <p className="muted">还没有文件</p>
        ) : (
          <ul className="plain">
            {docs.map((d) => (
              <li key={d.id}>
                <span className="tag">{d.kind}</span>{' '}
                <a href={`/api/admin/documents/${encodeURIComponent(d.id)}/download`}>{d.filename}</a>{' '}
                <span className="muted">
                  {klDateTime(d.uploadedAt)} · {d.uploadedBy}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="inline-form">
          <label htmlFor="doc-kind">文件类型</label>
          <select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <label htmlFor="doc-file">选择文件</label>
          <input id="doc-file" ref={fileRef} type="file" accept="image/*,.heic,.heif,application/pdf" />
          <button type="button" className="btn" disabled={busy} onClick={upload}>
            上传
          </button>
        </div>
        <p className="hint">图片会先缩小再上传；每个文件不能超过 10 MB。</p>
      </div>

      <h2>进度记录</h2>
      {data.history.length === 0 ? (
        <p className="muted">还没有记录</p>
      ) : (
        <ul className="plain">
          {data.history.map((h, i) => (
            <li key={`${h.changedAt}-${i}`}>
              {klDateTime(h.changedAt)} · {CASE_STEPS[h.step as 0] ?? h.step} · <span className="muted">{h.changedBy ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
