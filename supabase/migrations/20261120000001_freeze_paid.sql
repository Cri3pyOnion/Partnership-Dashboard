-- An 已支付 commission never changes again, even if two requests race (a recalc that read the row
-- before mark-paid committed). Any update of such a row is ignored: the trigger returns the old row.
-- 已结清 (B1 settled) is frozen in app code instead, so an explicit un-settle (clientPaid false) still works.

create function freeze_paid_commission() returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = '已支付' then
    return old;
  end if;
  return new;
end $$;

-- Named to sort after commissions_updated_at: BEFORE triggers run in name order, so this one also
-- discards that trigger's updated_at change, and the paid row stays exactly as it was.
create trigger commissions_zz_freeze_paid before update on commissions
  for each row execute function freeze_paid_commission();
