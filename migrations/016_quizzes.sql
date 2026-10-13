-- Interactive learning: multiple-choice quizzes written by lecturers, published to a programme,
-- and attempted once by each student. Correct answers are never sent to students before they submit.
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff_accounts(id),
  owner_name text not null,
  title text not null,
  programme text not null,
  course_code text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  position int not null,
  question text not null,
  options jsonb not null,
  correct_index int not null,
  unique (quiz_id, position)
);
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  student_row_id uuid not null references students(id),
  score int not null,
  total int not null,
  answers jsonb not null,
  submitted_at timestamptz not null default now(),
  unique (quiz_id, student_row_id)
);
alter table quizzes enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;
