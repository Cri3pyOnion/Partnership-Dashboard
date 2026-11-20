-- Partner page views can be refreshed by anyone holding a link. Bound what that costs:
--   * at most one row per partner per country every 30 minutes (repeat views are dropped);
--   * only the newest 100 rows per partner are kept.
-- One call does both, under a per-partner lock so concurrent requests cannot double-insert.
create function log_link_view(p_partner text, p_country text) returns boolean
language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('link_views:' || p_partner));
  if exists (
    select 1 from link_views
    where partner_id = p_partner and country is not distinct from p_country
      and viewed_at > now() - interval '30 minutes'
  ) then
    return false;
  end if;
  insert into link_views (partner_id, country) values (p_partner, p_country);
  delete from link_views
  where partner_id = p_partner
    and id not in (
      select id from link_views where partner_id = p_partner
      order by viewed_at desc, id desc limit 100
    );
  return true;
end
$$;

-- Same exposure as the other functions: the service role only.
revoke execute on function log_link_view(text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function log_link_view(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function log_link_view(text, text) from authenticated;
  end if;
end $$;

-- Trim what earlier, unthrottled logging stored.
delete from link_views v
where v.id not in (
  select id from (
    select id, row_number() over (partition by partner_id order by viewed_at desc, id desc) as rn
    from link_views
  ) ranked where rn <= 100
);
