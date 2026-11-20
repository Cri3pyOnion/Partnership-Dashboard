// The same staff app answers on two addresses: admins use /admin, everyone else /dashboard.
// This only decides which address shows in the browser; what each person may do is still
// checked by the API.
import type { Me } from './me';

export const ADMIN_BASE = '/admin';
export const STAFF_BASE = '/dashboard';

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** The address the app is being served from (the router's basename). */
export function currentBase(path: string): string {
  return under(path, ADMIN_BASE) ? ADMIN_BASE : STAFF_BASE;
}

export function homeFor(role: Me['role']): string {
  return role === 'admin' ? ADMIN_BASE : STAFF_BASE;
}

/**
 * Where to send someone who opened the other role's address, keeping the page they asked for;
 * null when they are already in the right place (or not under either address).
 */
export function correctedUrl(role: Me['role'], loc: { pathname: string; search: string; hash: string }): string | null {
  const { pathname } = loc;
  if (!under(pathname, ADMIN_BASE) && !under(pathname, STAFF_BASE)) return null;
  const from = currentBase(pathname);
  const to = homeFor(role);
  if (from === to) return null;
  return `${to}${pathname.slice(from.length) || '/'}${loc.search}${loc.hash}`;
}
