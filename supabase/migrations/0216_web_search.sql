-- Alo King Chouf, session SR1, part 5 of 5: the website's search page uses the chat's search (invariant 19).
-- web_catalog_search (0154) searched with catalog_lookup; it now calls find_products (0214) with the filters the page read from the box
-- (the same reading step as the chat, packages/agents/src/search-reading.ts), so "snacks with no sugar" on the site returns only items whose
-- approved facts pass, exactly as in the chat. The meaning list is used when the query's embedding is already cached (the chat embedded the
-- same words); the site itself never calls a model. Restricted, as before, to what the site shows (catalog_web_items), so a link always
-- opens; a search that finds nothing is demand, as before (log_demand, origin web_search, capped per hour). Functional only: no visual change.

drop function if exists web_catalog_search(text, int);
create or replace function web_catalog_search(p_text text, p_limit int default 12, p_filters jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare v_text text := left(btrim(coalesce(p_text, '')), 80); v_limit int := least(greatest(coalesce(p_limit, 12), 1), 30);
        v_found jsonb; v_cap int := coalesce((setting('web')->>'miss_log_per_hour')::int, 300); r jsonb;
        v_filters jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
begin
  if length(v_text) < 2 and not filters_ask_facts(v_filters) then return jsonb_build_object('ok', true, 'q', v_text, 'matches', '[]'::jsonb, 'reason', 'too_short'); end if;
  r := find_products(v_text, v_filters, 30, null, null, null);
  with m as (select x->>'sku' as sku, ord from jsonb_array_elements(r->'matches') with ordinality as t(x, ord)),
       w as (select ci.product_id, m.ord from m join catalog_web_items() ci on ci.sku = m.sku order by m.ord limit v_limit)
  select coalesce(jsonb_agg(catalog_web_card(w.product_id) || jsonb_build_object('facts',
           (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(r->'matches') x, jsonb_array_elements(x->'evidence') e
             where (x->>'product_id')::uuid = w.product_id)) order by w.ord), '[]'::jsonb) into v_found from w;
  if jsonb_array_length(v_found) = 0 then
    if (select count(*) from demand_signals where origin = 'web_search' and created_at > now() - interval '1 hour') < v_cap then
      perform log_demand(case when r->>'reason' = 'none_pass' then 'facts_unconfirmed' else 'unknown_product' end::demand_kind, 'web_search', null, v_text,
                         null, null, null, null, jsonb_build_object('channel', 'web', 'filters', v_filters));
    end if;
    return jsonb_build_object('ok', true, 'q', v_text, 'matches', '[]'::jsonb, 'reason', coalesce(r->>'reason', 'no_match'), 'filters', v_filters);
  end if;
  return jsonb_build_object('ok', true, 'q', v_text, 'matches', v_found, 'reason', null, 'filters', v_filters);
end $$;

do $$ begin
  revoke all on function web_catalog_search(text, int, jsonb) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function web_catalog_search(text, int, jsonb) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function web_catalog_search(text, int, jsonb) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function web_catalog_search(text, int, jsonb) to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'web_channel') then grant execute on function web_catalog_search(text, int, jsonb) to web_channel; end if;
end $$;
