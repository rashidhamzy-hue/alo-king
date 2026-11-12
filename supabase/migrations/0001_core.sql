-- Alo King Chouf: core schema. Postgres 15+ (Supabase).
-- Rule of the house: money, stock, consent and state transitions are enforced here,
-- not in prompts. Agents call the functions in 0002_functions.sql and nothing else.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- enums ----------
create type wa_line           as enum ('customer','ops');
create type party_role        as enum ('customer','driver','merchant','picker','ops_lead','admin');
create type consent_kind      as enum ('transactional','marketing');
create type consent_action    as enum ('opt_in','opt_out');
create type msg_direction     as enum ('inbound','outbound');
create type msg_category      as enum ('service','utility','marketing','authentication');
create type source_kind       as enum ('dark_store','merchant');
create type storage_zone      as enum ('ambient','chilled','frozen','fresh');
create type order_status      as enum ('draft','awaiting_confirmation','awaiting_payment','confirmed','preparing',
                                       'ready','out_for_delivery','arrived','delivered','closed',
                                       'cancelled','failed_delivery','returned');
create type fulfilment_status as enum ('pending','accepted','rejected','preparing','ready','handed_over','cancelled');
create type delivery_status   as enum ('offered','accepted','declined','expired','in_progress','completed','cancelled');
create type stop_kind         as enum ('pickup','dropoff','cash_drop');
create type payment_method    as enum ('cod','whish','omt');
create type payment_status    as enum ('pending','proof_submitted','confirmed','rejected','refunded');
create type currency_code     as enum ('USD','LBP');
create type stock_reason      as enum ('receive','reserve','release','pick','adjust','waste','return');
create type drop_method       as enum ('hub','omt');
create type drop_status       as enum ('declared','confirmed','disputed');
create type account_kind      as enum ('driver_cash','driver_float','hub_cash','omt_clearing','whish_clearing',
                                       'merchant_payable','revenue_goods','revenue_delivery','revenue_commission',
                                       'tips_payable','merchant_wallet','cash_over_short');
create type actor_kind        as enum ('customer','agent','driver','merchant','picker','ops','system');

-- ---------- parties, identity, consent ----------
create table parties (
  id            uuid primary key default gen_random_uuid(),
  role          party_role not null,
  display_name  text,
  language_pref text default 'ar',
  is_blocked    boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now()
);

-- Meta is moving from phone numbers to business-scoped user IDs (BSUID).
-- Kapso does not guarantee message.from, so identity is keyed on wa_user_id and phone is optional.
create table party_identities (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references parties(id) on delete cascade,
  line       wa_line not null,
  wa_user_id text,
  phone_e164 text,
  created_at timestamptz not null default now(),
  check (wa_user_id is not null or phone_e164 is not null)
);
create unique index party_identities_user  on party_identities(line, wa_user_id) where wa_user_id is not null;
create unique index party_identities_phone on party_identities(line, phone_e164) where phone_e164 is not null;

create table consent_events (
  id                  uuid primary key default gen_random_uuid(),
  party_id            uuid not null references parties(id) on delete cascade,
  line                wa_line not null,
  kind                consent_kind not null,
  action              consent_action not null,
  source              text not null,           -- 'first_order_button','stop_keyword','meta_preference_webhook','onboarding_form'
  wording             text,                    -- exact text the person agreed to
  evidence_message_id text,                    -- wamid of the tap or message
  created_at          timestamptz not null default now()
);
create index consent_events_party on consent_events(party_id, line, kind, created_at desc);

create view consent_current as
  select distinct on (party_id, line, kind) party_id, line, kind, action, source, created_at
  from consent_events order by party_id, line, kind, created_at desc;

-- ---------- WhatsApp log ----------
create table wa_inbound_events (
  idempotency_key text primary key,            -- Kapso X-Idempotency-Key
  line            wa_line not null,
  event           text not null,               -- X-Webhook-Event
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  error           text
);

create table conversations (
  id               uuid primary key default gen_random_uuid(),
  line             wa_line not null,
  party_id         uuid not null references parties(id),
  kapso_conv_id    text,
  last_inbound_at  timestamptz,                -- the 24h customer service window is derived from this
  human_handoff    boolean not null default false,
  state            jsonb not null default '{}',-- draft order, pending question, last quote
  active_order_id  uuid,
  updated_at       timestamptz not null default now(),
  unique (line, party_id)
);

