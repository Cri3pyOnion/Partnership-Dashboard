import { describe, expect, it } from 'vitest';
import { RepoError } from '../../src/worker/repo';
import { FakeRepo } from '../fake-repo';
import { caseInput, partnerInput, runRepoContract } from './repo.contract';

describe('FakeRepo', () => {
  runRepoContract(async () => new FakeRepo());

  it('starts ids at TSP0001 and counts case ids per month', async () => {
    let now = new Date('2026-11-19T04:00:00Z');
    const repo = new FakeRepo({ now: () => now });
    const p1 = await repo.createPartner(partnerInput(), 'a@x.com');
    const p2 = await repo.createPartner(partnerInput(), 'a@x.com');
    expect([p1.id, p2.id, p1.status]).toEqual(['TSP0001', 'TSP0002', '待审核']);
    expect((await repo.createCase(caseInput(p1.id), 'a')).id).toBe('TS-2611-001');
    expect((await repo.createCase(caseInput(p1.id), 'a')).id).toBe('TS-2611-002');
    now = new Date('2026-11-30T16:30:00Z'); // 00:30 on 1 Dec in Kuala Lumpur
    expect((await repo.createCase(caseInput(p1.id), 'a')).id).toBe('TS-2612-001');
  });

  it('failNext makes exactly the next call reject with RepoError', async () => {
    const repo = new FakeRepo();
    repo.failNext();
    await expect(repo.listPartners({})).rejects.toBeInstanceOf(RepoError);
    await expect(repo.listPartners({})).resolves.toEqual([]);
    const cause = new Error('boom');
    repo.failNext(cause);
    const err = await repo.getSettings().catch((e) => e);
    expect(err).toBeInstanceOf(RepoError);
    expect(err.cause).toBe(cause);
  });
});
