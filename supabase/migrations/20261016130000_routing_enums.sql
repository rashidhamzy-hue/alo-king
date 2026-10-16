-- Session 5f (DECISIONS §39.15.1): crossing 60% of the day's OpenRouteService budget raises an operator alert (its own
-- migration: a new enum value cannot be used in the transaction that adds it).
alter type public.ops_alert_kind add value if not exists 'routing_budget';