create table wa_templates (
  name      text primary key,
  line      wa_line not null,
  category  msg_category not null,
  language  text not null default 'ar',
  body      text not null,
  variables jsonb not null default '[]',
  status    text not null default 'draft'      -- draft | submitted | approved | rejected | paused
);

create table wa_messages (
  id               uuid primary key default gen_random_uuid(),
  line             wa_line not null,
  direction        msg_direction not null,
  party_id         uuid references parties(id),
  conversation_id  uuid references conversations(id),
  wa_message_id    text unique,
  type             text not null,              -- text | audio | image | location | interactive | template | ...
  body             text,
  media_path       text,                       -- Supabase Storage key
  transcript       jsonb,                      -- {kapso, primary, reconciled, confidence}
  template_name    text references wa_templates(name),
  category         msg_category,
  status           text,                       -- received | sent | delivered | read | failed
  billable         boolean,
  order_id         uuid,
  created_at       timestamptz not null default now()
);
create index wa_messages_conv on wa_messages(conversation_id, created_at desc);

create table handoffs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  reason          text not null,
  status          text not null default 'open',
  assigned_to     uuid references parties(id),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

-- ---------- geography ----------
create table zones (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  delivery_fee_usd numeric(8,2) not null,
  base_eta_minutes int not null,
  is_active        boolean not null default true
);

create table villages (
  id        uuid primary key default gen_random_uuid(),
  zone_id   uuid references zones(id),
  name_en   text not null unique,
  name_ar   text,
  aliases   text[] not null default '{}',      -- Arabizi and spelling variants
  lat       double precision,
  lng       double precision,
  is_served boolean not null default false
);

create table landmarks (
  id          uuid primary key default gen_random_uuid(),
  village_id  uuid not null references villages(id),
  name        text not null,
  kind        text not null default 'other',   -- shop | school | mosque | church | khalwa | building | junction | clinic | station | other
  lat         double precision not null,
  lng         double precision not null,
  confidence  smallint not null default 1 check (confidence between 0 and 5),
  source      text not null default 'seed',    -- seed | customer_pin | driver_pin | ops
  verified_by uuid references parties(id),
  created_at  timestamptz not null default now()
);

create table landmark_aliases (
  landmark_id uuid not null references landmarks(id) on delete cascade,
  alias       text not null,
  primary key (landmark_id, alias)
);
create index landmark_aliases_trgm on landmark_aliases using gin (alias gin_trgm_ops);

create table customer_places (
  id                 uuid primary key default gen_random_uuid(),
  party_id           uuid not null references parties(id) on delete cascade,
  label              text,                     -- 'home','parents','work'
  village_id         uuid references villages(id),
  landmark_id        uuid references landmarks(id),
  lat                double precision,
  lng                double precision,
  building           text,
  floor              text,
  directions         text,                     -- the customer's own words, kept verbatim for the driver
  verified_by_driver boolean not null default false,
  delivery_count     int not null default 0,
  last_used_at       timestamptz
);

-- Village-to-village matrix. Seeded from OSRM, then corrected by observed trip times.
create table travel_times (
  from_village uuid not null references villages(id),
  to_village   uuid not null references villages(id),
  minutes      numeric(6,1) not null,
  km           numeric(6,1),
  source       text not null default 'osrm',   -- osrm | observed
  samples      int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (from_village, to_village)
);

-- ---------- catalog and inventory ----------
create table sources (
  id             uuid primary key default gen_random_uuid(),
  kind           source_kind not null,
  name           text not null,
  owner_party_id uuid references parties(id),
  village_id     uuid references villages(id),
  landmark_id    uuid references landmarks(id),
  is_open        boolean not null default true,
  prep_minutes   int not null default 10,
  commission_pct numeric(5,2) not null default 0,
  hours          jsonb not null default '{}'
);

