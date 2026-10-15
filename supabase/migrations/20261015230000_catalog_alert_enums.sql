-- Session 5d follow-up (DECISIONS §39.12): the catalogue sync's fifth-failure alert has a kind of its own. Its own file
-- because a new enum value cannot be used in the transaction that adds it.
alter type public.ops_alert_kind add value if not exists 'catalog_sync_failed';
