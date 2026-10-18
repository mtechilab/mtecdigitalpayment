-- The student record created when an accepted application is approved, so the applicant can find their login.
alter table applications add column if not exists student_id text;
