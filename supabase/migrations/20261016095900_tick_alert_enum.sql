-- Session 5e: a background tick step that fails raises an operator alert (its own migration: a new enum value cannot be
-- used in the transaction that adds it).
alter type public.ops_alert_kind add value if not exists 'tick_failed';
