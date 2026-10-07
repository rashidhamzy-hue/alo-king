-- Language of the customer's first text message ('ar' | 'en'); null = unknown, treated as Arabic when sending.
alter table public.customers
  add column if not exists language text check (language in ('ar','en')),
  add column if not exists language_set_at timestamptz;
