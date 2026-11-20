// Helpers shared by the staff API route files.
import { HttpError } from './admin-errors';
import type { Env } from './env';
import type { Repo } from './repo';
import { dropPartnerView, refreshPartnerView } from './view-cache';

export const MAX_TEXT = 200;

export const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The JSON body, or a 400. The body must be sent as Content-Type: application/json (else 415):
 * a cross-site page cannot send that type without a CORS preflight, which this API never answers.
 */
export async function readJson(req: Request): Promise<unknown> {
  const type = (req.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, '请求格式必须是 JSON');
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, '请求格式不正确');
  }
}

export function readObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, '请求格式不正确');
  return raw as Record<string, unknown>;
}

/** 'YYYY-MM-DD' of a date or timestamp in Asia/Kuala_Lumpur. */
export function klDay(d: Date | string): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(d));
}

/**
 * Rebuild the stored page after a committed write. If the rebuild fails, drop the page instead so
 * the next view rebuilds it rather than serving outdated data. Never fails the response.
 */
export async function refreshOrDrop(env: Env, repo: Repo, id: string, token: string | null): Promise<void> {
  try {
    await refreshPartnerView(env, repo, id);
    return;
  } catch (err) {
    console.error('refreshPartnerView failed:', err instanceof Error ? err.message : 'unknown');
  }
  if (!token) return;
  try {
    await dropPartnerView(env, token);
  } catch (err) {
    console.error('dropPartnerView failed:', err instanceof Error ? err.message : 'unknown');
  }
}

/** Audit is last: the write is already committed, so a failure is logged (no token) and ignored. */
export async function auditQuietly(
  repo: Repo, by: string, action: string, entity: string, id: string, details?: object,
): Promise<void> {
  try {
    await repo.audit(by, action, entity, id, details);
  } catch (err) {
    console.error(`audit ${action} failed for ${id}:`, err instanceof Error ? err.message : 'unknown');
  }
}

/** A 400 that names the field and says the same message at the top level. */
export function bad(field: string, message: string): HttpError {
  return new HttpError(400, message, { [field]: message });
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (m: string) => MONTH_RE.test(m);

/** A required 'YYYY-MM' value, or a 400. */
export function mustMonth(m: string | undefined): string {
  if (m === undefined || !isMonth(m)) throw new HttpError(400, '月份格式不正确');
  return m;
}

/** 'YYYY-MM-DD' that is also a real calendar day. */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
