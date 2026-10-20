-- A reference code for each cash payment, such as an Orange Money reference or a cash slip number.
alter table payment_submissions add column if not exists finance_reference text;
