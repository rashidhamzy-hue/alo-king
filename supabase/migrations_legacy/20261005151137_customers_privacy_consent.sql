-- Privacy (Law 81/2018 spirit): when the customer was shown the one-line privacy notice (first time an address/location is saved), which notice version, and when they last used "delete my data".
alter table public.customers add column if not exists data_consent_at timestamptz;
alter table public.customers add column if not exists privacy_notice_version smallint;
alter table public.customers add column if not exists data_deleted_at timestamptz;
