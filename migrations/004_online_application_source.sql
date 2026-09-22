-- Run this in the Supabase SQL Editor for the mtecdigital project.
-- Adds 'online_application' as a valid application_pins.source value —
-- the existing constraint only allowed 'monime_payment' and 'campus_sale',
-- neither of which honestly describes a prospective student submitting
-- the public application form themselves.

-- If this fails with "constraint does not exist", find the real name first:
--   select conname from pg_constraint where conrelid = 'application_pins'::regclass and contype = 'c';
-- then substitute it below.
alter table application_pins drop constraint application_pins_source_check;
alter table application_pins add constraint application_pins_source_check
  check (source in ('monime_payment', 'campus_sale', 'online_application'));
