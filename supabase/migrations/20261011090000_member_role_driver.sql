-- Phase 2 (DECISIONS §18.1 H, §27.2, §27.9): merchant staff get the `driver` role. Its own file because a
-- value added to an enum cannot be used in the transaction that adds it.
alter type public.member_role add value if not exists 'driver';
