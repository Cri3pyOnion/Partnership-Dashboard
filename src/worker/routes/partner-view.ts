// GET /p/:token, the no-login partner page.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { renderInvalidLink, renderUnavailable } from '../partner-page';
import { getPartnerView } from '../view-cache';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const page = (html: string, status: 200 | 404 | 503, cache: string) =>
  new Response(html, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': cache } });

/** Fire-and-forget view log. Nothing here may change the response. */
function logView(c: Context<AppEnv>, partnerId: string): void {
  try {
    const country = (c.req.raw.cf?.country as string | undefined) ?? null;
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
  let view: Awaited<ReturnType<typeof getPartnerView>>;
  try {
    view = await getPartnerView(c.env, c.var.repo, c.req.param('token'));
  } catch {
    // RepoError with no snapshot (R19), or anything unexpected (R22): the same plain 503 page.
    return page(renderUnavailable(), 503, 'no-store');
  }
  if (!view) return page(renderInvalidLink(), 404, 'no-store');
  logView(c, view.partnerId);
  return page(view.html, 200, 'no-store'); // R21: never cache, so a reset link dies at once
});
