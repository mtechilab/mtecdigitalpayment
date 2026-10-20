

-- Finance receipt photo (migration 033)
-- Cash taken at the office needs a photo of the receipt. The photo is stored privately for verification.
alter table payment_submissions add column if not exists finance_receipt_path text;
alter table payment_submissions add column if not exists finance_receipt_type text;
insert into storage.buckets (id, name, public) values ('finance-receipts', 'finance-receipts', false) on conflict (id) do nothing;
