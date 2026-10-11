-- Session 5 (DECISIONS §18, §32.8): enum values the claims work needs. Its own file because a value added
-- to an enum cannot be used in the transaction that adds it.
alter type public.ops_alert_kind add value if not exists 'claim_review';
alter type public.ops_alert_kind add value if not exists 'listing_report';
