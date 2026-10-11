#!/usr/bin/env bash
# Location eval (DECISIONS §28.5): resolve_location on 100+ real-style address messages in four languages,
# scored top-1 and top-3 against the expected places. Runs where the places seed is loaded (CI db-tests,
# after load-seed.sh). Fails below MIN_TOP3 (default 0.90) so a regression in search or aliases shows.
# Usage: DB_URL=... scripts/evals/location-eval.sh [evals/location/addresses.jsonl]
set -euo pipefail
: "${DB_URL:?set DB_URL}"
file="${1:-evals/location/addresses.jsonl}"
min="${MIN_TOP3:-0.90}"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<SQL
create temp table eval_loc (id text, lang text, text text, expect text[]);
\copy eval_loc from program 'jq -r ''[.id, .lang, .text, ("{" + (.expect | join(",")) + "}")] | @tsv'' $file'
create temp table eval_out as
select e.id, e.lang, e.text, e.expect,
  (select array_agg(c ->> 'place_id' order by ord) from jsonb_array_elements(public.resolve_location(e.text, null, null, null, 3)) with ordinality t(c, ord)) as got
from eval_loc e;
select lang, count(*) as n,
  round(avg((coalesce(got[1], '') = any (expect))::int), 2) as top1,
  round(avg((coalesce(got, '{}') && expect)::int), 2) as top3
from eval_out group by rollup (lang) order by lang nulls last;
\echo 'misses (top 3):'
select id, text, expect, got from eval_out where not (coalesce(got, '{}') && expect) order by id;
do \$\$
declare v numeric;
begin
  select avg((coalesce(got, '{}') && expect)::int) into v from eval_out;
  if v < $min then raise exception 'location eval top-3 % is below %', round(v, 2), $min; end if;
  raise notice 'location eval top-3 %', round(v, 2);
end \$\$;
SQL
