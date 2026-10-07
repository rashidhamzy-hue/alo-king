alter table public.customers add column if not exists last_inbound_at timestamptz;
comment on column public.customers.last_inbound_at is 'Last message received from the customer: drives the WhatsApp 24h free-form window. Kept when chat history is deleted.';
comment on column public.customers.data_consent_at is 'When the one-line privacy notice was first shown (first time an address/location was saved). Records notice display plus the customer going on to provide the address; not a marketing opt-in.';
update public.customers c set last_inbound_at = x.t from (select phone, max(created_at) t from public.conversations where role = 'user' group by phone) x where x.phone = c.phone_number and c.last_inbound_at is null;
