-- Individual staff and lecturer accounts. Additive only: nothing existing is changed.
-- The shared STAFF_API_KEY keeps working until every staff member has an account.
create table if not exists staff_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  full_name text not null,
  role text not null default 'staff' check (role in ('staff', 'lecturer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table staff_accounts enable row level security;
