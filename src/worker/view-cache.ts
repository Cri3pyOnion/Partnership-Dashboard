// KV snapshot of each partner's page, keyed by the SHA-256 of the link token.
// The snapshot outlives Supabase outages: a hit never touches the repo.
import type { Partner } from '../shared/types';
import type { Env } from './env';
import { renderPartnerPage } from './partner-page';
import type { Repo } from './repo';
import { hashToken, isTokenShape } from './token';
import { buildPartnerView } from './view-model';

interface Snapshot {
  html: string;
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
      return { html: v.html, updatedAt: String(v.updatedAt ?? ''), partnerId: v.partnerId };
    }
  } catch {
    // fall through to a rebuild
  }
  return null;
}

/**
 * Put-then-verify (R20): after storing, re-read the partner. If its token is no longer the one just
 * written (a reset raced us), or the re-read fails, delete the key so an old link cannot come back.
 * The put itself is best-effort (R22).
 */
async function store(env: Env, repo: Repo, partnerId: string, token: string, snap: Snapshot): Promise<void> {
  const k = await key(token);
  try {
    await env.VIEWS.put(k, JSON.stringify(snap), { expirationTtl: SNAPSHOT_TTL_SECONDS });
  } catch {
    return; // nothing was written, nothing to verify
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
  const [cases, comms] = await Promise.all([
    repo.listCases({ partnerId: p.id }),
    repo.listCommissions({ partnerId: p.id }),
  ]);
  const updatedAt = klStamp(new Date());
  const html = renderPartnerPage(buildPartnerView(p, cases, comms, env.MARKETING_WHATSAPP ?? ''), updatedAt);
  return { html, updatedAt, partnerId: p.id };
}

/** The page for a token: from KV, or built and stored on a miss. null for a bad or unknown token. */
export async function getPartnerView(
  env: Env, repo: Repo, token: string,
): Promise<{ html: string; partnerId: string } | null> {
  if (!isTokenShape(token)) return null;
  const hit = await readSnapshot(env, await key(token));
  if (hit) return { html: hit.html, partnerId: hit.partnerId };
  const p = await repo.getPartnerByToken(token);
  if (!p) return null;
  const snap = await build(env, repo, p);
  await store(env, repo, p.id, token, snap);
  return { html: snap.html, partnerId: snap.partnerId };
}

/** Rebuild the stored page after that partner's data changed. No-op when the partner has no link. */
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
