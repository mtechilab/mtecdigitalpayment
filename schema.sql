

-- Finance visibility (migration 034)
-- Records which finance officer took each cash payment, so administrators can see it.
alter table payment_submissions add column if not exists finance_recorded_by text;
