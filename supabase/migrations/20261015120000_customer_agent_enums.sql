-- Session 5c (DECISIONS §38.3, §39.6): alert kinds used by the customer agent migration that follows. Its own file because
-- a new enum value cannot be used in the transaction that adds it.
alter type public.ops_alert_kind add value if not exists 'customer_dispute';
alter type public.ops_alert_kind add value if not exists 'message_budget';
alter type public.ops_alert_kind add value if not exists 'dead_letter';
