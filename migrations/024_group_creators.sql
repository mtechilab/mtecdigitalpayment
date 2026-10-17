-- Any registered member can create a group, and any active student or staff member can be added.
alter table conversations add column if not exists created_by_kind text check (created_by_kind in ('student', 'staff'));
alter table conversations add column if not exists created_by_id uuid;
