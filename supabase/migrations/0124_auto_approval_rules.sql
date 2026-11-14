-- Alo King Chouf, session I1: automatic approval, as the table of SYSTEM_PLAN section 4 (founder request of 14 Nov; conflict
-- register C6, approved 14 Nov). Certainty is defined by checks code can run, never by a model's confidence.
--
--   field                    automatic only when code can check all of                           never automatic
--   picture                  barcode exact match; the vision check passes every rule; the source   any cannot_tell; any public_page
--                            is Open Food Facts, the brand's site or our own photo                picture (shops' pages)
--   name_size_category       barcode exact match and two independent sources agree on brand and  Arabic written by a model, until a
--                            size                                                                  reader passed a sample of 50 with
--                                                                                                  no error (a setting, below)
--   search_words             the 1.23 phrasing tests pass (0076; already automatic)               misses on the review list
--   ingredients_nutrition    the intake label photo and a second source agree for that barcode   web sources alone
--   allergens, diet labels   NO ROW: never automatic                                               always one tap, against the pack
--   price, cost              NO ROW: never automatic                                               always
--
-- How a rule is switched on (C6 as approved): every row ships with enabled = false. While a rule is off, try_auto_approve()
-- still runs every check and logs what it WOULD approve (applied = false). Each day a random tenth of the day's log is put on
-- the spot-check list; when the first day's sample for a field is checked by a person and every one is right, that field's
-- rule switches on (first_passed_at). A spot check that finds an error switches the rule off at once and undoes that
-- approval; only a person turns it back on (set_auto_approval_rule, 0126).
--
-- Three locks keep allergens, diet labels, prices and costs out, each enough on its own:
--   1. auto_approval_rules.field has a check constraint listing the four fields; no other row can exist;
--   2. try_auto_approve() (0125) maps only those four fields, and a food fact only for the attributes ingredients and nutrition;
--   3. a trigger on product_facts refuses any fact approved by the rule party unless its attribute is ingredients or nutrition.
-- The rule party below is a blocked party: no function accepts it as an actor (every role check refuses a blocked party). It
-- exists so that approved_by / reviewed_by / decided_by say "a rule", never a person.

insert into parties(id, role, display_name, is_blocked, notes)
values ('00000000-0000-4000-8000-0000000000a1', 'picker', 'Automatic approval (a rule of auto_approval_rules)', true,
        'Session I1. Recorded as the approver of what a rule approved. Blocked for ever: it can never act through any function.')
on conflict (id) do nothing;

create or replace function auto_approval_party() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000a1'::uuid $$;

-- The rule party stays blocked and keeps its role.
create or replace function auto_party_stays_blocked() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.id = auto_approval_party() and (not new.is_blocked or new.role is distinct from old.role or new.id is distinct from old.id) then
    raise exception 'AUTO_PARTY_LOCKED: the automatic-approval party is blocked for ever';
  end if;
  return new;
end $$;
drop trigger if exists parties_auto_party_locked on parties;
create trigger parties_auto_party_locked before update on parties for each row execute function auto_party_stays_blocked();

create table if not exists auto_approval_rules (
  field           text primary key check (field in ('picture', 'name_size_category', 'search_words', 'ingredients_nutrition')),
  enabled         boolean not null default false,
  first_passed_at timestamptz,                         -- the first spot-check sample that was all right: the rule went on
  disabled_at     timestamptz,
  disabled_reason text,
  changed_by      uuid references parties(id),
  changed_at      timestamptz,
  checks          text not null                        -- what code checks, in words, for the console
);
insert into auto_approval_rules(field, checks) values
  ('picture', 'Barcode exact match; the vision check says yes to brand, product, size, one pack and plain background and no to watermark, text, price and shop logo, with no "cannot tell"; at least 800 px; the source is Open Food Facts, the brand''s own site or our own intake photo. Never a public_page picture.'),
  ('name_size_category', 'Barcode exact match, and two independent sources whose barcode code can trust (the intake label photo and Open Food Facts; a research file''s barcode is the model''s own claim and does not count) name the same brand and size as the proposal. Arabic written by a model only after a reader passed a sample of 50 with no error. Categories have no proposals yet, so nothing changes a category automatically.'),
  ('search_words', 'The words are built and every test phrasing resolves to the item (1.23); nothing is open on the search-words review list.'),
  ('ingredients_nutrition', 'The label reader''s reading of the intake photo (its barcode matches) and a second source for the same barcode (Open Food Facts, or the brand''s own page) say the same: the same ingredient list letter for letter, or the same per-100 g energy, fat, carbohydrate and protein within 10%.')