create table products (
  id              uuid primary key default gen_random_uuid(),
  sku             text unique,
  owner_source_id uuid references sources(id), -- null = shared dark-store catalog item
  name_en         text not null,
  name_ar         text,
  brand           text,
  category        text not null,
  sub_type        text,
  storage         storage_zone not null default 'ambient',
  sell_unit       text not null default 'each',
  barcode         text,
  velocity_tier   char(1),
  modifiers       jsonb not null default '[]', -- restaurant options: no pickles, extra garlic, bread type
  is_active       boolean not null default true
);
create index products_name_trgm on products using gin ((coalesce(name_en,'') || ' ' || coalesce(name_ar,'') || ' ' || coalesce(brand,'')) gin_trgm_ops);

create table product_aliases (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  alias      text not null,                    -- 'كلينكس','kleenex','mhareem','محارم'
  lang       text not null default 'ar',       -- ar | en | arabizi | fr
  learned    boolean not null default false    -- true when added from a confirmed order
);
create index product_aliases_trgm on product_aliases using gin (alias gin_trgm_ops);

create table offers (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references sources(id),
  product_id     uuid not null references products(id),
  price_usd      numeric(10,2) not null check (price_usd >= 0),
  is_available   boolean not null default true,
  sponsored_rank int,
  unique (source_id, product_id)
);

create table stock_levels (
  source_id     uuid not null references sources(id),
  product_id    uuid not null references products(id),
  on_hand       numeric(10,3) not null default 0 check (on_hand >= 0),
  reserved      numeric(10,3) not null default 0 check (reserved >= 0),
  reorder_point numeric(10,3) not null default 0,
  par_level     numeric(10,3) not null default 0,
  primary key (source_id, product_id),
  check (reserved <= on_hand)
);

create table stock_movements (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references sources(id),
  product_id uuid not null references products(id),
  qty_delta  numeric(10,3) not null,
  reason     stock_reason not null,
  order_id   uuid,
  actor_id   uuid references parties(id),
  created_at timestamptz not null default now()
);

create table merchant_menu_imports (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references sources(id),
  media_path  text not null,
  extracted   jsonb,                            -- items the vision agent read, with per-field confidence
  status      text not null default 'needs_review', -- needs_review | approved | rejected
  reviewed_by uuid references parties(id),
  created_at  timestamptz not null default now()
);

-- ---------- orders ----------
create table fx_rates (
  id             uuid primary key default gen_random_uuid(),
  lbp_per_usd    numeric(12,2) not null check (lbp_per_usd > 0),
  effective_from timestamptz not null default now(),
  set_by         uuid references parties(id)
);

create table orders (
  id              uuid primary key default gen_random_uuid(),
  short_code      text not null unique,        -- what humans say: AK-4821
  customer_id     uuid not null references parties(id),
  conversation_id uuid references conversations(id),
  status          order_status not null default 'draft',
  place_id        uuid references customer_places(id),
  village_id      uuid references villages(id),
  is_pickup       boolean not null default false,
  subtotal_usd    numeric(10,2) not null default 0,
  delivery_fee_usd numeric(8,2) not null default 0,
  tip_usd         numeric(8,2) not null default 0,
  total_usd       numeric(10,2) generated always as (subtotal_usd + delivery_fee_usd + tip_usd) stored,
  payment_method  payment_method not null default 'cod',
  fx_rate_lbp     numeric(12,2),               -- snapshot at confirmation
  change_for_usd  numeric(8,2),                -- "bring change for 100"
  customer_notes  text,
  risk_score      smallint not null default 0,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  delivered_at    timestamptz
);
create index orders_status on orders(status, created_at);
alter table conversations add constraint conversations_active_order foreign key (active_order_id) references orders(id);

create table fulfilments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  source_id    uuid not null references sources(id),
  status       fulfilment_status not null default 'pending',
  subtotal_usd numeric(10,2) not null default 0,
  accepted_at  timestamptz,
  ready_at     timestamptz,
  unique (order_id, source_id)
);

create table order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  fulfilment_id   uuid not null references fulfilments(id) on delete cascade,
  product_id      uuid not null references products(id),
  name_snapshot   text not null,
  qty             numeric(10,3) not null check (qty > 0),
  unit_price_usd  numeric(10,2) not null,
  modifiers       jsonb not null default '[]',
  note            text,
  substitution_of uuid references order_items(id),
  status          text not null default 'ok'    -- ok | substituted | removed
);

create table order_transitions (
  from_status order_status not null,
  to_status   order_status not null,
  actors      actor_kind[] not null,
  primary key (from_status, to_status)
);

