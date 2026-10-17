-- =====================================================================
-- MTeC Digital Campus — Supabase schema
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
-- Mirrors src/types/index.ts field-for-field so the client/server code
-- maps onto these tables without translation logic.
-- =====================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---- System settings (single row) ----------------------------------

create table system_settings (
  id int primary key default 1,
  application_fee numeric not null default 100,
  currency text not null default 'NLe',
  active_academic_year text not null default '2026',
  active_intake text not null default 'September 2026',
  constraint single_row check (id = 1)
);
insert into system_settings (id) values (1) on conflict do nothing;

-- ---- Payment transactions -------------------------------------------

create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  external_reference text,
  amount numeric not null,
  currency text not null default 'NLe',
  purpose text not null default 'application_fee',
  method text not null check (method in ('monime', 'cash', 'bank', 'other')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- Application PINs -------------------------------------------------

create table application_pins (
  id uuid primary key default gen_random_uuid(),
  pin text not null unique,
  password_hash text,
  academic_year text not null,
  intake text not null,
  status text not null default 'generated'
    check (status in ('generated', 'active', 'used', 'expired', 'revoked')),
  source text not null check (source in ('monime_payment', 'campus_sale')),
  applicant_name text not null,
  applicant_phone text not null,
  applicant_email text,
  programme_interest text not null,
  payment_transaction_id uuid references payment_transactions(id),
  issued_by text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  used_at timestamptz
);
create index idx_application_pins_pin on application_pins (pin);

-- ---- Applications -------------------------------------------------

create table applications (
  id uuid primary key default gen_random_uuid(),
  application_number text unique,
  pin_id uuid not null references application_pins(id),
  status text not null default 'draft'
    check (status in ('draft','submitted','under_review','info_required','approved','rejected','offer_issued','accepted')),
  full_name text not null default '',
  other_name text not null default '',
  gender text not null default '',
  date_of_birth text not null default '',
  nationality text not null default 'Sierra Leonean',
  phone text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  address text not null default '',
  district text not null default '',
  city_town text not null default '',
  academic_year text not null default '',
  intake text not null default '',
  programme text not null default '',
  study_mode text not null default 'Full-time',
  education jsonb not null default '[]',
  emergency_contact jsonb not null default '{"name":"","relationship":"","phone":"","address":""}',
  documents jsonb not null default '[]',
  declaration_confirmed boolean not null default false,
  rejection_reason text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index idx_applications_pin_id on applications (pin_id);
create index idx_applications_status on applications (status);

-- ---- Offer letters -------------------------------------------------

create table offer_letters (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id),
  student_name text not null,
  application_number text not null,
  programme text not null,
  academic_year text not null,
  admission_conditions text not null,
  fees_amount numeric not null,
  reporting_date text not null,
  authorized_signatory text not null,
  generated_at timestamptz not null default now(),
  acceptance_deadline timestamptz not null
);
create index idx_offer_letters_application_id on offer_letters (application_id);

-- ---- Students -------------------------------------------------

create table students (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  student_pin text not null,
  password_hash text,
  first_login_complete boolean not null default false,
  application_id uuid not null references applications(id),
  full_name text not null,
  phone text not null,
  email text not null default '',
  programme text not null,
  academic_year text not null,
  level text not null default 'Year 1',
  status text not null default 'active' check (status in ('active','inactive','graduated','withdrawn')),
  created_at timestamptz not null default now()
  profile_photo_path text
);
create index idx_students_student_id on students (student_id);

create table acceptance_letters (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id),
  offer_letter_id uuid not null references offer_letters(id),
  student_id_number text not null,
  generated_at timestamptz not null default now()
);

-- ---- Finance -------------------------------------------------

create table fee_structures (
  programme text primary key,
  registration_fee numeric not null default 500,
  tuition_per_semester numeric not null default 1500
);

create table student_invoices (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id),
  description text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  student_row_id uuid not null references students(id),
  student_id_number text not null,
  student_name text not null,
  programme text not null,
  amount numeric not null,
  method text not null check (method in ('cash','bank','monime')),
  date timestamptz not null default now(),
  received_by text not null,
  previous_balance numeric not null,
  new_balance numeric not null
);
create index idx_receipts_student on receipts (student_row_id);

-- ---- Programmes (first-class record — duration lives here, not
-- ---- scattered as a string across applications/students/courses) ------

