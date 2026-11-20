-- The team 市场部 is now called Marketing (staff.team and partners.filled_by).
alter table partners drop constraint if exists partners_filled_by_check;
alter table staff drop constraint if exists staff_team_check;
update partners set filled_by = 'Marketing' where filled_by = '市场部';
update staff set team = 'Marketing' where team = '市场部';
alter table partners add constraint partners_filled_by_check check (filled_by in ('Transmission','Marketing','IT'));
alter table staff add constraint staff_team_check check (team in ('Transmission','Marketing','IT'));
