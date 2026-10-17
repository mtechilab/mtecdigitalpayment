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