create table programmes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  department text not null default '',
  duration_years numeric not null,       -- e.g. 2 — drives "Programme Duration: 2 Years" in the UI
  duration_label text not null default '', -- optional override, e.g. "2 Years" vs "24 Months"
  category text not null default 'General',     -- public catalogue grouping (Technology / Business / ...)
  mode text not null default 'Full-time',
  description text not null default '',
  intake_label text not null default ''
);

-- ---- Payment Plans (Watu-inspired student payment experience) ---------
--
-- Design, matching the spec's "Critical Rules" section:
-- - A payment plan's duration is SEPARATE from programme duration
--   (a plan might cover one semester; the programme spans years).
-- - Frequency is configurable (daily/weekly/monthly/semester), not
--   hardcoded per screen.
-- - The plan generates a fixed schedule of periods up front (so
--   "September: PAID, October: DUE, November: UPCOMING" is just reading
--   rows, never recalculated ad hoc in the UI).
-- - Every payment belongs to exactly one plan period.
-- - Provider references must be unique across ALL payment submissions —
--   enforced with a real unique constraint, not just app-level checking,
--   so a reused Orange Money reference is rejected at the database level
--   even if two requests race each other.

create table payment_plans (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id),
  programme_id uuid not null references programmes(id),
  label text not null,                  -- e.g. "Semester 1"
  frequency text not null check (frequency in ('daily','weekly','monthly','semester','yearly')),
  period_amount numeric not null,       -- amount due per period, e.g. 750 for monthly
  total_amount numeric not null,        -- sum across the whole plan, e.g. 3000
  plan_start_date date not null,
  plan_end_date date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now()
);
create index idx_payment_plans_student on payment_plans (student_row_id);

-- One row per period in the schedule (September, October, November...),
-- generated when the plan is created — not computed on the fly. This is
-- what "✓ September PAID / ◐ October DUE / ○ November UPCOMING" reads from.
create table payment_periods (
  id uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references payment_plans(id),
  period_label text not null,           -- e.g. "September 2026"
  period_index int not null,            -- 1, 2, 3... — display order
  due_date date not null,
  amount_due numeric not null,
  amount_paid numeric not null default 0,
  status text not null default 'upcoming' check (status in ('upcoming','due','overdue','paid')),
  unique (payment_plan_id, period_index)
);
create index idx_payment_periods_plan on payment_periods (payment_plan_id);

-- Every payment attempt — digital (Monime, instant) or manual (Orange
-- Money/Agent/Cash/Alt Account, pending finance verification) — is one
-- row here. This is intentionally separate from `receipts`: a receipt is
-- proof of a CONFIRMED payment; a submission is a claim that may still
-- need verification. A submission becomes a receipt only once verified.
create table payment_submissions (
  id uuid primary key default gen_random_uuid(),
  mtec_reference text not null unique,   -- e.g. MTEC-2026-00125-P02, generated server-side
  payment_plan_id uuid not null references payment_plans(id),
  payment_period_id uuid references payment_periods(id), -- null if covering multiple periods
  student_row_id uuid not null references students(id),
  amount numeric not null,
  method text not null check (method in ('monime','orange_money','orange_money_agent','cash_deposit','alternative_account')),
  provider_reference text,               -- student-entered ref for manual methods; null for Monime until confirmed
  status text not null default 'pending' check (status in ('pending','under_review','verified','rejected','failed')),
  verified_by text,                      -- finance officer name, for manual methods
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
  proof_path text,
  proof_uploaded_at timestamptz
  monime_order_number text,
  monime_payload jsonb,
  webhook_received_at timestamptz
);
create index idx_payment_submissions_plan on payment_submissions (payment_plan_id);
create index idx_payment_submissions_student on payment_submissions (student_row_id);

-- Enforces "Provider references cannot be reused" at the database level —
-- a partial unique index so it only applies where a reference was actually
-- given (Monime submissions may not have one until the webhook fills it in).
create unique index idx_unique_provider_reference
  on payment_submissions (method, provider_reference)
  where provider_reference is not null;

-- ---- Academics -------------------------------------------------

create table courses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  programme text not null,
  level text not null,
  semester text not null,
  credit_units int not null default 3
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  instructor_name text not null,
  academic_year text not null,
  student_ids uuid[] not null default '{}'
);

create table timetable_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id),
  day_of_week text not null check (day_of_week in ('Mon','Tue','Wed','Thu','Fri','Sat')),
  start_time text not null,
  end_time text not null,
  room text not null
);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id),
  student_row_id uuid not null references students(id),
  date date not null,
  mark text not null check (mark in ('present','absent','late','excused')),
  unique (class_id, student_row_id, date)
);

create table assessment_items (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id),
  name text not null,
  max_score numeric not null,
  weight numeric not null
);

