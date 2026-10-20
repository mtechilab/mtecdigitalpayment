-- Cash taken at the office is a payment method. The existing methods are kept, so no record is affected.
alter table payment_submissions drop constraint if exists payment_submissions_method_check;
alter table payment_submissions add constraint payment_submissions_method_check
  check (method in ('monime', 'bank', 'cash', 'orange_money'));
