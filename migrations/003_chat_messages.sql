-- Run this in the Supabase SQL Editor for the mtecdigital project.
-- One thread per student — student <-> staff. Not a full multi-conversation
-- inbox (no groups, no departments) — that's a separate, larger phase.

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id),
  sender_type text not null check (sender_type in ('student', 'staff')),
  sender_name text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_by_student boolean not null default false,
  read_by_staff boolean not null default false
);

create index idx_chat_messages_student on chat_messages (student_row_id, created_at);

alter table chat_messages enable row level security;
-- Server-only table (service role bypasses RLS) — same pattern as every
-- other table here; nothing reads/writes this with the anon key.
