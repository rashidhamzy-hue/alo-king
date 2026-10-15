-- Session 5b (DECISIONS §32.1, §32.5): the order recovery engine and support cases raise alerts of their own. Its own file
-- because a new enum value cannot be used in the transaction that adds it.
alter type public.ops_alert_kind add value if not exists 'order_exception';
alter type public.ops_alert_kind add value if not exists 'support_case';
