-- Adds the administrator role to staff accounts. Widens the allowed values; existing rows are unchanged.
alter table staff_accounts drop constraint if exists staff_accounts_role_check;
alter table staff_accounts add constraint staff_accounts_role_check
  check (role in ('staff', 'lecturer', 'administrator'));
