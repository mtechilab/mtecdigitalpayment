-- application_pins.source only allowed 'monime_payment' (bought a pin
-- online) or 'campus_sale' (bought in person) — neither honestly describes
-- a student submitting the public application form directly, which still
-- needs a stand-in pin row to satisfy applications.pin_id's NOT NULL FK.
-- Adds a third value rather than mislabeling these as a campus sale.
--
-- Run this after 002_admin_accounts.sql. If your Postgres didn't
-- auto-name the constraint application_pins_source_check, check
-- \d application_pins in psql and adjust the DROP line to match.

alter table application_pins drop constraint application_pins_source_check;
alter table application_pins add constraint application_pins_source_check
  check (source in ('monime_payment', 'campus_sale', 'online_application'));
