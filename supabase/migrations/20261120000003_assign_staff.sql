-- Each partner has one responsible staff member; each case has the staff member handling it.
-- A case defaults to its partner's staff but can be handed to someone else. Reassigning a
-- partner does not move existing cases. Staff rows are never deleted (only deactivated), and
-- `on delete set null` keeps partners and cases safe if one ever is.
alter table partners add column assigned_staff text references staff(email) on delete set null;
alter table cases add column handled_by text references staff(email) on delete set null;
create index partners_assigned_staff_idx on partners (assigned_staff);
create index cases_handled_by_idx on cases (handled_by);
