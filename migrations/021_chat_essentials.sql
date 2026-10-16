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
