// KV snapshot of each partner's page, keyed by the SHA-256 of the link token.
// The snapshot outlives Supabase outages: a hit never touches the repo.
import { previewCommission } from '../shared/commission';
import type { Lang } from '../shared/i18n';
import type { Commission, Partner } from '../shared/types';
import type { Env } from './env';
import { renderPartnerPage } from './partner-page';
import type { Repo } from './repo';
import { hashToken, isTokenShape } from './token';
import { buildPartnerView } from './view-model';

interface Snapshot {
  html: string;
  /** The same page in English. Snapshots stored before English existed lack it. */
  htmlEn?: string;
  updatedAt: string;
  partnerId: string;
}

/** Backstop: a snapshot nobody refreshes or drops still dies after a day. */
export const SNAPSHOT_TTL_SECONDS = 86400;

const key = async (token: string) => `view:${await hashToken(token)}`;

/** 'YYYY-MM-DD HH:mm' in Asia/Kuala_Lumpur. */
export function klStamp(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** KV read is best-effort: a failure or a malformed value counts as a miss. */
async function readSnapshot(env: Env, k: string): Promise<Snapshot | null> {
  try {
    const v = await env.VIEWS.get<Partial<Snapshot>>(k, 'json');
    if (v && typeof v.html === 'string' && typeof v.partnerId === 'string') {
      const htmlEn = typeof v.htmlEn === 'string' ? v.htmlEn : undefined;
      return { html: v.html, ...(htmlEn ? { htmlEn } : {}), updatedAt: String(v.updatedAt ?? ''), partnerId: v.partnerId };
    }
  } catch {
    // fall through to a rebuild
  }
  return null;
}

/** The KV put failed (for example the 1 write/sec per key limit). The key was deleted, best effort. */
export class SnapshotPutError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('snapshot put failed', options);
    this.name = 'SnapshotPutError';
  }
}

/**
 * Put-then-verify (R20): after storing, re-read the partner. If its token is no longer the one just
 * written (a reset raced us), or the re-read fails, delete the key so an old link cannot come back.
 * A failed put deletes the key (best effort) and throws SnapshotPutError, so an older snapshot is
 * never left behind silently and refreshOrDrop runs its drop (R27).
 */
async function store(env: Env, repo: Repo, partnerId: string, token: string, snap: Snapshot): Promise<void> {
  const k = await key(token);
  try {
    await env.VIEWS.put(k, JSON.stringify(snap), { expirationTtl: SNAPSHOT_TTL_SECONDS });
  } catch (err) {
    try {
      await env.VIEWS.delete(k);
    } catch {
      // best-effort; the caller still learns that the put failed
    }
    throw new SnapshotPutError({ cause: err });
  }
  let current: string | null = null;
  try {
    current = (await repo.getPartner(partnerId))?.viewToken ?? null;
  } catch {
    current = null;
  }
  if (current !== token) {
    try {
      await env.VIEWS.delete(k);
    } catch {
      // best-effort
    }
  }
}

async function build(env: Env, repo: Repo, p: Partner): Promise<Snapshot> {
  const [cases, stored] = await Promise.all([
    repo.listCases({ partnerId: p.id }),
    repo.listCommissions({ partnerId: p.id }),
  ]);
  // A case without a row (a failed recalculation, R32) is previewed like every staff surface does.
  // The preview counts in the tiles and shows on the case line as normal. Settings load once, only if needed.
  const comms: Commission[] = [...stored];
  const have = new Set(stored.map((cm) => cm.caseId));
  const missing = cases.filter((x) => !have.has(x.id));
  if (missing.length) {
    const rules = (await repo.getSettings()).commissionRules;
    for (const x of missing) {
      const cm = previewCommission(x, p.code, rules);
      if (cm) comms.push(cm);
    }
  }
  const updatedAt = klStamp(new Date());
  const view = buildPartnerView(p, cases, comms, env.MARKETING_WHATSAPP ?? '');
  return {
    html: renderPartnerPage(view, updatedAt, 'zh'),
    htmlEn: renderPartnerPage(view, updatedAt, 'en'),
    updatedAt,
    partnerId: p.id,
  };
}

const pick = (snap: Snapshot, lang: Lang) => (lang === 'en' ? snap.htmlEn : snap.html);

/** The page for a token in `lang`: from KV, or built and stored on a miss. null for a bad or unknown token. */
export async function getPartnerView(
  env: Env, repo: Repo, token: string, lang: Lang = 'zh',
): Promise<{ html: string; partnerId: string } | null> {
  if (!isTokenShape(token)) return null;
  const hit = await readSnapshot(env, await key(token));
  // A snapshot from before English existed has no English page: rebuild it like a miss.
  const fromHit = hit && pick(hit, lang);
  if (hit && fromHit) return { html: fromHit, partnerId: hit.partnerId };
  const p = await repo.getPartnerByToken(token);
  if (!p) return null;
  const snap = await build(env, repo, p);
  try {
    await store(env, repo, p.id, token, snap);
  } catch (err) {
    // R22: the page was built, so serve it; store() already deleted the key.
    if (!(err instanceof SnapshotPutError)) throw err;
  }
  return { html: pick(snap, lang) ?? snap.html, partnerId: snap.partnerId };
}

/**
 * Rebuild the stored page after that partner's data changed. No-op when the partner has no link.
 * Throws when the page cannot be stored, so the caller can drop it (refreshOrDrop).
 */
export async function refreshPartnerView(env: Env, repo: Repo, partnerId: string): Promise<void> {
  const p = await repo.getPartner(partnerId);
  if (!p?.viewToken) return;
  const snap = await build(env, repo, p);
  await store(env, repo, p.id, p.viewToken, snap);
}

/** Forget the stored page for a token (on link reset). */
export async function dropPartnerView(env: Env, token: string): Promise<void> {
  await env.VIEWS.delete(await key(token));
}
