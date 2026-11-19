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

async function buildAndStore(env: Env, repo: Repo, p: Partner, token: string): Promise<Snapshot> {
  const [cases, comms] = await Promise.all([
    repo.listCases({ partnerId: p.id }),
    repo.listCommissions({ partnerId: p.id }),
  ]);
  const updatedAt = klStamp(new Date());
  const html = renderPartnerPage(buildPartnerView(p, cases, comms, env.MARKETING_WHATSAPP ?? ''), updatedAt);
  const snap: Snapshot = { html, updatedAt, partnerId: p.id };
  await env.VIEWS.put(await key(token), JSON.stringify(snap));
  return snap;
}

/** The page for a token: from KV, or built and stored on a miss. null for a bad or unknown token. */
export async function getPartnerView(
  env: Env, repo: Repo, token: string,
): Promise<{ html: string; partnerId: string } | null> {
  if (!isTokenShape(token)) return null;
  const hit = await env.VIEWS.get<Snapshot>(await key(token), 'json');
  if (hit) return { html: hit.html, partnerId: hit.partnerId };
  const p = await repo.getPartnerByToken(token);
  if (!p) return null;
  const snap = await buildAndStore(env, repo, p, token);
  return { html: snap.html, partnerId: snap.partnerId };
}

/** Rebuild the stored page after that partner's data changed. No-op when the partner has no link. */
export async function refreshPartnerView(env: Env, repo: Repo, partnerId: string): Promise<void> {
  const p = await repo.getPartner(partnerId);
  if (!p?.viewToken) return;
  await buildAndStore(env, repo, p, p.viewToken);
}

/** Forget the stored page for a token (on link reset). */
export async function dropPartnerView(env: Env, token: string): Promise<void> {
  await env.VIEWS.delete(await key(token));
}
