-- Alo King Chouf, session FIX2, migration 0266: two fixes the coordinator found in Sentry.
--   A. The console assistant's read-only role may read dish_declarations (ALO-KING-GATEWAY-8).
--   B. The staging heartbeat made honest (ALO-KING-GATEWAY-3 and -5): the probe places its test order, and silence is counted while open.
--
-- ---------- A ----------
--
-- Sentry ALO-KING-GATEWAY-8: the nightly digest (writeDigest, 21:40 Beirut, 19 November) failed on staging with "permission denied for
-- table dish_declarations". assistant_digest_facts runs every assistant_* tool as their owner, assistant_reader (0261). The products tool
-- calls readiness_not_sellable() -> product_template_status(), a security-invoker function, which reads dish_declarations, but only for an
-- item whose template has the field 'declared_facts': a vendor dish. Staging has dishes (Safa Chicken's, the test kitchen's); the test
-- world of 0261 had none, so the branch never ran in CI.
--
-- The fix is one SELECT grant and its row policy, nothing else: no write privilege, no attribute, no other table. Every table and
-- function any assistant_* function can reach is now checked by test/db/fix2-assistant-reach.test.ts (a static walk of the function
-- bodies), and the digest runs end to end as the role on a world with a vendor dish, AUTO1's decisions and a food order.

do $$ declare r text; begin
  grant select on table dish_declarations to assistant_reader;
  -- As 0261 does for every table it opens to the role: the client roles keep no grant a policy could make reach rows.
  foreach r in array array['anon', 'authenticated', 'web_channel'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table dish_declarations from %I', r); end if;
  end loop;
  drop policy if exists assistant_read on dish_declarations;
  create policy assistant_read on dish_declarations for select to assistant_reader using (true);
end $$;

-- ---------- B ----------
-- Read on staging (20 November, the probe customer's outbox): the probe wrote every hour, but between 19 November 13:00 and 20 November
-- 05:00 UTC only two test orders were placed. It stalled three ways:
--   1. "Which one?" (B1c's picker) is a list message since CX2; the probe tapped buttons only, so it answered nothing (6 of the 12 open hours).
--   2. A turn sent the pin request and then a "not found yet" line; probe_pending gave only the newest message per line, so the pin
--      request was never answered (3 of 12).
--   3. While closed it ordered anyway: "closed, send your pin", every hour all night.
-- 1 is in packages/wa/src/probe.ts (a list: the first product offered, as a person would). 2: probe_pending now gives every message of the
-- last hour not answered yet, newest first; the probe answers the newest one it can answer on each line and marks the rest "none". 3: probe_due
-- only while the shop is open. probe_silent itself is unchanged: when the probe really cannot order while open, it still fires.

create or replace function probe_pending() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.dedupe_key, 'party_id', x.party_id, 'line', x.line, 'payload', x.payload,
           'wa_user_id', (select wa_user_id from party_identities i where i.party_id = x.party_id and i.line = x.line limit 1),
           'role', (select role from parties p where p.id = x.party_id)) order by x.created_at desc), '[]'::jsonb)
    from (select o.* from wa_outbox o join parties p on p.id = o.party_id
           where p.is_probe and o.status = 'sent' and o.created_at > now() - interval '1 hour') x
   where coalesce(setting('probe')->>'enabled', 'false') = 'true'
     and not exists (select 1 from probe_answers a where a.dedupe_key = x.dedupe_key) $$;

create or replace function probe_due() returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
declare p record; v_conv uuid; v_why text; v_every int := coalesce((setting('probe')->>'every_minutes')::int, 60);
        v_stuck int := coalesce((setting('probe')->>'stuck_after_minutes')::int, 30);
