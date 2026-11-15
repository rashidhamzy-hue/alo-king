-- Alo King Chouf, session D5 (console cockpit), migration 0159: what the orders page needs from the database.
--
--   search_orders(q, limit)   find an order by its code, the customer's name, or any part of the number they wrote from or gave us.
--                             Read-only. Returns what a list needs; the phone itself is never returned (the page shows names).
--   file_order_eval_case(...) the two buttons on an order page, "wrong product" and "bot at fault": each files one eval case
--                             (eval_cases, 0007) holding what the order's lines were and what the staff member wrote, for the
--                             next evals/ round (CLAUDE.md: every language bug becomes a case before it is fixed). One open case
--                             per order and kind, so a double tap files one. It changes no order, no stock and no money.

create or replace function search_orders(p_q text default '', p_limit int default 30)
returns table (id uuid, short_code text, status order_status, created_at timestamptz, total_usd numeric, payment_method payment_method,
               channel text, customer_name text, village_name text)
language sql stable set search_path = public, pg_temp as $$
  with q as (
    select lower(btrim(coalesce(p_q, ''))) as t,
           ltrim(regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g'), '0') as digits
  )
  select o.id, o.short_code, o.status, o.created_at, o.total_usd, o.payment_method, o.channel,
         pa.display_name, v.name_en
    from orders o
    join parties pa on pa.id = o.customer_id
    left join villages v on v.id = o.village_id
    cross join q
   where q.t = ''
      or strpos(lower(o.short_code), q.t) > 0
      or strpos(replace(lower(o.short_code), '-', ''), replace(q.t, '-', '')) > 0
      or strpos(lower(coalesce(pa.display_name, '')), q.t) > 0
      or (length(q.digits) >= 4 and (
            strpos(coalesce(pa.contact_phone, ''), q.digits) > 0
            or exists (select 1 from party_identities i where i.party_id = pa.id and i.phone_e164 is not null and strpos(i.phone_e164, q.digits) > 0)))
   order by o.created_at desc
   limit greatest(1, least(coalesce(p_limit, 30), 100)) $$;

create or replace function file_order_eval_case(p_order uuid, p_by uuid, p_kind text, p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform require_role(p_by, array['admin', 'ops_lead']);
  if p_kind not in ('wrong_product', 'bot_at_fault') then raise exception 'UNKNOWN_KIND %', p_kind; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  select id into v_id from eval_cases where order_id = p_order and kind = p_kind and source = 'console' and not reviewed limit 1;
  if v_id is not null then return jsonb_build_object('ok', true, 'already', true, 'id', v_id); end if;
  insert into eval_cases(kind, input, got, source, order_id)
  values (p_kind,
          jsonb_build_object('conversation_id', o.conversation_id, 'order', o.short_code, 'note', left(v_note, 300), 'filed_by', p_by),
          (select jsonb_agg(jsonb_build_object('raw', i.raw_phrase, 'product', i.name_snapshot, 'qty', i.qty) order by i.name_snapshot)
             from order_items i where i.order_id = p_order),
          'console', p_order)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'already', false, 'id', v_id);
end $$;

-- A function created here is callable by the server role only (as every function since 0124): not by PUBLIC, and so not by web_channel.
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
