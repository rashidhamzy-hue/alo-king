-- 0011: founder product rules of 12 November 2026.
--   1. Marketing sends are switched off in the database. Protecting the customer number comes before any promotion.
--   2. Voice-note limits and the small-order fee exist as settings, so policy changes are data, not code.

-- ---------- 1. marketing kill switch ----------
-- No rule set makes a promotional broadcast risk-free: a number's standing with Meta depends on how recipients react
-- (blocks, spam reports), which nobody controls. So marketing sends are OFF by default and can_send() refuses them.
-- Turning this on is a founder decision, not a deploy step. See "Marketing and the customer number" in docs/BUILD_PLAN.md.
insert into settings(key, value) values ('marketing', '{"enabled": false}') on conflict (key) do nothing;

alter function can_send(uuid, wa_line, msg_category, boolean) rename to can_send_checked;

create or replace function can_send(p_party uuid, p_line wa_line, p_category msg_category, p_is_template boolean)
returns text language plpgsql stable as $$
begin
  if p_category = 'marketing' and not coalesce((setting('marketing')->>'enabled')::boolean, false) then
    return 'marketing_disabled';
  end if;
  return can_send_checked(p_party, p_line, p_category, p_is_template);
end $$;

-- ---------- 2. policy settings ----------
-- Seconds of audio processed automatically, per sender role. Longer notes get a polite reply, never silence.
insert into settings(key, value) values
  ('voice_limits', '{"customer": 180, "merchant": 300, "driver": 120, "staff": 120, "per_sender_seconds_per_hour": 900}'),
  -- Company income, separate from the rider's delivery fee. Off until the founder sets both numbers (build plan 1.16, 5.14).
  ('small_order_fee', '{"below_subtotal_usd": 0, "fee_usd": 0}'),
  ('first_order', '{"max_cod_usd": 0}')
on conflict (key) do nothing;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
