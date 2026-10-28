

-- Check-in evidence (migration 042)
-- Evidence attached to a weekly check-in: photos and PDFs, stored privately.
create table if not exists project_checkin_attachments (
  id uuid primary key,
  checkin_id uuid not null references project_checkins(id) on delete cascade,
  student_row_id uuid not null references students(id) on delete cascade,
  file_path text not null,
  file_type text not null,
  size_bytes int not null,
  original_name text,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_checkin_attachments_checkin on project_checkin_attachments (checkin_id);
alter table project_checkin_attachments enable row level security;
insert into storage.buckets (id, name, public) values ('checkin-evidence', 'checkin-evidence', false) on conflict (id) do nothing;
