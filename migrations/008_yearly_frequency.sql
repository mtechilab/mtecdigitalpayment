-- Students can pay by year as well as by day, week, month or semester.
alter table payment_plans drop constraint if exists payment_plans_frequency_check;
alter table payment_plans add constraint payment_plans_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly', 'semester', 'yearly'));
