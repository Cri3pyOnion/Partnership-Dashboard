// GET /p/:token, the no-login partner page.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { acceptLanguages, type Lang, langFromPreferences } from '../../shared/i18n';
import type { AppEnv } from '../env';
import { renderInvalidLink, renderUnavailable } from '../partner-page';
import { VIEW_LOG_WINDOW_MINUTES } from '../repo';
import { getPartnerView } from '../view-cache';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const page = (c: Context<AppEnv>, html: string, status: 200 | 404 | 503, cache: string) =>
  c.newResponse(html, status, { ...SECURITY_HEADERS, 'Cache-Control': cache, Vary: 'Accept-Language, Cookie' });

/**
 * Views this Worker instance has just logged, so a refresh loop does not reach the database at all.
 * The database applies the same window for every instance; this is only a cheap first line.
 */
const recentlyLogged = new Map<string, number>();
const MEMO_MAX = 1000;

/** True when this instance logged the same partner and country inside the window (and it is not stale). */
export function seenRecently(partnerId: string, country: string | null, now = Date.now()): boolean {
  const k = `${partnerId}|${country ?? ''}`;
  const until = recentlyLogged.get(k);
  if (until !== undefined && until > now) return true;
  if (recentlyLogged.size >= MEMO_MAX) recentlyLogged.clear();
  recentlyLogged.set(k, now + VIEW_LOG_WINDOW_MINUTES * 60_000);
  return false;
}

/** Test hook. */
export const clearSeenRecently = () => recentlyLogged.clear();

const LANG_COOKIE = 'lang';

/**
 * The partner page's language: ?lang= (from the EN | 中文 links, then remembered in a cookie),
 * else the remembered choice, else the browser's language.
 */
export function pageLang(c: Context<AppEnv>): Lang {
  const asked = c.req.query('lang');
  if (asked === 'en' || asked === 'zh') {
    setCookie(c, LANG_COOKIE, asked, { path: '/p', maxAge: 365 * 86400, sameSite: 'Lax', secure: true, httpOnly: true });
    return asked;
  }
  const kept = getCookie(c, LANG_COOKIE);
  if (kept === 'en' || kept === 'zh') return kept;
  return langFromPreferences(acceptLanguages(c.req.header('Accept-Language')));
}

/** Fire-and-forget view log. Nothing here may change the response. */
function logView(c: Context<AppEnv>, partnerId: string): void {
  try {
    const country = (c.req.raw.cf?.country as string | undefined) ?? null;
    if (seenRecently(partnerId, country)) return;
    const p = Promise.resolve()
      .then(() => c.var.repo.logLinkView(partnerId, country))
      .catch(() => {});
    c.executionCtx.waitUntil(p);
  } catch {
    // No execution context (or similar): skip logging.
  }
}

export const partnerView = new Hono<AppEnv>();

partnerView.get('/p/:token', async (c) => {
  const lang = pageLang(c);
  let view: Awaited<ReturnType<typeof getPartnerView>>;
  try {
    view = await getPartnerView(c.env, c.var.repo, c.req.param('token'), lang);
  } catch {
    // RepoError with no snapshot (R19), or anything unexpected (R22): the same plain 503 page.
    return page(c, renderUnavailable(lang), 503, 'no-store');
  }
  if (!view) return page(c, renderInvalidLink(lang), 404, 'no-store');
  logView(c, view.partnerId);
  return page(c, view.html, 200, 'no-store'); // R21: never cache, so a reset link dies at once
});

// Anything else under /p (extra segments, a trailing slash, no token): the same invalid-link page.
partnerView.get('/p', (c) => page(c, renderInvalidLink(pageLang(c)), 404, 'no-store'));
partnerView.get('/p/*', (c) => page(c, renderInvalidLink(pageLang(c)), 404, 'no-store'));
