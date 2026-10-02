-- One thread per student (all their messages, both directions, in one
-- table) rather than a separate "conversations" table — simplest thing
-- that supports both ChatActivity (student's own thread) and
-- AdminChatActivity (staff replying into one student's thread).

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  student_row_id uuid not null references students(id),
  sender_type text not null check (sender_type in ('student', 'staff')),
  sender_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_student on chat_messages (student_row_id, created_at);
