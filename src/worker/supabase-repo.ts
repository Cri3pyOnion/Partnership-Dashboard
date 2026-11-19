import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { StepIndex } from '../shared/status';
import type {
  Case, CaseDocument, Commission, NewCase, NewDocument, NewPartner, Partner, PartnerStatus, Settings, Staff,
} from '../shared/types';
import {
  caseFromRow, caseToRow, commissionFromRow, commissionToRow, documentFromRow, monthRange, partnerFromRow,
  partnerToRow, settingsFromRows, settingsToRows, staffFromRow, staffToRow, type Row,
} from './mapping';
import { NotFoundError, RepoError, type CaseHistoryRow, type Repo } from './repo';

type Result<T> = { data: T | null; error: { message: string } | null };

/** Awaits a supabase call, converting any returned error or thrown failure into RepoError. */
async function run<T>(what: string, call: PromiseLike<Result<T>>): Promise<T | null> {
  let res: Result<T>;
  try {
    res = await call;
  } catch (e) {
    throw new RepoError(`${what}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (res.error) throw new RepoError(`${what}: ${res.error.message}`, { cause: res.error });
  return res.data;
}

/** Escapes a user string for an ilike pattern inside a double-quoted PostgREST filter value. */
function ilikeValue(q: string): string {
  const like = q.replace(/\*/g, '').replace(/[\\%_]/g, (m) => `\\${m}`);
  const quoted = like.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"%${quoted}%"`;
}

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async rpcText(fn: 'next_partner_id' | 'next_case_id'): Promise<string> {
    const id = await run<string>(fn, this.db.rpc(fn));
    if (typeof id !== 'string') throw new RepoError(`${fn}: unexpected result`);
    return id;
  }

  async getStaff(email: string): Promise<Staff | null> {
    const r = await run<Row>('getStaff', this.db.from('staff').select('*').eq('email', email).maybeSingle());
    return r ? staffFromRow(r) : null;
  }
  async listStaff(): Promise<Staff[]> {
    const rows = await run<Row[]>('listStaff', this.db.from('staff').select('*').order('email'));
    return (rows ?? []).map(staffFromRow);
  }
  async saveStaff(s: Staff, _by: string): Promise<void> {
    await run('saveStaff', this.db.from('staff').upsert(staffToRow(s), { onConflict: 'email' }));
  }

  async listPartners(f: { status?: PartnerStatus; q?: string }): Promise<Partner[]> {
    let query = this.db.from('partners').select('*');
    if (f.status) query = query.eq('status', f.status);
    const q = f.q?.trim();
    if (q) {
      const v = ilikeValue(q);
      query = query.or(['id', 'name', 'company', 'phone'].map((c) => `${c}.ilike.${v}`).join(','));
    }
    const rows = await run<Row[]>('listPartners', query.order('id'));
    return (rows ?? []).map(partnerFromRow);
  }
  async getPartner(id: string): Promise<Partner | null> {
    const r = await run<Row>('getPartner', this.db.from('partners').select('*').eq('id', id).maybeSingle());
    return r ? partnerFromRow(r) : null;
  }
  async getPartnerByToken(token: string): Promise<Partner | null> {
    const r = await run<Row>('getPartnerByToken', this.db.from('partners').select('*').eq('view_token', token).maybeSingle());
    return r ? partnerFromRow(r) : null;
  }
  async createPartner(input: NewPartner, _by: string): Promise<Partner> {
    const id = await this.rpcText('next_partner_id');
    const row = { ...partnerToRow(input), id, status: '待审核' };
    const r = await run<Row>('createPartner', this.db.from('partners').insert(row).select('*').single());
    return partnerFromRow(r!);
  }
  async updatePartner(id: string, patch: Partial<Partner>, _by: string): Promise<Partner> {
    const row = partnerToRow(patch);
    if (Object.keys(row).length === 0) {
      const cur = await this.getPartner(id);
      if (!cur) throw new NotFoundError(`partner ${id} not found`);
      return cur;
    }
    const r = await run<Row>('updatePartner', this.db.from('partners').update(row).eq('id', id).select('*').maybeSingle());
    if (!r) throw new NotFoundError(`partner ${id} not found`);
    return partnerFromRow(r);
  }

  async listCases(f: { partnerId?: string; step?: StepIndex; month?: string }): Promise<Case[]> {
    let query = this.db.from('cases').select('*');
    if (f.partnerId) query = query.eq('partner_id', f.partnerId);
    if (f.step !== undefined) query = query.eq('step', f.step);
    if (f.month) {
      const [from, to] = monthRange(f.month);
      query = query.gte('submitted_at', from).lt('submitted_at', to);
    }
    const rows = await run<Row[]>('listCases', query.order('submitted_at', { ascending: false }).order('id', { ascending: false }));
    return (rows ?? []).map(caseFromRow);
  }
  async getCase(id: string): Promise<Case | null> {
    const r = await run<Row>('getCase', this.db.from('cases').select('*').eq('id', id).maybeSingle());
    return r ? caseFromRow(r) : null;
  }
  async createCase(input: NewCase, _by: string): Promise<Case> {
    const id = await this.rpcText('next_case_id');
    const row = { ...caseToRow(input), id };
    const r = await run<Row>('createCase', this.db.from('cases').insert(row).select('*').single());
    return caseFromRow(r!);
  }
  async updateCase(id: string, patch: Partial<Case>, by: string): Promise<Case> {
    const cur = await this.getCase(id);
    if (!cur) throw new NotFoundError(`case ${id} not found`);
    const row = caseToRow(patch);
    let next = cur;
    if (Object.keys(row).length > 0) {
      const r = await run<Row>('updateCase', this.db.from('cases').update(row).eq('id', id).select('*').maybeSingle());
      if (!r) throw new NotFoundError(`case ${id} not found`);
      next = caseFromRow(r);
    }
    if (next.step !== cur.step) {
      await run('updateCase.history', this.db.from('case_steps_history').insert({ case_id: id, step: next.step, changed_by: by }));
    }
    return next;
  }
  async listCaseHistory(caseId: string): Promise<CaseHistoryRow[]> {
    const rows = await run<Row[]>(
      'listCaseHistory',
      this.db.from('case_steps_history').select('step, changed_at, changed_by').eq('case_id', caseId)
        .order('changed_at').order('id'),
    );
    return (rows ?? []).map((r) => ({ step: r.step as StepIndex, changedAt: new Date(r.changed_at).toISOString(), changedBy: r.changed_by }));
  }

  async getCommission(caseId: string): Promise<Commission | null> {
    const r = await run<Row>('getCommission', this.db.from('commissions').select('*').eq('case_id', caseId).maybeSingle());
    return r ? commissionFromRow(r) : null;
  }
  async listCommissions(f: { partnerId?: string; month?: string }): Promise<Commission[]> {
    let query = this.db.from('commissions').select('*, cases!inner(partner_id, submitted_at)');
    if (f.partnerId) query = query.eq('cases.partner_id', f.partnerId);
    if (f.month) {
      const [from, to] = monthRange(f.month);
      query = query.gte('cases.submitted_at', from).lt('cases.submitted_at', to);
    }
    const rows = await run<Row[]>('listCommissions', query.order('case_id'));
    return (rows ?? []).map(commissionFromRow);
  }
  async saveCommission(c: Commission): Promise<void> {
    await run('saveCommission', this.db.from('commissions').upsert(commissionToRow(c), { onConflict: 'case_id' }));
  }

  async getSettings(): Promise<Settings> {
    const rows = await run<Array<{ key: string; value: unknown }>>(
      'getSettings',
      this.db.from('settings').select('key, value').in('key', ['commission_rules', 'licence_types', 'inactive_days']),
    );
    return settingsFromRows(rows ?? []);
  }
  async saveSettings(s: Settings, _by: string): Promise<void> {
    await run('saveSettings', this.db.from('settings').upsert(settingsToRows(s), { onConflict: 'key' }));
  }

  async logLinkView(partnerId: string, country: string | null): Promise<void> {
    await run('logLinkView', this.db.from('link_views').insert({ partner_id: partnerId, country }));
  }
  async listLinkViews(partnerId: string, limit: number): Promise<Array<{ viewedAt: string; country: string | null }>> {
    const rows = await run<Row[]>(
      'listLinkViews',
      this.db.from('link_views').select('viewed_at, country').eq('partner_id', partnerId)
        .order('viewed_at', { ascending: false }).order('id', { ascending: false }).limit(limit),
    );
    return (rows ?? []).map((r) => ({ viewedAt: new Date(r.viewed_at).toISOString(), country: r.country }));
  }

  async listDocuments(caseId: string): Promise<CaseDocument[]> {
    const rows = await run<Row[]>('listDocuments', this.db.from('case_documents').select('*').eq('case_id', caseId).order('uploaded_at'));
    return (rows ?? []).map(documentFromRow);
  }
  async addDocument(d: NewDocument, by: string): Promise<CaseDocument> {
    const r = await run<Row>(
      'addDocument',
      this.db.from('case_documents')
        .insert({ case_id: d.caseId, storage_path: d.storagePath, filename: d.filename, kind: d.kind, uploaded_by: by })
        .select('*').single(),
    );
    return documentFromRow(r!);
  }

  async audit(by: string, action: string, entity: string, id: string, details?: object): Promise<void> {
    await run('audit', this.db.from('audit_log').insert({
      staff_email: by, action, entity, entity_id: id, details: details ?? null,
    }));
  }
}
