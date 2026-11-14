-- Alo King Chouf, session D3 (console): the 1.23 review list's second action.
-- B4's 0076 gave the console search_word_reviews_open() and resolve_search_word_review(). A person who has fixed the item's
-- name, Arabic name or brand in the catalog (the trigger re-queues it then) or who wants its words built again without a change
-- asks for a rebuild here. The open reviews of that item are closed by that person: the new words get new phrasings, and any
-- that do not resolve come back on the list (check_search_words, 0076).
-- Also: check_search_words no longer fails on a phrasing that finds nothing (below).

create or replace function rerun_search_words(p_sku text, p_by uuid) returns jsonb language plpgsql as $$
declare n int;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if not exists (select 1 from products where sku = p_sku and is_active) then raise exception 'UNKNOWN_SKU %', p_sku; end if;
  perform enqueue_search_words(p_sku, 'manual');
  update search_word_reviews set status = 'resolved', resolved_by = p_by, resolved_at = now() where sku = p_sku and status = 'open';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'closed', n, 'job', (select status from search_word_jobs where sku = p_sku));
end $$;

-- Found while building the page: a phrasing that finds nothing comes back from the planner with "candidates": null (JSON null,
-- which coalesce does not catch), jsonb_array_elements() raised "cannot extract elements from a scalar", and the whole job failed
-- (three tries, then nothing) instead of putting the item on this list. 0076's text, with only that line changed.
-- Anyone redefining check_search_words: start from here.
create or replace function check_search_words(p_sku text, p_phrasings text[]) returns jsonb language plpgsql as $$
declare v_id uuid := (select id from products where sku = p_sku); ph text; plan jsonb; l jsonb; failed jsonb := '[]'::jsonb; ok int := 0;
begin
  foreach ph in array coalesce(p_phrasings, '{}') loop
    if nullif(btrim(ph), '') is null then continue; end if;
    plan := plan_order_core(null, jsonb_build_object('intent', 'order', '_message', ph,
              'lines', jsonb_build_array(jsonb_build_object('raw', ph, 'query', ph, 'qty', 1, 'unit', 'each', 'modifiers', '[]'::jsonb, 'confidence', 0.8))),
              null, '{}'::jsonb);
    l := plan->'lines'->0;
    if l->>'status' = 'matched' and l->'chosen'->>'product_id' = v_id::text then ok := ok + 1;
    else
      failed := failed || jsonb_build_object('phrasing', ph, 'status', l->>'status', 'chosen', l->'chosen'->>'name',
                                             'candidates', (select jsonb_agg(c->>'name') from jsonb_array_elements(case when jsonb_typeof(l->'candidates') = 'array' then l->'candidates' else '[]'::jsonb end) c));
      insert into search_word_reviews(sku, phrasing, got) values (p_sku, ph, failed->-1)
        on conflict (sku, phrasing) do update set got = excluded.got, status = 'open', created_at = now(), resolved_by = null, resolved_at = null;
    end if;
  end loop;
  return jsonb_build_object('ok', ok, 'failed', failed);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
