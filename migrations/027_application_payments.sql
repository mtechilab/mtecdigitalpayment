-- Application fees: set by the admin per programme level. Applicants pay to the Orange Money number
-- shown on the form, or pay cash and upload a receipt. Payments are reviewed before the application is decided.
create table if not exists application_fees (
  level text primary key check (level in ('certificate', 'diploma')),
  amount numeric not null check (amount > 0),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into application_fees (level, amount) values ('certificate', 100), ('diploma', 200) on conflict (level) do nothing;

alter table applications add column if not exists programme_level text check (programme_level in ('certificate', 'diploma'));

create table if not exists application_payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  method text not null check (method in ('orange_money', 'cash')),
  amount numeric not null check (amount > 0),
  reference text,
  receipt_path text,
  receipt_type text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  review_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  check ((method <> 'orange_money') or (reference is not null)),
  check ((method <> 'cash') or (receipt_path is not null))
);
create index if not exists idx_application_payments_app on application_payments (application_id, status);

alter table application_fees enable row level security;
alter table application_payments enable row level security;
insert into storage.buckets (id, name, public) values ('application-receipts', 'application-receipts', false) on conflict (id) do nothing;