create table order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  actor       actor_kind not null,
  actor_id    uuid,
  reason      text,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index order_events_order on order_events(order_id, created_at);

-- ---------- fleet and delivery ----------
create table vehicles (
  id               uuid primary key default gen_random_uuid(),
  plate            text not null unique,
  model            text,
  status           text not null default 'active', -- active | in_service | retired
  odometer_km      int not null default 0,
  next_service_km  int,
  insurance_expiry date
);

create table driver_shifts (
  id                uuid primary key default gen_random_uuid(),
  driver_id         uuid not null references parties(id),
  vehicle_id        uuid references vehicles(id),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  opening_float_usd numeric(8,2) not null default 0,
  opening_odometer  int,
  closing_odometer  int
);
create unique index driver_one_open_shift on driver_shifts(driver_id) where ended_at is null;

create table driver_positions (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references parties(id),
  lat         double precision not null,
  lng         double precision not null,
  village_id  uuid references villages(id),
  source      text not null,                   -- wa_location | pwa | stop_event
  recorded_at timestamptz not null default now()
);
create index driver_positions_latest on driver_positions(driver_id, recorded_at desc);

create table deliveries (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references parties(id),
  shift_id     uuid references driver_shifts(id),
  status       delivery_status not null default 'offered',
  offered_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  completed_at timestamptz
);

create table delivery_stops (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references deliveries(id) on delete cascade,
  seq          int not null,
  kind         stop_kind not null,
  order_id     uuid references orders(id),
  source_id    uuid references sources(id),
  lat          double precision,
  lng          double precision,
  arrived_at   timestamptz,
  completed_at timestamptz,
  unique (delivery_id, seq)
);

create table vehicle_logs (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references vehicles(id),
  driver_id         uuid references parties(id),
  kind              text not null,              -- fuel | maintenance | issue | odometer | accident
  amount_usd        numeric(8,2),
  litres            numeric(6,2),
  odometer_km       int,
  description       text,
  media_path        text,
  source_message_id text,
  created_at        timestamptz not null default now()
);

-- ---------- money ----------
create table payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id),
  method          payment_method not null,
  status          payment_status not null default 'pending',
  amount_usd      numeric(10,2) not null,
  received_usd    numeric(10,2) not null default 0,
  received_lbp    numeric(14,2) not null default 0,
  change_usd      numeric(10,2) not null default 0,
  change_lbp      numeric(14,2) not null default 0,
  proof_media_path text,
  proof_extracted jsonb,                        -- {amount, currency, reference, datetime, recipient_last4, confidence}
  proof_hash      text,                         -- perceptual hash of the screenshot
  external_ref    text,                         -- Whish or OMT reference
  confirmed_by    uuid references parties(id),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index payments_ref_once  on payments(method, external_ref) where external_ref is not null;
create unique index payments_hash_once on payments(proof_hash) where proof_hash is not null;

create table ledger_accounts (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,                -- 'driver_cash:<party>', 'hub_cash', 'merchant_payable:<source>'
  kind     account_kind not null,
  party_id uuid references parties(id),
  source_id uuid references sources(id)
);

-- Double entry. Every txn_id must sum to zero in usd_equiv (checked at commit).
create table ledger_entries (
  id         uuid primary key default gen_random_uuid(),
  txn_id     uuid not null,
  account_id uuid not null references ledger_accounts(id),
  amount     numeric(14,2) not null,            -- in native currency; positive = debit
  currency   currency_code not null,
  usd_equiv  numeric(12,2) not null,
  order_id   uuid references orders(id),
  memo       text,
  created_at timestamptz not null default now()
);
create index ledger_entries_account on ledger_entries(account_id, created_at);
create index ledger_entries_txn on ledger_entries(txn_id);

create table cash_drops (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          uuid not null references parties(id),
  shift_id           uuid references driver_shifts(id),
  method             drop_method not null,
  declared_usd       numeric(10,2) not null default 0,
  declared_lbp       numeric(14,2) not null default 0,
  fx_rate_lbp        numeric(12,2) not null,
  receipt_media_path text,
  receipt_extracted  jsonb,
  receipt_ref        text,
  status             drop_status not null default 'declared',
  confirmed_by       uuid references parties(id),
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz
);
create unique index cash_drops_ref_once on cash_drops(receipt_ref) where receipt_ref is not null;

