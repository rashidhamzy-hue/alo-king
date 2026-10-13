-- Session 6b: a new alert kind for driver applications from the website (DECISIONS §37.4). An enum value must be
-- committed before a function uses it, so it has its own file (as in the earlier *_enums.sql files).
alter type public.ops_alert_kind add value if not exists 'driver_application';
