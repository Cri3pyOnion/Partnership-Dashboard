import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Case, Partner } from '../../shared/types';
import { ApiError, api, errorText } from '../api';
import { ErrorBanner } from '../ErrorBanner';
import { useMe } from '../me';
import { StaffSelect, useStaffDirectory } from '../staff-directory';

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** '' is "not given"; otherwise a finite number of at least 0, or undefined when it is not one. */
function money(t: string): number | null | undefined {
  const s = t.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function CaseForm() {
  const navigate = useNavigate();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [licences, setLicences] = useState<string[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [licenceType, setLicenceType] = useState('');
  const [council, setCouncil] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [price, setPrice] = useState('');
  const [markup, setMarkup] = useState('');
  const [handledBy, setHandledBy] = useState('');
  const me = useMe();
  const staff = useStaffDirectory();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.get<Partner[]>('/api/admin/partners'), api.get<{ licenceTypes: string[] }>('/api/admin/licence-types')])
      .then(([p, l]) => {
        if (!live) return;
        setPartners(p.filter((x) => x.status !== '待审核'));
        setLicences(l.licenceTypes);
        setLicenceType((cur) => cur || l.licenceTypes[0] || '');
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  const chosen = partners.find((p) => p.id === partnerId);

  // Picking a partner suggests their staff member (or me, for an unassigned partner); it can still be changed.
  function choosePartner(id: string) {
    setPartnerId(id);
    const p = partners.find((x) => x.id === id);
    setHandledBy(p ? (p.assignedStaff ?? me?.email.toLowerCase() ?? '') : '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!partnerId) errs.partnerId = '请选择伙伴';
    if (!licenceType) errs.licenceType = '请选择执照类型';
    if (!clientName.trim()) errs.clientName = '请填写客户姓名';
    const p = money(price);
    if (p === undefined) errs.price = '金额不正确';
    const m = chosen?.code === 'C1' ? money(markup) : null;
    if (m === undefined) errs.markup = '金额不正确';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body: Record<string, unknown> = { partnerId, licenceType, clientName: clientName.trim() };
    if (clientPhone.trim()) body.clientPhone = clientPhone.trim();
    if (council.trim()) body.council = council.trim();
    if (p !== null && p !== undefined) body.price = p;
    if (m !== null && m !== undefined) body.markup = m;
    // Blank means "let the server decide": the partner's staff, else whoever creates the case.
    if (handledBy) body.handledBy = handledBy;

    setBusy(true);
    setError(null);
    try {
      const created = await api.post<Case>('/api/admin/cases', body);
      navigate(`/cases/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError || (err && typeof err === 'object' && 'fields' in err)) {
        const f = (err as { fields?: Record<string, string> }).fields;
        if (f) setErrors(f);
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>新增案件</h1>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <form className="form" onSubmit={submit} noValidate>
        <Field id="c-partner" label="伙伴 Partner" error={errors.partnerId}>
          <select id="c-partner" value={partnerId} onChange={(e) => choosePartner(e.target.value)} aria-invalid={!!errors.partnerId}>
            <option value="">请选择</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} {p.name} ({p.code})
              </option>
            ))}
          </select>
        </Field>
        <Field id="c-handler" label="处理员工 Handled by" error={errors.handledBy}>
          <StaffSelect id="c-handler" label="处理员工" value={handledBy} list={staff} invalid={!!errors.handledBy} onChange={setHandledBy} />
        </Field>
        <Field id="c-licence" label="执照类型 Licence type" error={errors.licenceType}>
          <select id="c-licence" value={licenceType} onChange={(e) => setLicenceType(e.target.value)} aria-invalid={!!errors.licenceType}>
            {licences.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field id="c-council" label="州属局 Council" error={errors.council}>
          <input id="c-council" value={council} onChange={(e) => setCouncil(e.target.value)} />
        </Field>
        <Field id="c-name" label="客户姓名 Client name" error={errors.clientName}>
          <input id="c-name" value={clientName} onChange={(e) => setClientName(e.target.value)} aria-invalid={!!errors.clientName} />
        </Field>
        <Field id="c-phone" label="客户电话 Client phone" error={errors.clientPhone}>
          <input id="c-phone" inputMode="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
        </Field>
        <Field id="c-price" label="价格 Price (RM)" error={errors.price}>
          <input id="c-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!errors.price} />
        </Field>
        {chosen?.code === 'C1' && (
          <Field id="c-markup" label="加价 Markup (RM)" error={errors.markup}>
            <input id="c-markup" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} aria-invalid={!!errors.markup} />
          </Field>
        )}
        <div>
          <button type="submit" className="btn primary" disabled={busy}>
            建立案件
          </button>
        </div>
      </form>
    </section>
  );
}
