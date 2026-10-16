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
