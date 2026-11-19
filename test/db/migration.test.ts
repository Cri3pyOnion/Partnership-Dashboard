import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../src/shared/commission';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const migration = read('supabase/migrations/20261119000001_init.sql');
const seed = read('supabase/seed.sql');
const smoke = read('supabase/tests/smoke.sql');

const smokeChecks = smoke
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => /^select\b/i.test(l));

describe('smoke.sql on a fresh database', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration);
  });

  it('has smoke checks to run', () => {
    expect(smokeChecks.length).toBeGreaterThanOrEqual(7);
  });

  // Checks are order-dependent (counters), so they run in file order.
  for (const sql of smokeChecks) {
    it(sql, async () => {
      const res = await db.query<Record<string, unknown>>(sql.replace(/\s*--.*$/, ''));
      expect(Object.values(res.rows[0])[0]).toBe(true);
    });
  }
});

describe('migration + seed', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration);
    await db.exec(seed);
  });

  const scalar = async (sql: string) =>
    Object.values((await db.query<Record<string, unknown>>(sql)).rows[0])[0];

  it('seeds 10 partners and 5 cases', async () => {
    expect(Number(await scalar('select count(*) from partners'))).toBe(10);
    expect(Number(await scalar('select count(*) from cases'))).toBe(5);
  });

  it('continues id sequences after the seed', async () => {
    expect(await scalar('select next_partner_id()')).toBe('TSP0011');
    expect(await scalar(`select next_case_id('2026-11-20 10:00+08')`)).toBe('TS-2611-015');
  });

  it('seeds no commissions and no staff', async () => {
    expect(Number(await scalar('select count(*) from commissions'))).toBe(0);
    expect(Number(await scalar('select count(*) from staff'))).toBe(0);
  });

  it('stores default settings equal to DEFAULT_RULES', async () => {
    const rules = await scalar(`select value from settings where key='commission_rules'`);
    const parsed = typeof rules === 'string' ? JSON.parse(rules) : rules;
    expect(parsed).toEqual(DEFAULT_RULES);
    expect(await scalar(`select value from settings where key='licence_types'`)).toEqual([
      '营业执照', '招牌执照', '清真认证 (JAKIM)', 'SSM 公司注册', '消防证书 (BOMBA)',
    ]);
    expect(Number(await scalar(`select value from settings where key='inactive_days'`))).toBe(90);
  });

  it('enforces check constraints', async () => {
    await expect(
      db.exec(`insert into partners (id,name,phone,email,code,filled_by,status) values ('X','n','p','e','Z9','IT','活跃')`),
    ).rejects.toThrow();
    await expect(
      db.exec(`update cases set step = 6 where id = 'TS-2611-014'`),
    ).rejects.toThrow();
  });
});

describe('ids never truncate on overflow', () => {
  it('partner ids grow past 4 digits', async () => {
    const db = new PGlite();
    await db.exec(migration);
    await db.exec(`select setval('partner_seq', 9999)`);
    const r = await db.query<{ id: string }>('select next_partner_id() as id');
    expect(r.rows[0].id).toBe('TSP10000');
  });

  it('case numbers grow past 3 digits', async () => {
    const db = new PGlite();
    await db.exec(migration);
    await db.exec(`insert into case_counters (yymm, n) values ('2611', 999)`);
    const r = await db.query<{ id: string }>(`select next_case_id('2026-11-05 10:00+08') as id`);
    expect(r.rows[0].id).toBe('TS-2611-1000');
  });
});

describe('guarded revokes with Supabase-style roles', () => {
  it('strips anon/authenticated privileges but keeps service_role', async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    `);
    await db.exec(migration);
    const b = async (sql: string) =>
      Object.values((await db.query<Record<string, unknown>>(sql)).rows[0])[0];
    for (const role of ['anon', 'authenticated']) {
      expect(await b(`select has_table_privilege('${role}','public.partners','SELECT')`)).toBe(false);
      expect(await b(`select has_function_privilege('${role}','public.next_partner_id()','EXECUTE')`)).toBe(false);
    }
    expect(await b(`select has_function_privilege('service_role','public.next_partner_id()','EXECUTE')`)).toBe(true);
  });
});