create table marks (
  id uuid primary key default gen_random_uuid(),
  assessment_item_id uuid not null references assessment_items(id),
  class_id uuid not null references classes(id),
  student_row_id uuid not null references students(id),
  score numeric not null,
  unique (assessment_item_id, student_row_id)
);

create table result_batches (
  class_id uuid primary key references classes(id),
  status text not null default 'draft' check (status in ('draft','pending_review','published')),
  sent_back_reason text,
  submitted_at timestamptz,
  published_at timestamptz
);

create table result_audit (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id),
  class_id uuid not null references classes(id),
  old_score numeric,
  new_score numeric not null,
  changed_by text not null,
  reason text not null,
  timestamp timestamptz not null default now()
);

-- ---- Webhook idempotency (server-side use only) ----------------------

create table processed_webhook_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security
--
-- TEMPORARY / PERMISSIVE for the current stage of this build: the admin
-- side has no Supabase Auth yet (flagged elsewhere in this project), so
-- these policies allow the anon key broad read/write access needed for
-- the app to function end-to-end right now. THIS IS NOT SAFE FOR A REAL
-- PRODUCTION LAUNCH — before going live, replace these with policies
-- scoped to authenticated staff roles (see the README section on this).
-- =====================================================================

alter table system_settings enable row level security;
alter table payment_transactions enable row level security;
alter table application_pins enable row level security;
alter table applications enable row level security;
alter table offer_letters enable row level security;
alter table students enable row level security;
alter table acceptance_letters enable row level security;
alter table fee_structures enable row level security;
alter table student_invoices enable row level security;
alter table receipts enable row level security;
alter table programmes enable row level security;
alter table payment_plans enable row level security;
alter table payment_periods enable row level security;
alter table payment_submissions enable row level security;
alter table courses enable row level security;
alter table classes enable row level security;
alter table timetable_slots enable row level security;
alter table attendance_records enable row level security;
alter table assessment_items enable row level security;
alter table marks enable row level security;
alter table result_batches enable row level security;
alter table result_audit enable row level security;
alter table processed_webhook_events enable row level security;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'system_settings','payment_transactions','application_pins','applications',
      'offer_letters','students','acceptance_letters','fee_structures',
      'student_invoices','receipts','programmes','payment_plans','payment_periods',
      'payment_submissions','courses','classes','timetable_slots',
      'attendance_records','assessment_items','marks','result_batches','result_audit'
    ])
  loop
    execute format(
      'create policy "temp_allow_all_%1$s" on %1$s for all using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- processed_webhook_events is server-only (service role bypasses RLS
-- anyway) — no anon policy needed, so anon has zero access to it.