create table payouts (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references sources(id),
  period_start   date not null,
  period_end     date not null,
  gross_usd      numeric(12,2) not null,
  commission_usd numeric(12,2) not null,
  net_usd        numeric(12,2) not null,
  status         text not null default 'draft',  -- draft | approved | paid
  paid_at        timestamptz,
  unique (source_id, period_start, period_end)
);

-- ---------- risk, growth, config, observability ----------
create table risk_flags (
  id           uuid primary key default gen_random_uuid(),
  subject_kind text not null,                   -- customer | driver | merchant | order
  subject_id   uuid not null,
  rule         text not null,
  severity     smallint not null default 1,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  template_name  text not null references wa_templates(name),
  segment        jsonb not null default '{}',
  status         text not null default 'draft', -- draft | approved | sending | paused | done
  drafted_by     text not null default 'analyst_agent',
  approved_by    uuid references parties(id),   -- a human, always
  max_recipients int not null default 200,
  scheduled_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table campaign_recipients (
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  party_id      uuid not null references parties(id),
  status        text not null default 'queued', -- queued | sent | delivered | read | failed | suppressed
  wa_message_id text,
  primary key (campaign_id, party_id)
);

create table sponsored_listings (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references sources(id),
  product_id uuid references products(id),
  slot       text not null,                     -- 'category_top','recommendation'
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  cost_usd   numeric(8,2) not null,
  status     text not null default 'pending'
);

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references parties(id),
  updated_at timestamptz not null default now()
);

create table agent_runs (
  id              uuid primary key default gen_random_uuid(),
  agent           text not null,
  conversation_id uuid references conversations(id),
  order_id        uuid references orders(id),
  model           text,
  input_tokens    int,
  output_tokens   int,
  latency_ms      int,
  outcome         text,                         -- ok | clarify | handoff | error
  trace           jsonb,
  created_at      timestamptz not null default now()
);

-- ---------- seed: rules ----------
insert into settings(key, value) values
  ('hours',                  '{"open":"08:00","close":"23:00","tz":"Asia/Beirut"}'),
  ('cash_cap',               '{"soft_usd":150,"hard_usd":200}'),
  ('min_order_usd',          '5'),
  ('prepay_before_prep',     'true'),
  ('message_budget',         '{"customer_per_order":4,"driver_per_order":3}'),
  ('marketing_frequency',    '{"max_per_30d":4,"min_gap_hours":72}'),
  ('batching',               '{"max_orders":3,"max_detour_min":8}'),
  ('stt',                    '{"primary":"elevenlabs_scribe","secondary":"kapso","min_confidence":0.75}');

insert into order_transitions(from_status, to_status, actors) values
  ('draft','awaiting_confirmation',        '{agent}'),
  ('awaiting_confirmation','draft',        '{customer,agent}'),
  ('awaiting_confirmation','confirmed',    '{customer}'),
  ('awaiting_confirmation','awaiting_payment','{customer}'),
  ('awaiting_confirmation','cancelled',    '{customer,ops,system}'),
  ('awaiting_payment','confirmed',         '{ops,system}'),
  ('awaiting_payment','cancelled',         '{customer,ops,system}'),
  ('confirmed','preparing',                '{picker,merchant,system}'),
  ('confirmed','cancelled',                '{customer,ops}'),
  ('preparing','ready',                    '{picker,merchant}'),
  ('preparing','cancelled',                '{ops}'),
  ('ready','out_for_delivery',             '{driver}'),
  ('ready','delivered',                    '{picker,ops}'),          -- customer pickup at the hub
  ('ready','cancelled',                    '{ops}'),
  ('out_for_delivery','arrived',           '{driver}'),
  ('out_for_delivery','failed_delivery',   '{driver,ops}'),
  ('arrived','delivered',                  '{driver}'),
  ('arrived','failed_delivery',            '{driver,ops}'),
  ('failed_delivery','out_for_delivery',   '{ops}'),
  ('failed_delivery','returned',           '{driver,picker,ops}'),
  ('delivered','closed',                   '{system,ops}'),
  ('returned','closed',                    '{system,ops}');

-- RLS: on everywhere. Workers use the service role. The ops console gets explicit policies later.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
