-- Manual vendor-claim review: audit log + one decision function used by WhatsApp buttons and the admin UI.
create table if not exists public.claim_audit_log (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.vendor_claims(id),
  vendor_id text not null,
  event text not null check (event in ('requested','admin_notified','admin_notify_failed','approved','rejected','decision_failed')),
  actor text,
  source text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists claim_audit_log_claim_idx on public.claim_audit_log(claim_id, created_at);
alter table public.claim_audit_log enable row level security;
revoke all on public.claim_audit_log from anon, authenticated;
grant select on public.claim_audit_log to authenticated;
create policy "admin reads claim audit log" on public.claim_audit_log for select to authenticated using (public.my_role() = 'admin');

-- Approve or reject a pending claim, link the owner's WhatsApp, and audit-log the decision.
create or replace function public.decide_claim(p_claim_id uuid, p_approve boolean, p_actor text, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v record; linked boolean := false; link_note text := null; res jsonb;
begin
  select * into c from public.vendor_claims where id = p_claim_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'claim not found'); end if;
  if c.status not in ('pending_otp','pending_review') then
    return jsonb_build_object('ok', false, 'error', 'already decided', 'status', c.status);
  end if;
  select vendor_id, name_en, owner_whatsapp_phone into v from public.vendors where vendor_id = c.vendor_id;
  if p_approve then
    begin
      perform public.finalize_claim(p_claim_id);
    exception when others then
      insert into public.claim_audit_log(claim_id, vendor_id, event, actor, source, details)
        values (p_claim_id, c.vendor_id, 'decision_failed', p_actor, p_source, jsonb_build_object('error', sqlerrm, 'wanted', 'approve'));
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;
    -- link the claimant's WhatsApp as the owner console number, never overwriting a different existing link
    if v.owner_whatsapp_phone is null then
      begin
        update public.vendors set owner_whatsapp_phone = c.contact_phone where vendor_id = c.vendor_id;
        linked := true;
      exception when unique_violation then link_note := 'phone already linked to another vendor';
      end;
    elsif v.owner_whatsapp_phone = public.norm_phone(c.contact_phone) then linked := true;
    else link_note := 'vendor already has a different owner number';
    end if;
  else
    update public.vendor_claims set status = 'rejected', reviewed_at = now(), otp_hash = null where id = p_claim_id;
  end if;
  insert into public.claim_audit_log(claim_id, vendor_id, event, actor, source, details)
    values (p_claim_id, c.vendor_id, case when p_approve then 'approved' else 'rejected' end, p_actor, p_source,
            jsonb_build_object('owner_linked', linked, 'link_note', link_note, 'contact_name', c.contact_name));
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end, 'vendor_id', c.vendor_id,
    'vendor_name', v.name_en, 'contact_name', c.contact_name, 'contact_phone', c.contact_phone, 'owner_linked', linked, 'link_note', link_note);
end $$;
revoke all on function public.decide_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.decide_claim(uuid, boolean, text, text) to service_role;

-- Admin UI path: same decision logic, audit-logged as admin_ui.
create or replace function public.review_claim(p_claim_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'admin only'; end if;
  r := public.decide_claim(p_claim_id, p_approve, 'admin:' || coalesce(auth.uid()::text, 'unknown'), 'admin_ui');
  if not (r->>'ok')::boolean then raise exception '%', r->>'error'; end if;
end $$;
