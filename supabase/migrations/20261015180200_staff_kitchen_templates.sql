-- Session 5b (DECISIONS §32.5, §39.10 row 5b): two merchant messages that can fall outside WhatsApp's 24-hour window get
-- an approved template: the welcome a new staff member receives when the owner adds them (they have never written to
-- us), and "kitchen full" when new orders pause on their own at twice the shop's capacity. Both are written as replies
-- by merchant_proposal_apply and kitchen_capacity_check; rather than copy those large functions, this trigger tags the
-- two replies with the kind and values the templates need (dispatch/templates.ts fills them). The free-form text is
-- unchanged inside the window.

insert into public.app_config (key, value, effective_from, note, created_by)
select 'whatsapp_template_map',
  public.config_value('whatsapp_template_map') || '{"staff_welcome": "alo_staff_welcome", "kitchen_full": "alo_kitchen_full"}',
  now(), 'Adds the staff welcome and kitchen-full templates (§32.5); names and texts in _shared/whatsapp-templates.ts', null;

create function app_private.outbox_reply_kind() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_p public.merchant_proposals%rowtype;
begin
  if new.purpose <> 'reply' or new.payload ? 'kind' then
    return new;
  end if;
  if new.dedupe_key like 'reply:staff_add:%' then
    -- reply:staff_add:<proposal id>:<hash>
    v_id := nullif(split_part(new.dedupe_key, ':', 3), '')::uuid;
    select * into v_p from public.merchant_proposals where id = v_id and kind = 'staff_add';
    if v_p.id is not null then
      new.payload := new.payload || jsonb_build_object('kind', 'staff_welcome', 'role', v_p.payload ->> 'role',
        'shop', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_p.vendor_id));
    end if;
  elsif new.dedupe_key like 'reply:kitchen_full:%' then
    -- reply:kitchen_full:<vendor id>:<epoch>:<hash>
    v_id := nullif(split_part(new.dedupe_key, ':', 3), '')::uuid;
    new.payload := new.payload || jsonb_build_object('kind', 'kitchen_full',
      'shop', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_id),
      'queue', app_private.kitchen_queue(v_id)::text,
      'max', (select o.max_active_orders::text from public.vendor_ops o where o.vendor_id = v_id));
  end if;
  return new;
exception when invalid_text_representation then
  return new; -- a malformed key keeps the plain reply
end;
$$;
revoke all on function app_private.outbox_reply_kind() from public, anon, authenticated;

create trigger outbound_messages_reply_kind before insert on public.outbound_messages
  for each row when (new.purpose = 'reply') execute function app_private.outbox_reply_kind();
