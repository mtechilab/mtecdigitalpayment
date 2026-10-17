-- Students can create their own groups and add other students. Membership is stored in
-- conversation_members, the same table direct chats use.
alter table conversations drop constraint if exists conversations_kind_check;
alter table conversations add constraint conversations_kind_check check (kind in ('direct', 'programme', 'class', 'custom'));
alter table conversations add column if not exists created_by_student_id uuid references students(id);
