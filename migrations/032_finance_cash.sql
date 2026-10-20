-- Finance officers: a staff role that records cash. Cash payments carry a client reference, so a payment that is
-- sent twice (offline sync, a retry) is recorded once.
alter table staff_accounts drop constraint if exists staff_accounts_role_check;
alter table staff_accounts add constraint staff_accounts_role_check check (role in ('staff', 'lecturer', 'administrator', 'finance'));
alter table payment_submissions add column if not exists client_reference text unique;
