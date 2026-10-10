-- The public course catalog (Home + Courses screens, pre-login) was reading
-- from static placeholder data in the Android app (ProgrammeRepository)
-- because `programmes` only ever had the bare columns
-- tryCreateDefaultPaymentPlan's FK lookup needed (name, department,
-- duration_years). Adding what the catalog actually displays, so it can be
-- wired to a real GET /programmes instead.

alter table programmes
  add column if not exists category text not null default 'General',
  add column if not exists mode text not null default 'Full-time',
  add column if not exists description text not null default '',
  add column if not exists intake_label text not null default '';

-- Backfill the one real seeded programme (test_data.sql) with sensible
-- values instead of leaving it on the bare defaults above.
update programmes
set category = 'Technology',
    description = 'Software, systems, and digital problem solving',
    intake_label = '2026/2027 intake open'
where name = 'Diploma in Computer Science & Digital Innovation' and category = 'General';
