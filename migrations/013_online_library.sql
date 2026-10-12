-- Online library: approved course material with versions, approval, and private storage.
-- Additive only. Files live in a PRIVATE bucket and are reached through short-lived signed links.
create table if not exists library_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  programme text not null,
  course_code text not null default '',
  semester text not null default '',
  academic_year text not null,
  topic text not null default '',
  material_type text not null check (material_type in ('pdf', 'pptx', 'docx', 'image')),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'published', 'rejected')),
  uploaded_by_staff_id uuid references staff_accounts(id),
  uploaded_by_name text not null,
  current_version int not null default 1,
  published_version int,
  published_at timestamptz,
  approved_by text,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create table if not exists library_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references library_items(id) on delete cascade,
  version int not null,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes int not null,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  unique (item_id, version)
);
create index if not exists idx_library_items_published on library_items (published_version);
alter table library_items enable row level security;
alter table library_versions enable row level security;
insert into storage.buckets (id, name, public) values ('library', 'library', false) on conflict (id) do nothing;
