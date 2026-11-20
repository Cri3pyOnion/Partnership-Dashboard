// Same-origin JSON client for the staff API. Cloudflare Access supplies the login cookie.
import { useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(
    public status: number,
    public error: string,
    public fields?: Record<string, string>,
  ) {
    super(error);
    this.name = 'ApiError';
  }
}

/** Set once when any call returns 401. The page shows a banner; nothing reloads by itself. */
export const authState = (() => {
  const listeners = new Set<() => void>();
  const s = {
    expired: false,
    markExpired() {
      if (s.expired) return;
      s.expired = true;
      listeners.forEach((l) => l());
    },
    reset() {
      s.expired = false;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return s;
})();

export const useSessionExpired = (): boolean => useSyncExternalStore(authState.subscribe, () => authState.expired);

async function toError(res: Response): Promise<ApiError> {
  let body: { error?: unknown; fields?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // not JSON: fall back to a generic message
  }
  const error = typeof body.error === 'string' && body.error ? body.error : `请求失败（${res.status}）`;
  const fields = body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, string>) : undefined;
  return new ApiError(res.status, error, fields);
}

const SESSION_EXPIRED = '登录已过期，请刷新页面重新登录';

/**
 * fetch with the same-origin cookie. A 401 raises the session-expired flag. So do the two shapes an
 * expired Cloudflare Access session takes in the browser: the redirect to the Access login page is
 * cross-origin, so fetch rejects with a TypeError; or, if the redirect was followed, res.redirected.
 * Both become an ApiError 401.
 */
async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: 'same-origin' });
  } catch (e) {
    if (e instanceof TypeError) {
      authState.markExpired();
      throw new ApiError(401, SESSION_EXPIRED);
    }
    throw e;
  }
  if (res.redirected) {
    await res.body?.cancel().catch(() => {});
    authState.markExpired();
    throw new ApiError(401, SESSION_EXPIRED);
  }
  if (res.status === 401) authState.markExpired();
  return res;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  }
  const res = await raw(path, init);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Reads are shared and remembered for this page load, so a page that is opened again shows its last
// rows at once while fresh ones load, and two parts asking for the same thing make one request.
// Any change (POST, PATCH, PUT) forgets everything, so nothing stale outlives a save.
const inFlight = new Map<string, Promise<unknown>>();
const lastSeen = new Map<string, unknown>();

function get<T>(path: string): Promise<T> {
  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T>;
  const p = call<T>('GET', path).then(
    (data) => {
      if (inFlight.get(path) === p) {
        inFlight.delete(path);
        lastSeen.set(path, data);
      }
      return data;
    },
    (e) => {
      if (inFlight.get(path) === p) inFlight.delete(path);
      throw e;
    },
  );
  inFlight.set(path, p);
  return p;
}

async function write<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await call<T>(method, path, body);
  } finally {
    forgetReads();
  }
}

/** Drops every remembered read (and lets in-flight ones finish without being remembered). */
export function forgetReads(): void {
  inFlight.clear();
  lastSeen.clear();
}

/** The last successful result for this exact path in this page load, if any. Never fetches. */
export function peekRead<T = unknown>(path: string): T | null {
  return lastSeen.has(path) ? (lastSeen.get(path) as T) : null;
}

export const api = {
  get,
  post: <T = unknown>(path: string, body?: unknown) => write<T>('POST', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => write<T>('PATCH', path, body),
  put: <T = unknown>(path: string, body?: unknown) => write<T>('PUT', path, body),
  /** For uploads and downloads: the caller reads the Response and decides what a failure means. */
  raw,
};

/** The message to show for any thrown value. */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && typeof (e as { error?: unknown }).error === 'string') return (e as { error: string }).error;
  return '出错了，请稍后再试';
}
