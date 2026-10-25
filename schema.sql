

-- Official result copies (migration 040)
-- Official result copies uploaded by the admin. Removing one hides it from the statement and keeps the record with its reason.
create table if not exists official_result_slips (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id) on delete cascade,
  semester_name text not null,
  academic_year text not null,
  file_path text not null,
  file_type text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  removed boolean not null default false,
  removed_by text,
  removed_at timestamptz,
  removed_reason text
);
create index if not exists idx_official_result_slips_student on official_result_slips (student_row_id);
alter table official_result_slips enable row level security;
insert into storage.buckets (id, name, public) values ('official-results', 'official-results', false) on conflict (id) do nothing;
