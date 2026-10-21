-- Programme durations are editable: a course type, and a duration in months or years.
-- Certificates and short courses are usually in months; diplomas in years. Existing programmes keep their years.
alter table programmes add column if not exists course_type text check (course_type in ('short_course', 'certificate', 'diploma'));
alter table programmes add column if not exists duration_value int;
alter table programmes add column if not exists duration_unit text check (duration_unit in ('months', 'years'));
update programmes set duration_value = duration_years, duration_unit = 'years' where duration_value is null and duration_years is not null;
