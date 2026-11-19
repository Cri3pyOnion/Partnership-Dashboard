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

/** fetch with the same-origin cookie; a 401 raises the session-expired flag. */
async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
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

export const api = {
  get: <T = unknown>(path: string) => call<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => call<T>('POST', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => call<T>('PATCH', path, body),
  put: <T = unknown>(path: string, body?: unknown) => call<T>('PUT', path, body),
  /** For uploads and downloads: the caller reads the Response and decides what a failure means. */
  raw,
};

/** The message to show for any thrown value. */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && typeof (e as { error?: unknown }).error === 'string') return (e as { error: string }).error;
  return '出错了，请稍后再试';
}
