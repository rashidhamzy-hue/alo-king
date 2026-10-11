-- Session 4 (Phase 3a), part 2: what the customer bot's edge code reads besides the part-1 RPCs.
--   * customer_search_point: where to search from (the open basket's address, else the default one). Code
--     only; coordinates never reach the model or a message.
--   * voice_vocabulary: the Lebanese vocabulary prompt for transcription, built from our own data (§30.1.6):
--     dish names on orderable menus, the customer's usual items and places, then the most common places.

create function public.customer_search_point(p_customer_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('lat', extensions.st_y(a.pin::extensions.geometry), 'lon', extensions.st_x(a.pin::extensions.geometry),
    'address_id', a.id)
  from public.addresses a
  where a.customer_id = p_customer_id and a.pin is not null
  order by (a.id = (select b.address_id from public.baskets b where b.customer_id = p_customer_id and b.status = 'open')) desc nulls last,
    a.is_default desc, a.last_used_at desc nulls last
  limit 1;
$$;

-- At most p_limit terms, the customer's own first: their usual items and places, then dish names from
-- orderable vendors near them (or everywhere), then town and city names.
create function public.voice_vocabulary(p_customer_id uuid default null, p_limit integer default 120) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct coalesce(i.name_ar, i.name_en) as term, 1 as rank
    from public.orders o join public.order_items i on i.order_id = o.id
    where p_customer_id is not null and o.customer_id = p_customer_id
    union
    select distinct coalesce(p.name_ar, p.name_en), 1
    from public.addresses a join public.places p on p.id = a.place_id
    where p_customer_id is not null and a.customer_id = p_customer_id
  ),
  dishes as (
    select x.term, 2 as rank from (
      select distinct unnest(array[i.name_ar, i.name_en]) as term
      from public.menu_items i join public.vendors v on v.id = i.vendor_id
      where v.orderable and v.listing_status = 'active' and i.available
    ) x where x.term is not null
  ),
  places as (
    select coalesce(p.name_ar, p.name_en) as term, 3 as rank
    from public.places p where p.kind in ('city', 'town') and p.service_status <> 'paused'
  ),
  terms as (
    select term, min(rank) as rank from (select * from mine union all select * from dishes union all select * from places) t
    where term is not null and char_length(term) between 2 and 40
    group by term
  )
  select coalesce(array_agg(term order by rank, term), '{}')
  from (select term, rank from terms order by rank, term limit least(greatest(coalesce(p_limit, 120), 10), 300)) s;
$$;

revoke all on function public.customer_search_point(uuid), public.voice_vocabulary(uuid, integer) from public, anon, authenticated;
grant execute on function public.customer_search_point(uuid), public.voice_vocabulary(uuid, integer) to service_role;

-- resolve_location, place part rewritten (the location eval, evals/location/, found it matched the whole
-- message against place names, so "Baakline, near the main square" found nothing). Now every 1-3 word
-- window of the message is searched with search_places, with the Arabic and Arabizi prefixes customers glue
-- onto names (ب، بال، ل، و، عال، b, bel, fi) also stripped. Longer windows that match win ties. The rest is
-- unchanged: the customer's own saved addresses, shared or confirmed landmarks, buildings and streets, and
-- the pin's own place. Only reads the places tables (§31).
create or replace function public.resolve_location(
  p_text text,
  p_lat double precision default null,
  p_lon double precision default null,
  p_customer_id uuid default null,
  p_limit integer default 5
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_words text[];
  v_grams text[] := '{}';
  v_g text;
  v_n integer;
  i integer;
  k integer;
  v_places jsonb := '[]';
  v_rest jsonb;
  v_all jsonb;
begin
  -- Words of the message, lower case, punctuation removed; at most 14 so a long voice transcript stays cheap.
  select array_agg(w order by ord) into v_words from (
    select w, ord from regexp_split_to_table(lower(coalesce(p_text, '')), '[[:space:],،.;:!?()"/\\-]+') with ordinality t(w, ord)
    where w <> '' limit 14) s;
  v_n := coalesce(array_length(v_words, 1), 0);
  for i in 1 .. v_n loop
    for k in 0 .. 2 loop
      exit when i + k > v_n;
      v_g := array_to_string(v_words[i:i + k], ' ');
      v_grams := v_grams || v_g;
      -- Glued prefixes: "ببعقلين", "بالسمقانية", "عالباروك", "lal", single-letter "b ba3aleen" is its own word.
      if k = 0 then
        v_grams := v_grams || regexp_replace(v_g, '^(بال|عال|ب|ل|و|ال)', '') || regexp_replace(v_g, '^(bel|bil|fi|b|l)(?=[a-z0-9]{4,})', '');
      end if;
    end loop;
  end loop;

  with g as (select distinct x as gram, array_length(string_to_array(x, ' '), 1) as words from unnest(v_grams) x where char_length(x) >= 3),
  hits as (
    select sp.id, sp.label_ar, sp.label_en, sp.service_status,
      sp.score * (1 + 0.05 * (g.words - 1)) as score, g.words
    from g cross join lateral public.search_places(g.gram, null, 3) sp
    where sp.score >= case when g.words = 1 then 0.7 else 0.6 end
  ),
  best as (select distinct on (id) * from hits order by id, score desc)
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'place', 'id', id, 'place_id', id, 'label_ar', label_ar, 'label_en', label_en,
    'score', score) order by score desc), '[]')
  into v_places from (select * from best order by score desc limit 5) b;

  -- Saved addresses, landmarks, buildings, streets and the pin's place, as before.
  with q as (
    select app_private.normalize_place_name(coalesce(p_text, '')) as n,
      case when p_lat is not null and p_lon is not null then app_private.lat_lon_point(p_lat, p_lon) end as pt
  ),
  cands as (
    select 'saved_address' as kind, a.id::text as id, a.place_id, coalesce(a.label, p.name_ar, p.name_en) as label_ar,
      coalesce(a.label, p.name_en, p.name_ar) as label_en,
      greatest(extensions.word_similarity(q.n, app_private.normalize_place_name(coalesce(a.label, ''))),
               extensions.word_similarity(q.n, p.search_text)) + 0.15 as score
    from public.addresses a join public.places p on p.id = a.place_id cross join q
    where p_customer_id is not null and a.customer_id = p_customer_id and q.n <> ''
    union all
    select 'place', pa.place_id, pa.place_id, coalesce(p.name_ar, p.name_en), coalesce(p.name_en, p.name_ar),
      extensions.word_similarity(pa.normalized_alias, q.n)
    from public.place_aliases pa join public.places p on p.id = pa.place_id cross join q
    where pa.status = 'confirmed' and q.n <> ''
    union all
    select 'landmark', l.id::text, l.place_id, coalesce(l.name_ar, l.name_en), coalesce(l.name_en, l.name_ar),
      (select max(extensions.word_similarity(app_private.normalize_place_name(x), q.n)) from unnest(array[l.name_ar, l.name_en] || l.aliases) x where x is not null)
        + case when q.pt is not null and extensions.st_dwithin(l.point, q.pt, 2000) then 0.1 else 0 end
    from public.landmarks l cross join q
    where (l.status = 'confirmed' or l.shared) and q.n <> ''
      and (q.pt is null or extensions.st_dwithin(l.point, q.pt, 15000))
    union all
    select 'building', b.id::text, b.place_id, coalesce(b.name_ar, b.name_en), coalesce(b.name_en, b.name_ar),
      (select max(extensions.word_similarity(app_private.normalize_place_name(x), q.n)) from unnest(array[b.name_ar, b.name_en] || b.aliases) x where x is not null)
        + case when q.pt is not null and extensions.st_dwithin(b.entrance_point, q.pt, 1000) then 0.1 else 0 end
    from public.buildings b cross join q
    where (b.status = 'confirmed' or b.shared) and q.n <> ''
      and (q.pt is null or extensions.st_dwithin(b.entrance_point, q.pt, 15000))
    union all
    select 'street', s.id::text, s.place_id, s.name, s.name, extensions.word_similarity(s.normalized_name, q.n)
    from public.street_aliases s cross join q
    where (s.status = 'confirmed' or s.shared) and q.n <> ''
    union all
    select 'pin_place', fp.place_id, fp.place_id, coalesce(p.name_ar, p.name_en), coalesce(p.name_en, p.name_ar), 0.7
    from q cross join lateral public.place_for_point(q.pt) fp join public.places p on p.id = fp.place_id
    where q.pt is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'place_id', place_id, 'label_ar', label_ar,
    'label_en', label_en, 'score', score)), '[]')
  into v_rest from cands where score >= 0.45;

  select coalesce(jsonb_agg(jsonb_build_object('kind', c ->> 'kind', 'id', c ->> 'id', 'place_id', c ->> 'place_id',
      'label_ar', c ->> 'label_ar', 'label_en', c ->> 'label_en',
      'confidence', round(least((c ->> 'score')::numeric, 1), 2),
      'place_status', (select p.service_status from public.places p where p.id = c ->> 'place_id'))
    order by (c ->> 'score')::numeric desc), '[]')
  into v_all
  from (
    select c from (
      select distinct on (c ->> 'kind', c ->> 'id') c
      from jsonb_array_elements(v_places || v_rest) c
      order by c ->> 'kind', c ->> 'id', (c ->> 'score')::numeric desc
    ) d
    order by (c ->> 'score')::numeric desc
    limit least(greatest(coalesce(p_limit, 5), 1), 10)
  ) top;
  return v_all;
end;
$$;
revoke all on function public.resolve_location(text, double precision, double precision, uuid, integer) from public, anon, authenticated;
grant execute on function public.resolve_location(text, double precision, double precision, uuid, integer) to service_role;
