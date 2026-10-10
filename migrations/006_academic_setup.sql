-- Academic setup: admin-managed masters for the dropdowns on every academic form.
-- programmes stays the single programme master (payment plans already FK to it).
-- Applicants who type a programme that isn't on the list don't create one
-- directly — they create a programme_requests row the admin reviews.

create table if not exists academic_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists programme_requests (
  id uuid primary key default gen_random_uuid(),
  programme_name text not null,
  application_id uuid references applications(id),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists idx_programme_requests_status on programme_requests (status);

insert into academic_levels (name, sort_order) values
  ('Year 1', 1), ('Year 2', 2), ('Year 3', 3), ('Year 4', 4)
on conflict (name) do nothing;

insert into semesters (name, sort_order) values
  ('Semester 1', 1), ('Semester 2', 2)
on conflict (name) do nothing;

alter table academic_levels enable row level security;
alter table semesters enable row level security;
alter table programme_requests enable row level security;
