import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, calcCommission } from '../../src/shared/commission';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
/** Every migration in supabase/migrations, in file-name order. */
const migration = readdirSync(resolve(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => read(`supabase/migrations/${f}`))
  .join('\n');
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

  it('seeds no staff', async () => {
    expect(Number(await scalar('select count(*) from staff'))).toBe(0);
  });

  it('seeds one commission per demo case, equal to calcCommission with DEFAULT_RULES', async () => {
    const rows = (await db.query<Record<string, unknown>>(`
      select c.id, c.price::float8 as price, c.markup::float8 as markup, c.client_paid, c.cancelled, p.code as partner_code,
             m.code, m.amount::float8 as amount, m.basis, m.status, m.paid_at, m.paid_by
      from cases c join partners p on p.id = c.partner_id left join commissions m on m.case_id = c.id order by c.id`)).rows;
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      const want = calcCommission(
        { price: r.price as number, markup: r.markup as number, clientPaid: r.client_paid as boolean, cancelled: r.cancelled as boolean },
        r.partner_code as 'C1', DEFAULT_RULES,
      );
      expect(r, String(r.id)).toMatchObject({ code: r.partner_code, amount: want.amount, basis: want.basis, status: want.status, paid_at: null, paid_by: null });
    }
    expect(rows.map((r) => [r.id, r.amount, r.status])).toEqual([
      ['TS-2609-012', 150, '可发放'], ['TS-2610-020', 250, '可发放'], ['TS-2610-031', 400, '待处理'],
      ['TS-2611-009', 150, '待处理'], ['TS-2611-014', 300, '待处理'],
    ]);
  });

  it('gives every 活跃 partner a fixed 43-character dev link, and no one else', async () => {
    const rows = (await db.query<{ id: string; status: string; view_token: string | null }>('select id, status, view_token from partners order by id')).rows;
    for (const r of rows) {
      if (r.status === '活跃') expect(r.view_token, r.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      else expect(r.view_token, r.id).toBeNull();
    }
    expect(rows.filter((r) => r.view_token).length).toBe(7);
    expect(new Set(rows.map((r) => r.view_token).filter(Boolean)).size).toBe(7);
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

describe('20261120000001_freeze_paid: 已支付 rows never change', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration);
    await db.exec(`
      insert into partners (id,name,phone,email,code,filled_by,status) values ('TSP0001','n','p','e','A1','IT','活跃');
      insert into cases (id,partner_id,client_name,licence_type) values ('TS-2611-001','TSP0001','c','营业执照'), ('TS-2611-002','TSP0001','c','营业执照');
      insert into commissions (case_id,code,amount,basis,status,paid_at,paid_by) values
        ('TS-2611-001','A1',150,'above','已支付','2026-11-12T03:00:00Z','a@x.com'),
        ('TS-2611-002','A1',100,'below','可发放',null,null);
    `);
  });
  const row = async (id: string) =>
    (await db.query<{ amount: string; status: string; paid_by: string | null }>(`select amount::text, status, paid_by from commissions where case_id = '${id}'`)).rows[0];

  it('ignores a plain update of an 已支付 row', async () => {
    await db.exec(`update commissions set amount = 0, status = '可发放', paid_at = null, paid_by = null where case_id = 'TS-2611-001'`);
    expect(await row('TS-2611-001')).toEqual({ amount: '150.00', status: '已支付', paid_by: 'a@x.com' });
  });

  it('ignores an upsert (the repo path) over an 已支付 row', async () => {
    await db.exec(`insert into commissions (case_id,code,amount,basis,status) values ('TS-2611-001','A1',100,'x','待处理')
      on conflict (case_id) do update set amount = excluded.amount, status = excluded.status, paid_at = null, paid_by = null`);
    expect(await row('TS-2611-001')).toEqual({ amount: '150.00', status: '已支付', paid_by: 'a@x.com' });
  });

  it('still updates rows that are not 已支付, including marking them paid', async () => {
    await db.exec(`update commissions set status = '已支付', paid_by = 'b@x.com' where case_id = 'TS-2611-002'`);
    expect(await row('TS-2611-002')).toEqual({ amount: '100.00', status: '已支付', paid_by: 'b@x.com' });
  });
});

describe('20261120000002_bucket_limits on a database with a storage schema', () => {
  it('sets the 10 MB limit and the allowed types on case-documents (and is a no-op without storage)', async () => {
    const db = new PGlite();
    await db.exec(`create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
    await db.exec(migration);
    const r = (await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'case-documents'`,
    )).rows[0];
    expect(r).toEqual({
      public: false,
      file_size_limit: '10485760',
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
    });
    const plain = new PGlite();
    await expect(plain.exec(migration)).resolves.toBeDefined();
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

describe('20261120000003/4: staff assignment and the Marketing team', () => {
  it('adds assigned_staff and handled_by, and only accepts Marketing (not 市场部)', async () => {
    const db = new PGlite();
    await db.exec(migration);
    await db.exec(`insert into staff (email, name, role, team) values ('a@x.my', 'A', 'staff', 'Marketing')`);
    await db.exec(`insert into partners (id, name, phone, email, code, filled_by, status, assigned_staff)
      values ('TSP0001', 'P', '+60123456789', 'p@x.my', 'A1', 'Marketing', '活跃', 'a@x.my')`);
    await expect(db.exec(`insert into staff (email, name, role, team) values ('b@x.my', 'B', 'staff', '市场部')`)).rejects.toThrow();
    await expect(db.exec(`update partners set assigned_staff = 'nobody@x.my'`)).rejects.toThrow();
    const r = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where column_name = 'handled_by'`);
    expect(r.rows[0].n).toBe(1);
  });
});
