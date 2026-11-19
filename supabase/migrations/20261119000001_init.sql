-- Toh's Sign partner portal: initial schema.
-- RLS is enabled on every table with NO policies: only the Worker (service role) can read/write.

create sequence partner_seq;

create table staff (
  email text primary key,
  name text not null,
  role text not null check (role in ('admin','staff')),
  team text check (team in ('Transmission','市场部','IT')),
  active boolean not null default true
);

create table partners (
  id text primary key,
  name text not null,
  phone text not null,
  email text not null,
  tin text,
  company text,
  code text not null check (code in ('A1','B1','C1')),
  referral_name text,
  filled_by text not null check (filled_by in ('Transmission','市场部','IT')),
  source text check (source in ('上门','线上')),
  bank_name text,
  bank_account text,
  status text not null check (status in ('待审核','活跃','不活跃')),
  view_token text unique,
  registered_at date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cases (
  id text primary key,
  partner_id text not null references partners(id),
  client_name text not null,
  client_phone text,
  licence_type text not null,
  council text,
  step smallint not null default 0 check (step between 0 and 5),
  cancelled boolean not null default false,
  missing_docs text,
  submitted_at date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  price numeric(10,2),
  markup numeric(10,2),
  invoice_no text,
  client_paid boolean not null default false,
  client_paid_at date,
  notes_internal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cases_partner_id_idx on cases (partner_id);
create index cases_submitted_at_idx on cases (submitted_at);

create table case_steps_history (
  id bigserial primary key,
  case_id text not null references cases(id),
  step smallint not null check (step between 0 and 5),
  changed_at timestamptz not null default now(),
  changed_by text
);

create index case_steps_history_case_id_idx on case_steps_history (case_id);

create table case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references cases(id),
  storage_path text not null,
  filename text not null,
  kind text,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create index case_documents_case_id_idx on case_documents (case_id);

create table commissions (
  case_id text primary key references cases(id),
  code text not null check (code in ('A1','B1','C1')),
  amount numeric(10,2) not null,
  basis text not null,
  status text not null check (status in ('待处理','可发放','已支付','待付发票','已结清')),
  paid_at timestamptz,
  paid_by text,
  updated_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null
);

create table link_views (
  id bigserial primary key,
  partner_id text not null references partners(id),
  viewed_at timestamptz not null default now(),
  country text
);
create index link_views_partner_viewed_idx on link_views (partner_id, viewed_at desc);

create table audit_log (
  id bigserial primary key,
  staff_email text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb,
  at timestamptz not null default now()
);

create table case_counters (
  yymm text primary key,
  n int not null
);

-- updated_at maintenance
create function set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger partners_updated_at before update on partners for each row execute function set_updated_at();
create trigger cases_updated_at before update on cases for each row execute function set_updated_at();
create trigger commissions_updated_at before update on commissions for each row execute function set_updated_at();

-- ID generators
create function next_partner_id() returns text language sql set search_path = public as $$
  select 'TSP' || lpad(n::text, greatest(4, length(n::text)), '0') from (select nextval('partner_seq') as n) s
$$;

-- One atomic upsert: concurrent callers never share a number.
create function next_case_id(at timestamptz default now()) returns text language sql set search_path = public as $$
  with k as (select to_char(at at time zone 'Asia/Kuala_Lumpur', 'YYMM') as yymm),
  c as (
    insert into case_counters (yymm, n) select yymm, 1 from k
    on conflict (yymm) do update set n = case_counters.n + 1
    returning yymm, n
  )
  select 'TS-' || yymm || '-' || lpad(n::text, greatest(3, length(n::text)), '0') from c
$$;

-- Row level security: on everywhere, no policies.
alter table staff enable row level security;
alter table partners enable row level security;
alter table cases enable row level security;
alter table case_steps_history enable row level security;
alter table case_documents enable row level security;
alter table commissions enable row level security;
alter table settings enable row level security;
alter table link_views enable row level security;
alter table audit_log enable row level security;
alter table case_counters enable row level security;

-- Keep the ID functions away from the public API roles (Supabase only; guarded by pg_roles).
revoke execute on function next_partner_id() from public;
revoke execute on function next_case_id(timestamptz) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function next_partner_id() from anon;
    revoke execute on function next_case_id(timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function next_partner_id() from authenticated;
    revoke execute on function next_case_id(timestamptz) from authenticated;
  end if;
end $$;

-- Defence in depth (Supabase only; guarded by pg_roles): API roles get no table/sequence/function privileges.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke execute on functions from %I', r);
    end if;
  end loop;
end $$;

-- Default settings
insert into settings (key, value) values
  ('commission_rules', '{"A1":{"threshold":1500,"below":100,"above":150},"B1":{"partnerPricePercent":80,"collectBeforeSubmit":false},"C1":{"maxMarkup":null},"paidMarkedBy":"admin"}'::jsonb),
  ('licence_types', '["营业执照","招牌执照","清真认证 (JAKIM)","SSM 公司注册","消防证书 (BOMBA)"]'::jsonb),
  ('inactive_days', '90'::jsonb);

-- Private storage bucket (Supabase only; PGlite and plain Postgres have no storage schema).
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('case-documents','case-documents', false)
    on conflict (id) do nothing;
  end if;
end $$;
