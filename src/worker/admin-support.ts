// Helpers shared by the staff API route files.
import { HttpError } from './admin-errors';
import type { Env } from './env';
import type { Repo } from './repo';
import { dropPartnerView, refreshPartnerView } from './view-cache';

export const MAX_TEXT = 200;

export const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The JSON body as a plain object, or a 400. */
export async function readJson(req: Request): Promise<unknown> {
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