-- ---- Academic setup (migration 006) ----------------------------------
create table academic_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create table semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create table programme_requests (
  id uuid primary key default gen_random_uuid(),
  programme_name text not null,
  application_id uuid references applications(id),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index idx_programme_requests_status on programme_requests (status);
insert into academic_levels (name, sort_order) values ('Year 1', 1), ('Year 2', 2), ('Year 3', 3), ('Year 4', 4);
insert into semesters (name, sort_order) values ('Semester 1', 1), ('Semester 2', 2);
alter table academic_levels enable row level security;
alter table semesters enable row level security;
alter table programme_requests enable row level security;

insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;

-- Payment confirmation as one transaction (migration 010)
create or replace function finalize_payment(p_submission_id uuid, p_verified_by text)
returns jsonb
language plpgsql
as $$
declare
  sub payment_submissions%rowtype;
  stu students%rowtype;
  p payment_periods%rowtype;
  rem numeric;
  apply_amt numeric;
  new_paid numeric;
  prev_balance numeric;
  yr int := extract(year from now())::int;
  receipt_no text;
begin
  select * into sub from payment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;
  if sub.status = 'verified' then
    return jsonb_build_object('alreadyProcessed', true);
  end if;

  select * into stu from students where id = sub.student_row_id;

  select coalesce(sum(amount_due - amount_paid), 0) into prev_balance
    from payment_periods where payment_plan_id = sub.payment_plan_id;

  rem := sub.amount;
  for p in
    select * from payment_periods where payment_plan_id = sub.payment_plan_id
    order by period_index for update
  loop
    exit when rem <= 0;
    continue when p.amount_due - p.amount_paid <= 0;
    apply_amt := least(p.amount_due - p.amount_paid, rem);
    new_paid := p.amount_paid + apply_amt;
    update payment_periods
      set amount_paid = new_paid,
          status = case when new_paid >= p.amount_due then 'paid' else 'due' end
      where id = p.id;
    rem := rem - apply_amt;
  end loop;

  update payment_submissions
    set status = 'verified', verified_by = p_verified_by, verified_at = now()
    where id = p_submission_id;

  -- Receipt numbers are per year and must not repeat, so numbering is serialised.
  perform pg_advisory_xact_lock(hashtext('mtec_receipt_numbering'));
  receipt_no := format('MTEC/REC/%s/%s', yr,
    lpad((select count(*) + 1 from receipts
            where receipt_number like 'MTEC/REC/' || yr || '/%')::text, 5, '0'));

  insert into receipts (receipt_number, student_row_id, student_id_number, student_name, programme,
                        amount, method, received_by, previous_balance, new_balance)
  values (receipt_no, sub.student_row_id, stu.student_id, stu.full_name, stu.programme,
          sub.amount, case when sub.method = 'monime' then 'monime' else 'bank' end,
          p_verified_by, prev_balance, prev_balance - sub.amount + rem);

  return jsonb_build_object('alreadyProcessed', false, 'leftover', rem, 'receiptNumber', receipt_no);
end;
$$;

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index idx_admin_audit_created on admin_audit_log (created_at desc);
alter table admin_audit_log enable row level security;

create table staff_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  full_name text not null,
  role text not null default 'staff' check (role in ('staff', 'lecturer', 'administrator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table staff_accounts enable row level security;

-- Online library (migration 013)
create table library_items (
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
create table library_versions (
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
create index idx_library_items_published on library_items (published_version);
alter table library_items enable row level security;
alter table library_versions enable row level security;
insert into storage.buckets (id, name, public) values ('library', 'library', false) on conflict (id) do nothing;

-- AI Learning Studio (migration 014)
create table ai_drafts (
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
create table ai_usage (
  month text primary key,
  calls int not null default 0,
  tokens int not null default 0
);
alter table ai_drafts enable row level security;
alter table ai_usage enable row level security;

-- Interactive learning: quizzes (migration 016)
create table quizzes (
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
create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  position int not null,
  question text not null,
  options jsonb not null,
  correct_index int not null,
  unique (quiz_id, position)
);
create table quiz_attempts (
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

-- Assignments (migration 017)
create table assignments (
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
create table assignment_submissions (
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

-- MTeC Connect (migration 018)
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'programme', 'class')),
  title text not null,
  programme text,
  class_id uuid references classes(id),
  created_by_staff_id uuid references staff_accounts(id),
  created_by_name text not null default '',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind <> 'programme') or (programme is not null)),
  check ((kind <> 'class') or (class_id is not null))
);
create unique index if not exists uq_conversation_programme on conversations (programme) where kind = 'programme';
create unique index if not exists uq_conversation_class on conversations (class_id) where kind = 'class';

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  member_kind text not null check (member_kind in ('student', 'staff')),
  member_id uuid not null,
  member_name text not null,
  primary key (conversation_id, member_kind, member_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('student', 'staff')),
  sender_id uuid not null,
  sender_name text not null,
  kind text not null check (kind in ('text', 'voice')),
  body text,
  voice_path text,
  voice_seconds int,
  created_at timestamptz not null default now(),
  check ((kind <> 'text') or (body is not null)),
  check ((kind <> 'voice') or (voice_path is not null))
);
create index if not exists idx_messages_conversation on messages (conversation_id, created_at);

create table if not exists conversation_reads (
  conversation_id uuid not null references conversations(id) on delete cascade,
  reader_kind text not null check (reader_kind in ('student', 'staff')),
  reader_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, reader_kind, reader_id)
);

alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table conversation_reads enable row level security;

insert into storage.buckets (id, name, public) values ('voice-notes', 'voice-notes', false) on conflict (id) do nothing;

-- Student profile photos (migration 019)
insert into storage.buckets (id, name, public) values ('profile-photos', 'profile-photos', false) on conflict (id) do nothing;

-- Chat attachments (migration 020)
-- Chat: photos and documents, and student-to-student direct chats (direct chats need no schema change).
alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check check (kind in ('text', 'voice', 'image', 'file'));
alter table messages add column if not exists file_path text;
alter table messages add column if not exists file_name text;
alter table messages add column if not exists file_type text;
alter table messages add column if not exists file_size int;
alter table messages drop constraint if exists messages_file_path_check;
alter table messages add constraint messages_file_path_check check ((kind not in ('image', 'file')) or file_path is not null);
insert into storage.buckets (id, name, public) values ('chat-files', 'chat-files', false) on conflict (id) do nothing;

-- Chat essentials (migration 021)
-- Chat essentials: replies, delete for me or everyone, reactions, and typing.
-- Read receipts use conversation_reads, which already exists.
alter table messages add column if not exists reply_to uuid references messages(id) on delete set null;
alter table messages add column if not exists deleted_for_everyone boolean not null default false;

create table if not exists message_hidden (
  message_id uuid not null references messages(id) on delete cascade,
  viewer_kind text not null check (viewer_kind in ('student', 'staff')),
  viewer_id uuid not null,
  primary key (message_id, viewer_kind, viewer_id)
);

create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  reactor_kind text not null check (reactor_kind in ('student', 'staff')),
  reactor_id uuid not null,
  reaction text not null check (reaction in ('like', 'love', 'laugh', 'wow', 'sad', 'pray')),
  created_at timestamptz not null default now(),
  primary key (message_id, reactor_kind, reactor_id)
);

create table if not exists conversation_typing (
  conversation_id uuid not null references conversations(id) on delete cascade,
  member_kind text not null check (member_kind in ('student', 'staff')),
  member_id uuid not null,
  member_name text not null,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, member_kind, member_id)
);

