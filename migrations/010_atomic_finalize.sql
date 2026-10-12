-- Confirming a payment is one all-or-nothing step: lock the submission, allocate the
-- amount across the plan's periods, mark the payment verified, and write the receipt.
-- A repeat call (webhook retry, admin double-tap, two confirmations at once) waits on
-- the lock, then finds the payment already verified and changes nothing.

create or replace function finalize_payment(p_submission_id uuid, p_verified_by text)
returns jsonb
language plpgsql
as $$
declare
  sub payment_submissions%rowtype;
  stu students%rowtype;
  p payment_periods%rowtype;
  rem numeric;
  apply_amt numeric;
  new_paid numeric;
  prev_balance numeric;
  yr int := extract(year from now())::int;
  receipt_no text;
begin
  select * into sub from payment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;
  if sub.status = 'verified' then
    return jsonb_build_object('alreadyProcessed', true);
  end if;

  select * into stu from students where id = sub.student_row_id;

  select coalesce(sum(amount_due - amount_paid), 0) into prev_balance
    from payment_periods where payment_plan_id = sub.payment_plan_id;

  rem := sub.amount;
  for p in
    select * from payment_periods where payment_plan_id = sub.payment_plan_id
    order by period_index for update
  loop
    exit when rem <= 0;
    continue when p.amount_due - p.amount_paid <= 0;
    apply_amt := least(p.amount_due - p.amount_paid, rem);
    new_paid := p.amount_paid + apply_amt;
    update payment_periods
      set amount_paid = new_paid,
          status = case when new_paid >= p.amount_due then 'paid' else 'due' end
      where id = p.id;
    rem := rem - apply_amt;
  end loop;

  update payment_submissions
    set status = 'verified', verified_by = p_verified_by, verified_at = now()
    where id = p_submission_id;

  -- Receipt numbers are per year and must not repeat, so numbering is serialised.
  perform pg_advisory_xact_lock(hashtext('mtec_receipt_numbering'));
  receipt_no := format('MTEC/REC/%s/%s', yr,
    lpad((select count(*) + 1 from receipts
            where receipt_number like 'MTEC/REC/' || yr || '/%')::text, 5, '0'));

  insert into receipts (receipt_number, student_row_id, student_id_number, student_name, programme,
                        amount, method, received_by, previous_balance, new_balance)
  values (receipt_no, sub.student_row_id, stu.student_id, stu.full_name, stu.programme,
          sub.amount, case when sub.method = 'monime' then 'monime' else 'bank' end,
          p_verified_by, prev_balance, prev_balance - sub.amount + rem);

  return jsonb_build_object('alreadyProcessed', false, 'leftover', rem, 'receiptNumber', receipt_no);
end;
$$;
