-- Session 5 (DECISIONS §32.3): the allergen list grows to the twelve §32.3 names. Existing values keep
-- their meaning: `dairy` is milk and `nuts` is tree nuts. Its own file because a new enum value cannot be
-- used in the transaction that adds it.
alter type public.allergen add value if not exists 'peanuts';
alter type public.allergen add value if not exists 'mustard';
alter type public.allergen add value if not exists 'celery';
alter type public.allergen add value if not exists 'sulphites';
alter type public.ops_alert_kind add value if not exists 'menu_help';
