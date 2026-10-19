-- Semester registration. The admin opens and closes registration for each semester. After the closing date, a
-- late window may stay open with a surcharge (50% by default). The student pays first, then the admin verifies
-- the payment and confirms the registration. Courses are assigned by the admin.
create table if not exists semester_windows (
  id uuid primary key default gen_random_uuid(),
  semester_name text not null references semesters(name),
  academic_year text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  late_closes_at timestamptz,
  late_surcharge_percent int not null default 50 check (late_surcharge_percent between 0 and 100),
  is_open boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (semester_name, academic_year)
);

create table if not exists student_course_assignments (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id) on delete cascade,
  semester_name text not null,
  academic_year text not null,
  course_code text not null,
  course_name text not null,
  assigned_by text,
  assigned_at timestamptz not null default now(),
  unique (student_row_id, semester_name, academic_year, course_code)
);

create table if not exists semester_registrations (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id) on delete cascade,
  semester_name text not null,
  academic_year text not null,
  status text not null default 'payment_due' check (status in ('payment_due', 'payment_pending', 'confirmed', 'payment_rejected')),
  amount_due numeric not null,
  late boolean not null default false,
  payment_method text check (payment_method in ('orange_money', 'cash')),
  payment_reference text,
  receipt_path text,
  receipt_type text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_reason text,
  confirmed_at timestamptz,
  unique (student_row_id, semester_name, academic_year)
);

alter table semester_windows enable row level security;
alter table student_course_assignments enable row level security;
alter table semester_registrations enable row level security;
insert into storage.buckets (id, name, public) values ('semester-receipts', 'semester-receipts', false) on conflict (id) do nothing;
