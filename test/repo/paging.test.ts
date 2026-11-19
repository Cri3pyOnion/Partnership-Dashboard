import { describe, expect, it } from 'vitest';
import { RepoError } from '../../src/worker/repo';
import { PAGE_SIZE, pageAll } from '../../src/worker/supabase-repo';

/** A fake PostgREST table: each call returns rows [from, to] of `total` rows. */
function fakeTable(total: number, failAt?: number) {
  const ranges: Array<[number, number]> = [];
  const page = (from: number, to: number) => {
    ranges.push([from, to]);
    if (failAt !== undefined && from >= failAt) return Promise.resolve({ data: null, error: { message: 'boom' } });
    const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ n: from + i }));
    return Promise.resolve({ data: rows, error: null });
  };
  return { page, ranges };
}

describe('pageAll (Supabase caps a select at 1,000 rows)', () => {
  it('reads every row across pages of 1,000 until a short page', async () => {
    const t = fakeTable(2500);
    const rows = await pageAll('list', t.page);
    expect(PAGE_SIZE).toBe(1000);
    expect(rows).toHaveLength(2500);
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('an exact multiple of 1,000 ends on the empty page after it', async () => {
    const t = fakeTable(2000);
    expect(await pageAll('list', t.page)).toHaveLength(2000);
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('one short page is one call; an empty table is one call', async () => {
    const a = fakeTable(3);
    expect(await pageAll('list', a.page)).toHaveLength(3);
    expect(a.ranges).toEqual([[0, 999]]);
    const b = fakeTable(0);
    expect(await pageAll('list', b.page)).toEqual([]);
    expect(b.ranges).toEqual([[0, 999]]);
  });

  it('an error on any page is a RepoError (never a partial list)', async () => {
    const t = fakeTable(5000, 1000);
    await expect(pageAll('list', t.page)).rejects.toBeInstanceOf(RepoError);
  });
});
