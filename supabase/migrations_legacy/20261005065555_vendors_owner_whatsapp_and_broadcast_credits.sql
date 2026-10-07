
create or replace function public.norm_phone(p text) returns text language sql immutable set search_path=public as $$
  select case when p is null then null else (select case
      when d = '' then null
      when d like '961%' then d
      when d like '0%' and length(d) between 8 and 9 then '961'||substr(d,2)
      when length(d) between 7 and 8 then '961'||d
      else d end
      from (select regexp_replace(regexp_replace(p,'^\s*00',''),'\D','','g') d) x) end $$;

alter table public.vendors
  add column if not exists owner_whatsapp_phone text,
  add column if not exists broadcast_credits_usd numeric(10,2) not null default 10.00;
alter table public.vendors add constraint vendors_owner_whatsapp_phone_key unique (owner_whatsapp_phone);
alter table public.vendors add constraint vendors_credits_nonneg check (broadcast_credits_usd >= 0);

create or replace function public.vendors_norm_owner_phone() returns trigger language plpgsql set search_path=public as $$
begin new.owner_whatsapp_phone := nullif(public.norm_phone(new.owner_whatsapp_phone),''); return new; end $$;
create trigger trg_vendors_norm_owner_phone before insert or update of owner_whatsapp_phone on public.vendors
  for each row execute function public.vendors_norm_owner_phone();
