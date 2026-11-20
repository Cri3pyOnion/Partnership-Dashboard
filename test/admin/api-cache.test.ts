import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, authState, forgetReads, peekRead } from '../../src/admin/api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  authState.reset();
  forgetReads();
});

describe('remembered reads', () => {
  it('two reads of the same path at once make one request', async () => {
    const f = vi.fn(async () => json([1]));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([api.get('/api/admin/partners'), api.get('/api/admin/partners')]);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('remembers the last result per exact path, and a later read still asks the server', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([1])).mockResolvedValueOnce(json([1, 2]));
    vi.stubGlobal('fetch', f);
    expect(peekRead('/api/admin/cases')).toBeNull();
    await api.get('/api/admin/cases');
    expect(peekRead('/api/admin/cases')).toEqual([1]);
    expect(peekRead('/api/admin/cases?step=1')).toBeNull();
    expect(await api.get('/api/admin/cases')).toEqual([1, 2]);
    expect(peekRead('/api/admin/cases')).toEqual([1, 2]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failed read is not remembered and can be retried', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ error: 'x' }, 500)).mockResolvedValueOnce(json([3]));
    vi.stubGlobal('fetch', f);
    await expect(api.get('/api/admin/cases')).rejects.toBeTruthy();
    expect(peekRead('/api/admin/cases')).toBeNull();
    expect(await api.get('/api/admin/cases')).toEqual([3]);
  });

  it('any save forgets every remembered read, even when the save fails', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([1])).mockResolvedValueOnce(json({ error: 'no' }, 400));
    vi.stubGlobal('fetch', f);
    await api.get('/api/admin/partners');
    await expect(api.patch('/api/admin/partners/TSP0001', { code: 'B1' })).rejects.toBeTruthy();
    expect(peekRead('/api/admin/partners')).toBeNull();
  });

  it('a read started before a save is not shared with a read after it', async () => {
    let release!: (r: Response) => void;
    const f = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json(['new']));
    vi.stubGlobal('fetch', f);
    const before = api.get('/api/admin/partners');
    await api.post('/api/admin/partners', { name: 'A' });
    const after = api.get('/api/admin/partners');
    release(json(['old']));
    expect(await before).toEqual(['old']);
    expect(await after).toEqual(['new']);
    expect(peekRead('/api/admin/partners')).toEqual(['new']);
  });
});
