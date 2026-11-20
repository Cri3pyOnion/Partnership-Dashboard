// The portal's first address, partner-portal.tohssign.workers.dev. Links already sent to partners
// (and staff bookmarks) still point here, so every request is forwarded, path and query kept,
// to the current address.
export const TARGET = 'https://portal.tohssign.workers.dev';

export function forward(req: Request): Response {
  const url = new URL(req.url);
  return Response.redirect(TARGET + url.pathname + url.search, 301);
}

export default { fetch: forward };