begin
  if coalesce(setting('probe')->>'enabled', 'false') <> 'true' then return null; end if;
  -- FIX2: the test order is placed while the shop is open, the hours a customer's order goes through (and the only hours probe_silent
  -- expects one). At night it was answered "closed, send your pin" every hour, a model turn each, and stalled.
  if not shop_open_now() then return null; end if;
  select pa.id, i.wa_user_id into p from parties pa join party_identities i on i.party_id = pa.id and i.line = 'customer'
   where pa.is_probe and pa.role = 'customer' limit 1;
  if not found then return null; end if;
  -- the last test order message, whether or not it became an order yet (a turn can ask a question instead)
  if exists (select 1 from wa_inbound_events e where e.idempotency_key like 'probe:%' and e.line = 'customer'
              and e.payload->'message'->>'type' = 'text' and e.received_at > now() - make_interval(mins => v_every)) then return null; end if;
  if exists (select 1 from orders o where o.customer_id = p.id
              and (o.created_at > now() - make_interval(mins => v_every)
                   or (o.status not in ('closed','cancelled','failed_delivery','returned') and o.created_at > now() - make_interval(mins => 3 * v_stuck)))) then
    return null;
  end if;
  -- B4: a probe stuck with a person gets its conversation back, and the reason is put where ops will see it.
  select c.id into v_conv from conversations c where c.party_id = p.id and c.line = 'customer' and c.human_handoff;
  if v_conv is not null then
    select h.reason into v_why from handoffs h where h.conversation_id = v_conv order by h.created_at desc limit 1;
    update conversations set human_handoff = false, updated_at = now() where id = v_conv;
    update handoffs set status = 'resolved', resolved_at = now() where conversation_id = v_conv and status = 'open';
    perform raise_ops_exception('probe_handoff_released', v_conv::text || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24'),
                                jsonb_build_object('conversation_id', v_conv, 'reason', coalesce(v_why, 'unknown')));
  end if;
  -- B4: with fresh_place, every probe order is a first order: no saved place, so the pin and the address are asked.
  if coalesce(setting('probe')->>'fresh_place', 'false') = 'true' then
    update customer_places set village_id = null, lat = null, lng = null, building = null, floor = null, directions = null
     where party_id = p.id;
  end if;
  return jsonb_build_object('party_id', p.id, 'wa_user_id', p.wa_user_id, 'text', setting('probe')->>'order_text');
end $$;

create or replace function heartbeat_alerts() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with s as (select setting('heartbeat') h, setting('probe') p),
  open_now as (select shop_open_now() as is_open, shop_opened_at() as opened_at),
  a as (
    -- the hourly test order did not finish (one case per order)
    select 'probe_stuck' as kind, o.id::text as ref, jsonb_build_object('order', o.short_code, 'status', o.status,
             'minutes', round(extract(epoch from now() - o.created_at) / 60),
             'riders_on_shift', (select count(*) from driver_shifts sh where sh.ended_at is null),
             'riders_with_room', (select count(*) from driver_shifts sh
                                   where sh.ended_at is null
                                     and not exists (select 1 from deliveries d where d.driver_id = sh.driver_id and d.status in ('offered', 'accepted', 'in_progress'))
                                     and driver_can_take(sh.driver_id, case when o.payment_method = 'cod' then o.total_usd else 0 end) = 'ok')) as detail
      from orders o join parties p on p.id = o.customer_id, s
     where p.is_probe and (s.p->>'enabled') = 'true' and o.status not in ('closed','cancelled','failed_delivery','returned')
       and o.created_at < now() - make_interval(mins => (s.p->>'stuck_after_minutes')::int)
    union all
    -- the probe should have ordered by now and has not (the cron or the turn path is broken). Only while open, and only
    -- once the shop has been open for three probe periods: the probe is not expected to order while closed.
    select 'probe_silent', 'probe', jsonb_build_object('last_order_at', max(o.created_at), 'opened_at', max(open_now.opened_at))
      from s, open_now, parties p left join orders o on o.customer_id = p.id
     where p.is_probe and p.role = 'customer' and (s.p->>'enabled') = 'true' and open_now.is_open
     group by s.p, p.created_at
    having greatest(coalesce(max(o.created_at), p.created_at), max(open_now.opened_at))
           < now() - make_interval(mins => 3 * (s.p->>'every_minutes')::int)
    union all
    -- real customers usually write, and nobody has for hours, while we are open: the webhook may be dead
    -- FIX2: the silence is counted from the later of the last message and today's opening, as probe_silent is (0090): the closed
    -- night is not silence (ALO-KING-GATEWAY-5 fired at each opening on staging, after a quiet night).
    select 'inbound_silent', 'customer_line', jsonb_build_object('last', max(e.received_at), 'week', count(*), 'opened_at', max(open_now.opened_at))
      from s, open_now, wa_inbound_events e
     where open_now.is_open and e.line = 'customer' and e.event = 'whatsapp.message.received' and e.idempotency_key not like 'probe:%'
       and e.received_at > now() - interval '7 days'
     group by s.h having count(*) >= (s.h->>'inbound_min_week')::int
                    and greatest(max(e.received_at), max(open_now.opened_at)) < now() - make_interval(hours => (s.h->>'inbound_silence_hours')::int)
    union all
    -- the cron itself came back after a gap (its absence while dead is Sentry's cron monitor)
    select 'cron_gap', 'cron', jsonb_build_object('gap_minutes', round(extract(epoch from (b.at - (b.detail->>'previous')::timestamptz)) / 60))
      from heartbeats b, s
     where b.name = 'cron' and b.detail ? 'previous'
       and b.at - (b.detail->>'previous')::timestamptz > make_interval(mins => (s.h->>'cron_gap_minutes')::int))
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'ref', ref, 'detail', detail)), '[]'::jsonb) from a $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

select pin_search_paths();
