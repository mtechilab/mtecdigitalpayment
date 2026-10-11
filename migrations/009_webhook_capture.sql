-- Keep what Monime sends for each payment, before confirmation can fail,
-- so an admin can check a payment against Monime's own record.
alter table payment_submissions add column if not exists monime_order_number text;
alter table payment_submissions add column if not exists monime_payload jsonb;
alter table payment_submissions add column if not exists webhook_received_at timestamptz;
