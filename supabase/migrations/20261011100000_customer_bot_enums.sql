-- Session 4 (Phase 3a, DECISIONS §10): enum values the customer bot needs. Its own file because a value
-- added to an enum cannot be used in the transaction that adds it.
alter type public.outbox_purpose add value if not exists 'customer_message';
alter type public.ops_alert_kind add value if not exists 'customer_handoff';
alter type public.ops_alert_kind add value if not exists 'customer_problem';
alter type public.ops_alert_kind add value if not exists 'ai_budget';
