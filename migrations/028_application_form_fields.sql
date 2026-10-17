-- Application form fields from the paper form: enrollment category, parent or guardian, and the declaration.
alter table applications add column if not exists enrollment_category text check (enrollment_category in ('self_funded', 'sponsored'));
alter table applications add column if not exists guardian jsonb not null default '{}';
alter table applications add column if not exists declaration_name text;
alter table applications add column if not exists declaration_date text;
