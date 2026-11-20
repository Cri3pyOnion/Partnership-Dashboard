import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, authState } from '../../src/admin/api';

function stubFetch(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  authState.reset();
});

describe('api', () => {
  it('sends same-origin JSON and returns the parsed body', async () => {
    const f = stubFetch(200, { ok: 1 });
    expect(await api.post('/api/admin/partners', { name: 'A' })).toEqual({ ok: 1 });
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/admin/partners');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{"name":"A"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('throws ApiError carrying status, error and fields', async () => {
    stubFetch(400, { error: '请检查红色栏位', fields: { email: '电邮格式不正确' } });
    const err = (await api.post('/api/admin/partners', {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.error).toBe('请检查红色栏位');
    expect(err.fields).toEqual({ email: '电邮格式不正确' });
  });

  it('raises the session-expired flag on 401 without reloading', async () => {
    stubFetch(401, { error: 'no' });
    expect(authState.expired).toBe(false);
    await expect(api.get('/api/admin/me')).rejects.toBeInstanceOf(ApiError);
    expect(authState.expired).toBe(true);
  });

  it('copes with a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    const err = (await api.get('/api/admin/partners').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(typeof err.error).toBe('string');
  });

  it('a fetch TypeError (Access redirect blocked by CORS) is treated as an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = (await api.get('/api/admin/partners').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(authState.expired).toBe(true);
  });

  it('a redirected response (an Access login page) is treated as an expired session', async () => {
    const res = new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(res, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn(async () => res));
    const err = (await api.get('/api/admin/partners').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(authState.expired).toBe(true);
  });

  it('other thrown errors are not mistaken for an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    await expect(api.get('/api/admin/partners')).rejects.toBeTruthy();
    expect(authState.expired).toBe(false);
  });

  it('raw returns the Response and still flags a 401', async () => {
    stubFetch(401, {});
    const res = await api.raw('/api/admin/cases/x/documents', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(401);
    expect(authState.expired).toBe(true);
  });
});
