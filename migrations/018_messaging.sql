-- MTeC Connect: direct chats and groups, text and voice notes.
-- Group access is checked when a message is read or sent, from programme and class records,
-- so membership never goes stale. Direct chats keep an explicit member list.
-- Requires migration 012 (staff_accounts) and the existing students and classes tables.
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
