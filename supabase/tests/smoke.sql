-- Smoke test. Assumes a fresh, UNSEEDED database with the init migration applied.
-- Safe on a real database: everything is rolled back.
begin;
select next_partner_id() = 'TSP0001';
select next_case_id('2026-11-03 10:00+08') = 'TS-2611-001';
select next_case_id('2026-11-03 10:00+08') = 'TS-2611-002';
select next_case_id('2026-11-30 23:59+08') = 'TS-2611-003';
select next_case_id('2026-12-01 00:00+08') = 'TS-2612-001';
select count(*) = 0 from pg_tables where schemaname='public' and rowsecurity = false;
select count(*) = 0 from pg_policies where schemaname='public';
rollback;
