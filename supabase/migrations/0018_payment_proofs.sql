-- 0018 (session B2, build plan 1.6): payment screenshots.
-- A customer who pays by Whish or OMT sends a picture of the receipt. The picture is copied at once into the private
-- `media` bucket (never a Meta link, never logged), recorded here against the order that is waiting for payment, and queued
-- for the ops lead. An optional model read may pre-fill the amount and the reference. It is a suggestion for a person and
-- nothing else: only review_payment_proof() by the ops lead, through confirm_payment(), moves money (invariants 4 and 12).

create table if not exists payment_proofs (
  id              uuid primary key default gen_random_uuid(),
  party_id        uuid not null references parties(id),
  order_id        uuid references orders(id),
  wa_message_id   text not null unique,              -- one row per screenshot: a retried turn finds it and changes nothing
  media_path      text not null,                     -- key in the private `media` bucket
  media_sha256    text not null,
  mime_type       text,
  status          text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  extracted       jsonb,                             -- the optional model read (PaymentProof schema): a pre-fill, never a fact
  reused_image    boolean not null default false,    -- the same picture was already sent for another order
  reviewed_by     uuid references parties(id),
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now());
create index if not exists payment_proofs_open on payment_proofs(created_at) where status = 'pending';
create index if not exists payment_proofs_sha on payment_proofs(media_sha256);
alter table payment_proofs enable row level security;

insert into settings(key, value) values ('payment_proofs', '{"model_read": true}') on conflict (key) do nothing;

-- The order a screenshot would pay for: the customer's most recent order waiting for a transfer. Null means a picture is just a picture.
create or replace function payment_expected(p_party uuid) returns jsonb language sql stable as $$
  select to_jsonb(x) from (
    select o.id as order_id, o.short_code, o.total_usd, o.payment_method from orders o
     where o.customer_id = p_party and o.status = 'awaiting_payment' and o.payment_method in ('whish','omt')
       and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')
     order by o.created_at desc limit 1) x $$;

-- Records a stored screenshot against the order waiting for it. Safe to call again with the same message: nothing doubles.
-- The payment row moves to proof_submitted (confirm_payment() later confirms it), and the ops queue gets one case per proof.
create or replace function submit_payment_proof(p_party uuid, p_wamid text, p_media_path text, p_sha256 text, p_mime text default null)
returns jsonb language plpgsql as $$
declare v_pay jsonb := payment_expected(p_party); v_order uuid := (v_pay->>'order_id')::uuid; v_id uuid; v_reused boolean; o orders%rowtype; v_prior jsonb;
begin
  select jsonb_build_object('proof_id', p.id, 'order_id', p.order_id, 'short_code', x.short_code, 'total_usd', x.total_usd,
                            'method', x.payment_method, 'reused_image', p.reused_image, 'already', true)
    into v_prior from payment_proofs p join orders x on x.id = p.order_id where p.wa_message_id = p_wamid;
  if v_prior is not null then return v_prior; end if;
  if v_order is null then return jsonb_build_object('proof_id', null, 'order_id', null, 'reason', 'no_order_awaiting_payment'); end if;
  select * into o from orders where id = v_order for update;
  -- The same picture for a different order is a flag for the person reviewing. The customer is not accused of anything.
  v_reused := exists (select 1 from payment_proofs where media_sha256 = p_sha256 and order_id is distinct from v_order);
  insert into payment_proofs(party_id, order_id, wa_message_id, media_path, media_sha256, mime_type, reused_image)
    values (p_party, v_order, p_wamid, p_media_path, p_sha256, p_mime, v_reused) returning id into v_id;
  -- payments_hash_once (0001) lets one picture back one payment only: a reused picture is recorded and flagged, not attached.
  update payments set status = 'proof_submitted', proof_media_path = p_media_path, proof_hash = case when v_reused then null else p_sha256 end
   where order_id = v_order and status in ('pending','proof_submitted');
  if not found then
    insert into payments(order_id, method, status, amount_usd, proof_media_path, proof_hash)
      values (v_order, o.payment_method, 'proof_submitted', o.total_usd, p_media_path, case when v_reused then null else p_sha256 end);
  end if;
  if v_reused then
    insert into risk_flags(subject_kind, subject_id, rule, severity, details)
      values ('customer', p_party, 'payment_proof_reused', 2, jsonb_build_object('proof_id', v_id, 'order_id', v_order));
  end if;
  perform raise_ops_exception('payment_proof', v_id::text,
    jsonb_build_object('order_id', v_order, 'short_code', o.short_code, 'expected_usd', o.total_usd, 'method', o.payment_method, 'reused_image', v_reused));
  return jsonb_build_object('proof_id', v_id, 'order_id', v_order, 'short_code', o.short_code, 'total_usd', o.total_usd,
                            'method', o.payment_method, 'reused_image', v_reused, 'already', false);
end $$;

-- The optional model read. Stored as a pre-fill for the reviewer; it changes no status and no amount.
create or replace function record_proof_reading(p_proof uuid, p_extracted jsonb) returns void language sql as $$
  update payment_proofs set extracted = p_extracted where id = p_proof and status = 'pending';
  update payments set proof_extracted = p_extracted
   where order_id = (select order_id from payment_proofs where id = p_proof) and status = 'proof_submitted' $$;

-- What the ops lead reviews: open proofs, oldest first, with what the order expects next to what the model read.
create or replace function payment_proofs_open() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('proof_id', p.id, 'order_id', p.order_id, 'short_code', o.short_code,
           'expected_usd', o.total_usd, 'method', o.payment_method, 'media_path', p.media_path, 'reading', p.extracted,
           'reused_image', p.reused_image, 'received_at', p.created_at) order by p.created_at), '[]'::jsonb)
    from payment_proofs p join orders o on o.id = p.order_id where p.status = 'pending' $$;

-- A person decides. Accepting calls confirm_payment(), which checks the role, the reference and the amount and posts the ledger.
-- The reference and amount are what the person typed, not what the model read.
create or replace function review_payment_proof(p_proof uuid, p_by uuid, p_accept boolean, p_external_ref text default null,
                                                p_amount_usd numeric default null, p_note text default null)
returns jsonb language plpgsql as $$
declare pr payment_proofs%rowtype; r jsonb;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  select * into pr from payment_proofs where id = p_proof for update;
  if not found then raise exception 'PROOF_NOT_FOUND'; end if;
  if pr.status <> 'pending' then return jsonb_build_object('ok', true, 'already', pr.status); end if;
  if p_accept then
    if p_amount_usd is null then raise exception 'AMOUNT_REQUIRED'; end if;
    r := confirm_payment(pr.order_id, p_by, p_external_ref, p_amount_usd);
    update payment_proofs set status = 'confirmed', reviewed_by = p_by, reviewed_at = now(), review_note = p_note where id = p_proof;
  else
    update payment_proofs set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = p_note where id = p_proof;
    update payments set status = 'pending' where order_id = pr.order_id and status = 'proof_submitted'
      and not exists (select 1 from payment_proofs q where q.order_id = pr.order_id and q.status = 'pending');
    r := jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
   where kind = 'payment_proof' and ref = p_proof::text and status <> 'resolved';
  return r || jsonb_build_object('proof_id', p_proof, 'order_id', pr.order_id);
end $$;

-- Locked like everything else: the worker's server role only.
do $$ declare r text;
begin
  revoke execute on all functions in schema public from public;
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table payment_proofs from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table payment_proofs to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
