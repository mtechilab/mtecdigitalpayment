-- Assignments: lecturers publish written work to a programme; students submit once before the due date;
-- lecturers grade with feedback. Additive only.
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff_accounts(id),
  owner_name text not null,
  title text not null,
  instructions text not null,
  programme text not null,
  course_code text not null default '',
  due_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_row_id uuid not null references students(id),
  body text not null,
  submitted_at timestamptz not null default now(),
  score int,
  feedback text,
  graded_at timestamptz,
  unique (assignment_id, student_row_id)
);
alter table assignments enable row level security;
alter table assignment_submissions enable row level security;
