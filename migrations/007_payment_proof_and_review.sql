-- Students can say they've paid (with the Monime order number and/or a screenshot).
-- Anything they claim goes to 'under_review', which the admin queue shows for
-- every method — not just cash — so an admin can confirm it by hand.

alter table payment_submissions add column if not exists proof_path text;
alter table payment_submissions add column if not exists proof_uploaded_at timestamptz;

-- Private bucket for payment screenshots. Only the server (service role) reads or writes it;
-- admins see a screenshot through the admin API, never a public link.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;
