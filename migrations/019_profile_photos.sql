-- Student profile photos: one private file per student, replaced on each upload.
-- Additive only. The file is reached through a short-lived signed link, never a public URL.
alter table students add column if not exists profile_photo_path text;

insert into storage.buckets (id, name, public) values ('profile-photos', 'profile-photos', false) on conflict (id) do nothing;
