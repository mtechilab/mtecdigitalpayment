-- A permanent record of admin decisions (payment verify/reject, application approve/reject).
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_audit_created on admin_audit_log (created_at desc);
alter table admin_audit_log enable row level security;
