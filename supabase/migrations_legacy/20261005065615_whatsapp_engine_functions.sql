
create or replace function public.reserve_broadcast_credits(p_vendor text, p_amount numeric) returns boolean
language plpgsql security definer set search_path=public as $$
declare n int; begin
  update vendors set broadcast_credits_usd = broadcast_credits_usd - p_amount where vendor_id=p_vendor and broadcast_credits_usd >= p_amount;
  get diagnostics n = row_count; return n=1; end $$;
create or replace function public.refund_broadcast_credits(p_vendor text, p_amount numeric) returns void
language sql security definer set search_path=public as $$
  update vendors set broadcast_credits_usd = broadcast_credits_usd + p_amount where vendor_id=p_vendor $$;

create or replace function public.broadcast_audience(p_vendor text, p_village text default null)
returns table(phone text) language sql stable security definer set search_path=public as $$
  select distinct c.phone_number from customers c
  where c.marketing_opt_in and (
      exists (select 1 from orders o where o.customer_phone=c.phone_number and o.vendor_id=p_vendor)
      or (p_village is not null and (lower(coalesce(c.village,''))=lower(p_village)
          or exists (select 1 from orders o where o.customer_phone=c.phone_number and lower(coalesce(o.delivery_village,''))=lower(p_village))))) $$;

create or replace function public.create_owner_link_code(p_vendor text) returns text
language plpgsql security definer set search_path=public as $$
declare c text; begin
  if not public.can_manage_vendor(p_vendor) then raise exception 'not allowed'; end if;
  c := 'ALO-'||upper(substr(md5(random()::text||clock_timestamp()::text),1,6));
  insert into owner_link_codes(code,vendor_id,created_by) values (c,p_vendor,auth.uid());
  return c; end $$;

create or replace function public.get_owner_console(p_vendor text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if not public.can_manage_vendor(p_vendor) then raise exception 'not allowed'; end if;
  return (select jsonb_build_object('linked', owner_whatsapp_phone is not null,'owner_phone', owner_whatsapp_phone,'credits_usd', broadcast_credits_usd) from vendors where vendor_id=p_vendor);
end $$;

create or replace function public.vendor_is_open(p_vendor_id text) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare p record; local_ts timestamp; dow text; nowt time; rng jsonb; s time; e time; ok boolean := false;
begin
  select hours, accepts_orders, paused_until, closed_dates into p from public.vendor_profiles where vendor_id = p_vendor_id;
  if not found then return null; end if;
  if p.accepts_orders is false then return false; end if;
  if p.paused_until is not null and p.paused_until > now() then return false; end if;
  if p.hours is null then return null; end if;
  local_ts := now() at time zone 'Asia/Beirut';
  if exists (select 1 from jsonb_array_elements(coalesce(p.closed_dates,'[]'::jsonb)) as c(v)
     where local_ts::date between (c.v->>'from')::date and coalesce((c.v->>'to')::date,(c.v->>'from')::date)) then return false; end if;
  dow := lower(to_char(local_ts,'dy')); nowt := local_ts::time;
  for rng in select value from jsonb_array_elements(coalesce(p.hours -> dow,'[]'::jsonb)) loop
    s := (rng->>0)::time; e := (rng->>1)::time;
    if e > s then if nowt >= s and nowt < e then ok := true; end if;
    else if nowt >= s or nowt < e then ok := true; end if; end if;
  end loop;
  return ok;
end $$;

revoke all on function public.reserve_broadcast_credits(text,numeric), public.refund_broadcast_credits(text,numeric), public.broadcast_audience(text,text) from public, anon, authenticated;
revoke all on function public.create_owner_link_code(text), public.get_owner_console(text) from public, anon;
grant execute on function public.create_owner_link_code(text), public.get_owner_console(text) to authenticated;
