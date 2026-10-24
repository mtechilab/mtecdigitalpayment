-- Admin data editor: a change log nobody can edit or delete, and a check of everything that refers to a record,
-- so a record is only deleted when nothing in the system depends on it.
create table if not exists admin_change_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  table_name text not null,
  record_key text not null,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function admin_change_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'The change log cannot be edited or deleted.';
end $$;

drop trigger if exists trg_admin_change_log_immutable on admin_change_log;
create trigger trg_admin_change_log_immutable
  before update or delete on admin_change_log
  for each row execute function admin_change_log_immutable();

alter table admin_change_log enable row level security;

create or replace function admin_referencing_rows(p_table text, p_key text)
returns table(ref_table text, ref_column text, ref_count bigint)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  cnt bigint;
begin
  for r in
    select tc.table_name::text as rt, kcu.column_name::text as rc
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = p_table
  loop
    execute format('select count(*) from %I where %I::text = $1', r.rt, r.rc) into cnt using p_key;
    if cnt > 0 then
      ref_table := r.rt; ref_column := r.rc; ref_count := cnt;
      return next;
    end if;
  end loop;
end $$;
