-- 0061 (session A2, task 4.12): the message meter.
-- Since 1 October 2026 Meta bills free-form replies at the utility rate after 1,000 free per number per month, and utility
-- templates from the first one (docs/COST_MODEL.md, to be corrected from the first real bill in 4.4).
-- Meta also says, per message, whether it billed it: every status webhook carries `pricing` {billable, category, type}
-- (seen on the real October traffic, test/fixtures/kapso/). Where Meta has said, that is the truth; until it has, the rule above estimates.
-- Probe messages (staging test parties, 0063) never left the building and are not counted.

alter table wa_messages add column if not exists pricing_category text;      -- Meta's category for this message (service, utility, ...)
alter table wa_messages add column if not exists pricing_type text;          -- Meta's pricing type (free_customer_service, regular, ...)
alter table wa_messages add column if not exists error_code text;            -- Meta's error code when the message failed
create index if not exists wa_messages_meter on wa_messages(line, created_at) where direction = 'outbound';

insert into settings(key, value) values ('message_meter', jsonb_build_object(
  'free_service_per_month', 1000,     -- free-form replies per number per month before Meta bills them
  'warn_at', 800,                      -- alert ops once a month when a number passes this many
  'rates_usd', jsonb_build_object('service', 0.0091, 'utility', 0.0091, 'marketing', 0.039),   -- estimates until 4.4 reads the bill
  'note', 'Rates are estimates from published summaries (COST_MODEL.md). Replace with the first real bill (task 4.4).'))
on conflict (key) do nothing;

-- A status webhook. Statuses can arrive out of order: read never goes back to delivered, failed always wins.
create or replace function record_message_status(p_wamid text, p_status text, p_billable boolean default null,
  p_category text default null, p_type text default null, p_error_code text default null) returns boolean language plpgsql as $$
declare rank_of constant jsonb := '{"sent":1,"delivered":2,"read":3,"failed":9}';
begin
  update wa_messages set
      status = case when status = 'sink' then status
                    when coalesce((rank_of->>p_status)::int, 0) >= coalesce((rank_of->>status)::int, 0) then p_status else status end,
      billable = coalesce(p_billable, billable),
      pricing_category = coalesce(p_category, pricing_category),
      pricing_type = coalesce(p_type, pricing_type),
      error_code = coalesce(p_error_code, error_code)
   where wa_message_id = p_wamid;
  return found;
end $$;

-- One row per outbound message that really went out, with whether it is (or is estimated to be) billed, and its estimated cost.
create or replace function message_costs(p_from timestamptz, p_to timestamptz)
returns table (id uuid, line wa_line, order_id uuid, category text, billable boolean, known boolean, cost_usd numeric, created_at timestamptz)
language sql stable as $$
  with m as (select setting('message_meter') s),
  out as (
    select w.*, date_trunc('month', w.created_at) as month,
           row_number() over (partition by w.line, date_trunc('month', w.created_at), (w.type = 'template') order by w.created_at) as nth
      from wa_messages w
     where w.direction = 'outbound' and coalesce(w.status, '') not in ('sink', 'failed')
       and w.created_at >= date_trunc('month', p_from) and w.created_at < p_to)
  select o.id, o.line, o.order_id,
         coalesce(o.pricing_category, case when o.type = 'template' then coalesce(o.category::text, 'utility') else 'service' end),
         coalesce(o.billable, case when o.type = 'template' then true else o.nth > (m.s->>'free_service_per_month')::int end),
         o.billable is not null,
         case when coalesce(o.billable, case when o.type = 'template' then true else o.nth > (m.s->>'free_service_per_month')::int end)
              then coalesce((m.s->'rates_usd'->>coalesce(o.pricing_category, case when o.type = 'template' then coalesce(o.category::text, 'utility') else 'service' end))::numeric, 0)
              else 0 end,
         o.created_at
    from out o, m
   where o.created_at >= p_from $$;

-- The meter for one month, per number: what went out, how many free replies are left, what it is estimated to cost.
create or replace function message_meter(p_month date default (now() at time zone 'Asia/Beirut')::date) returns jsonb language sql stable as $$
  with b as (select date_trunc('month', p_month::timestamptz) f, date_trunc('month', p_month::timestamptz) + interval '1 month' t),
  c as (select x.* from b, message_costs(b.f, b.t) x),
  s as (select setting('message_meter') v)
  select jsonb_build_object('month', to_char((select f from b), 'YYYY-MM'), 'lines', coalesce(jsonb_agg(r order by r->>'line'), '[]'::jsonb))
    from (select jsonb_build_object('line', l.line,
            'outbound', count(c.id),
            'free_form', count(c.id) filter (where c.category = 'service' or (c.category is null)),
            'templates', count(c.id) filter (where c.category in ('utility','marketing','authentication')),
            'free_form_allowance', (s.v->>'free_service_per_month')::int,
            'free_form_left', greatest(0, (s.v->>'free_service_per_month')::int - count(c.id) filter (where c.category = 'service')),
            'billable', count(c.id) filter (where c.billable),
            'billable_known_from_meta', count(c.id) filter (where c.known),
            'cost_usd_estimate', round(coalesce(sum(c.cost_usd), 0), 4)) r
            from (select unnest(enum_range(null::wa_line)) line) l cross join s
            left join c on c.line = l.line group by l.line, s.v) x $$;

-- Lines that passed the warning mark this month. The cron alerts once per line, month and mark (dedupe key).
create or replace function meter_alerts() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('line', l->>'line', 'month', m->>'month', 'free_form', (l->>'free_form')::int,
           'allowance', (l->>'free_form_allowance')::int, 'warn_at', (setting('message_meter')->>'warn_at')::int)), '[]'::jsonb)
    from (select message_meter() m) x, jsonb_array_elements(x.m->'lines') l
   where (l->>'free_form')::int >= (setting('message_meter')->>'warn_at')::int $$;

-- Day close: messages and estimated message cost per order delivered or closed that day (Beirut time).
create or replace function order_message_costs(p_day date default (now() at time zone 'Asia/Beirut')::date) returns jsonb language sql stable as $$
  with day as (select (p_day::timestamp at time zone 'Asia/Beirut') f, ((p_day + 1)::timestamp at time zone 'Asia/Beirut') t),
  orders_today as (select o.id, o.short_code from orders o, day where coalesce(o.delivered_at, o.created_at) >= day.f and coalesce(o.delivered_at, o.created_at) < day.t),
  c as (select x.* from day, message_costs(day.f - interval '2 days', day.t) x)
  select jsonb_build_object('day', p_day,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('order_id', ot.id, 'short_code', ot.short_code,
        'messages', (select count(*) from c where c.order_id = ot.id),
        'billable', (select count(*) from c where c.order_id = ot.id and c.billable),
        'cost_usd_estimate', (select round(coalesce(sum(c.cost_usd), 0), 4) from c where c.order_id = ot.id)) order by ot.short_code) from orders_today ot), '[]'::jsonb),
    'unattributed_cost_usd_estimate', (select round(coalesce(sum(c.cost_usd), 0), 4) from c, day where c.order_id is null and c.created_at >= day.f),
    'note', setting('message_meter')->>'note') $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
