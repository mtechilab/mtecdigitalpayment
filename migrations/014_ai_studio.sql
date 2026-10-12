-- AI Learning Studio: lecturer drafts, versions and approvals, plus a monthly usage counter.
-- Additive only. Drafts never reach students from here.
create table if not exists ai_drafts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  version int not null default 1,
  owner_staff_id uuid not null references staff_accounts(id),
  owner_name text not null,
  kind text not null check (kind in ('course_outline', 'syllabus', 'lesson_plan', 'lecture_notes', 'assignment', 'quiz', 'revision_notes')),
  title text not null,
  programme text not null,
  course_code text not null default '',
  topic text not null default '',
  instructions text not null default '',
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, version)
);
create table if not exists ai_usage (
  month text primary key,
  calls int not null default 0,
  tokens int not null default 0
);
alter table ai_drafts enable row level security;
alter table ai_usage enable row level security;
