import { describe, expect, it } from 'vitest';
import { StorageError, SupabaseStorage } from '../../src/worker/storage';

type Call = { url: string; init: RequestInit };

function make(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  return { storage: new SupabaseStorage('https://x.supabase.co', 'svc-key', fetchImpl), calls };
}

describe('SupabaseStorage', () => {
  it('uploads with the key, type, length, no upsert, and an encoded path', async () => {
    let sent = '';
    const { storage, calls } = make(async (c) => {
      sent = await new Response(c.init.body).text();
      return new Response('{}', { status: 200 });
    });
    const body = new Response('abc').body!;
    await storage.put('TS-2611-001/u-a b_中.pdf', body, 'application/pdf', 3);
    expect(calls[0].url).toBe('https://x.supabase.co/storage/v1/object/case-documents/TS-2611-001/u-a%20b_%E4%B8%AD.pdf');
    expect(calls[0].init.method).toBe('POST');
    expect(sent).toBe('abc');
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer svc-key', apikey: 'svc-key', 'Content-Type': 'application/pdf', 'Content-Length': '3', 'x-upsert': 'false',
    });
  });

  it('pins the outbound length: the body goes through a FixedLengthStream of exactly `length` bytes', async () => {
    const { storage, calls } = make(async (c) => {
      await new Response(c.init.body).arrayBuffer(); // the stream errors if the byte count is not `length`
      return new Response('{}', { status: 200 });
    });
    await storage.put('a/b', new Response('abc').body!, 'image/png', 3);
    expect(calls[0].init.body).toBeInstanceOf(ReadableStream);
    expect(calls[0].init.body).not.toBeInstanceOf(Response);
    await expect(storage.put('a/c', new Response('abcdef').body!, 'image/png', 3)).rejects.toBeInstanceOf(StorageError);
    await expect(storage.put('a/d', new Response('a').body!, 'image/png', 3)).rejects.toBeInstanceOf(StorageError);
  });

  it('turns a failed upload and a network error into StorageError', async () => {
    const bad = make(() => new Response('no', { status: 500 }));
    await expect(bad.storage.put('a/b', new Response('x').body!, 'image/png', 1)).rejects.toBeInstanceOf(StorageError);
    const boom = make(() => { throw new TypeError('network'); });
    await expect(boom.storage.put('a/b', new Response('x').body!, 'image/png', 1)).rejects.toBeInstanceOf(StorageError);
  });

  it('downloads through the authenticated endpoint and returns the stream untouched', async () => {
    const { storage, calls } = make(() => new Response('hello', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '5' } }));
    const got = await storage.get('c/x y.png');
    expect(calls[0].url).toBe('https://x.supabase.co/storage/v1/object/authenticated/case-documents/c/x%20y.png');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer svc-key', apikey: 'svc-key' });
    expect(got).toMatchObject({ contentType: 'image/png', size: 5 });
    expect(await new Response(got!.body).text()).toBe('hello');
  });

  it('returns null for a missing object and throws for other failures', async () => {
    expect(await make(() => new Response('{}', { status: 404 })).storage.get('a/b')).toBeNull();
    const supa400 = () => new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 400 });
    expect(await make(supa400).storage.get('a/b')).toBeNull();
    await expect(make(() => new Response('x', { status: 500 })).storage.get('a/b')).rejects.toBeInstanceOf(StorageError);
  });
});
