-- First-touch acquisition source of a customer: click-to-WhatsApp ad or a QR code (set once by kapso-brain, service role only).
alter table public.customers
  add column if not exists acquisition_source text check (acquisition_source in ('ctwa','qr')),
  add column if not exists acquisition_ref jsonb,
  add column if not exists acquisition_at timestamptz;