on conflict (field) do nothing;

create table if not exists auto_approvals (
  id          uuid primary key default gen_random_uuid(),
  field       text not null references auto_approval_rules(field),
  kind        text not null check (kind in ('picture', 'name', 'search_words', 'fact')),
  proposal_id text not null,                           -- product_images.id, product_name_proposals.id, sku@build, product_facts.id
  product_id  uuid not null references products(id) on delete cascade,
  applied     boolean not null,                        -- false: the rule was off, this is what it would have approved
  checks      jsonb not null,
  result      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by uuid references parties(id),
  unique (kind, proposal_id, applied),
  check ((field, kind) in (('picture', 'picture'), ('name_size_category', 'name'), ('search_words', 'search_words'), ('ingredients_nutrition', 'fact')))
);
create index if not exists auto_approvals_day on auto_approvals(created_at);

create table if not exists auto_approval_spot_checks (
  id          uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references auto_approvals(id) on delete cascade,
  sample_day  date not null,
  status      text not null default 'waiting' check (status in ('waiting', 'correct', 'wrong')),
  checked_by  uuid references parties(id),
  checked_at  timestamptz,
  note        text,
  check ((status = 'waiting') = (checked_by is null))
);
create index if not exists auto_approval_spot_checks_waiting on auto_approval_spot_checks(sample_day) where status = 'waiting';

create table if not exists auto_approval_sample_days (
  day        date primary key,
  approvals  int not null,
  sampled    int not null,
  created_at timestamptz not null default now()
);

-- Lock 3: a fact approved by the rule party is an ingredient list or a nutrition panel, nothing else. Ever.
create or replace function auto_party_facts_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.approved_by = auto_approval_party() or new.proposed_by = auto_approval_party()) and new.attribute not in ('ingredients', 'nutrition') then
    raise exception 'NEVER_AUTOMATIC %: allergens, diet labels and everything but the ingredient list and the nutrition panel need a person', new.attribute;
  end if;
  return new;
end $$;
drop trigger if exists product_facts_auto_party_only on product_facts;
create trigger product_facts_auto_party_only before insert or update on product_facts for each row execute function auto_party_facts_only();

-- What code needs to check, as data: the brands' own hosts (from scripts/images/brand-sites.json, each opened by a person),
-- and the Arabic reader's sample (false until a reader passes 50 model-written names with no error: record_arabic_reader_sample, 0126).
insert into settings(key, value) values ('auto_approval', jsonb_build_object(
  'sample_share', 0.1,
  'arabic_reader', jsonb_build_object('passed', false, 'sample_needed', 50),
  'brand_hosts', '{"nescafe": ["nescafe.com"], "nutella": ["nutella.com"], "kinder": ["kinder.com"], "lipton": ["lipton.com"], "pepsi": ["pepsi.com"], "7up": ["7up.com"], "nivea": ["nivea.com"], "colgate": ["colgate.com"], "lurpak": ["lurpak.com"]}'::jsonb))
on conflict (key) do nothing;

do $$ declare t text; r text;
begin
  foreach t in array array['auto_approval_rules', 'auto_approvals', 'auto_approval_spot_checks', 'auto_approval_sample_days'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
