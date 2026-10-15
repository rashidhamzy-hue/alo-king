-- Session 5b (DECISIONS §39.8): the US test number serves customers and merchants until the company numbers replace it at
-- cut-over; broadcasts raise alerts of their own. Its own file because a new enum value cannot be used in the
-- transaction that adds it.
alter type public.whatsapp_number_role add value if not exists 'test';
alter type public.ops_alert_kind add value if not exists 'broadcast';
alter type public.ops_alert_kind add value if not exists 'template_status';
