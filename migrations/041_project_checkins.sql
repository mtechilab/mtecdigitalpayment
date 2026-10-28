-- Group projects and weekly check-ins. Admins and lecturers create projects; lecturers assign students;
-- students save drafts and submit a weekly check-in. A submitted check-in is never overwritten.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  course_code text,
  programme text,
  semester_name text not null,
  academic_year text,
  class_id uuid references classes(id) on delete set null,
  lecturer_staff_id uuid references staff_accounts(id),
  created_by text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  student_row_id uuid not null references students(id) on delete cascade,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  primary key (project_id, student_row_id)
);
create table if not exists project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  position int not null,
  title text not null,
  due_date date,
  unique (project_id, position)
);
create table if not exists project_checkins (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  student_row_id uuid not null references students(id) on delete cascade,
  week_number int not null check (week_number between 1 and 52),
  semester_name text not null,
  work_completed text,
  skills_learned text,
  challenges text,
  next_plan text,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  client_reference text unique,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, student_row_id, week_number)
);
alter table projects enable row level security;
alter table project_members enable row level security;
alter table project_milestones enable row level security;
alter table project_checkins enable row level security;