alter table message_hidden enable row level security;
alter table message_reactions enable row level security;
alter table conversation_typing enable row level security;

-- In-app calls (migration 022)
-- In-app calls between two people in a direct chat. Signalling only: the phones exchange
-- connection details through these rows; the audio and video flow directly between them.
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  caller_kind text not null check (caller_kind in ('student', 'staff')),
  caller_id uuid not null,
  caller_name text not null,
  callee_kind text not null check (callee_kind in ('student', 'staff')),
  callee_id uuid not null,
  mode text not null check (mode in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int
);
create index if not exists idx_calls_callee on calls (callee_kind, callee_id, status);
create index if not exists idx_calls_conversation on calls (conversation_id, status);

create table if not exists call_signals (
  id bigserial primary key,
  call_id uuid not null references calls(id) on delete cascade,
  from_kind text not null check (from_kind in ('student', 'staff')),
  from_id uuid not null,
  to_kind text not null check (to_kind in ('student', 'staff')),
  to_id uuid not null,
  kind text not null check (kind in ('offer', 'answer', 'ice', 'hangup')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_call_signals_call on call_signals (call_id, id);

alter table calls enable row level security;
alter table call_signals enable row level security;

-- Student groups (migration 023)
-- Students can create their own groups and add other students. Membership is stored in
-- conversation_members, the same table direct chats use.
alter table conversations drop constraint if exists conversations_kind_check;
alter table conversations add constraint conversations_kind_check check (kind in ('direct', 'programme', 'class', 'custom'));
alter table conversations add column if not exists created_by_student_id uuid references students(id);

-- Group creators: students and staff (migration 024)
-- Any registered member can create a group, and any active student or staff member can be added.
alter table conversations add column if not exists created_by_kind text check (created_by_kind in ('student', 'staff'));
alter table conversations add column if not exists created_by_id uuid;

-- Application fees and payments (migration 027)
-- Application fees: set by the admin per programme level. Applicants pay to the Orange Money number
-- shown on the form, or pay cash and upload a receipt. Payments are reviewed before the application is decided.
create table if not exists application_fees (
  level text primary key check (level in ('certificate', 'diploma')),
  amount numeric not null check (amount > 0),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into application_fees (level, amount) values ('certificate', 100), ('diploma', 200) on conflict (level) do nothing;

alter table applications add column if not exists programme_level text check (programme_level in ('certificate', 'diploma'));

create table if not exists application_payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  method text not null check (method in ('orange_money', 'cash')),
  amount numeric not null check (amount > 0),
  reference text,
  receipt_path text,
  receipt_type text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  review_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  check ((method <> 'orange_money') or (reference is not null)),
  check ((method <> 'cash') or (receipt_path is not null))
);
create index if not exists idx_application_payments_app on application_payments (application_id, status);

alter table application_fees enable row level security;
alter table application_payments enable row level security;
insert into storage.buckets (id, name, public) values ('application-receipts', 'application-receipts', false) on conflict (id) do nothing;

-- Application form fields (migration 028)
-- Application form fields from the paper form: enrollment category, parent or guardian, and the declaration.
alter table applications add column if not exists enrollment_category text check (enrollment_category in ('self_funded', 'sponsored'));
alter table applications add column if not exists guardian jsonb not null default '{}';
alter table applications add column if not exists declaration_name text;
alter table applications add column if not exists declaration_date text;
