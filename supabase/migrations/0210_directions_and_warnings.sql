-- Alo King Chouf, session LB1 (label day tooling), migration 0210: directions and warnings as printed.
-- The label is the source of product facts (docs/DECISIONS.md, "Coordinator decisions, 16 November 2026", decision 2). Besides the facts
-- of PD1 (ingredients, allergens, nutrition, hazard warnings), a pack prints how to use it and what to be careful of. Both become CORE fields,
-- so every grocery template has them (a vendor dish has no printed pack and no core):
--   directions_as_printed   text   how to use, prepare or keep it, copied exactly from the pack. Approved automatically only where a rule
--                                  allows it; no rule reads the label into it yet, so in practice a person confirms it
--   warnings_as_printed     list   each printed warning, copied exactly ("Contains caffeine", "Not recommended for children").
--                                  Always a person (the same rule as hazard warnings, 0207's NEVER_AUTOMATIC)
-- They are shown as PRINTED TEXT and never rewritten as advice (invariant 14: neutral and factual): product_printed_text() returns the
-- approved, current text, word for word, with its source. It never rates, summarises or paraphrases, and a proposal is never shown.
-- Neither field is required for "sellable" or "fact-complete", so no item changes level and the catalogue does not freeze.
-- record_label_scan (0207) needs no change: it already writes any `values` field of the template or the core that a reading names.

insert into template_fields(template_code, key, field_group, label_en, type, unit, allowed, required_for, allowed_sources, approval, store) values
  ('core', 'directions_as_printed', 'label', 'Directions as printed (how to use, prepare or keep it)', 'text', null, null, null, '{label_photo}', 'automatic', 'values'),
  ('core', 'warnings_as_printed',   'label', 'Warnings as printed (each one, exactly as written)',     'list', null, null, null, '{label_photo}', 'person',    'values');

-- The printed text of an item, approved and not past its 12 months, exactly as it was approved. Null where nothing is approved.
create or replace function product_printed_text(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with cur as (
    select v.field_key, v.value, v.source, v.approved_at from product_field_values v
     where v.product_id = p_product and v.status = 'approved' and v.field_key in ('directions_as_printed', 'warnings_as_printed', 'hazard_warnings')
       and (v.expires_at is null or v.expires_at > now()))
  select jsonb_build_object(
    'as_printed', true,
    'directions', (select jsonb_build_object('text', c.value #>> '{}', 'source', c.source, 'approved_at', c.approved_at) from cur c
                    where c.field_key = 'directions_as_printed' and jsonb_typeof(c.value) = 'string'),
    'warnings', (select jsonb_build_object('lines', c.value, 'source', c.source, 'approved_at', c.approved_at) from cur c
                  where c.field_key = 'warnings_as_printed' and jsonb_typeof(c.value) = 'array'),
    'hazard_warnings', (select jsonb_build_object('lines', c.value, 'source', c.source, 'approved_at', c.approved_at) from cur c
                         where c.field_key = 'hazard_warnings' and jsonb_typeof(c.value) = 'array')) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
