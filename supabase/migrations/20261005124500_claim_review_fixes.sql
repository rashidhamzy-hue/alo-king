-- Fixes from review: normalise the owner phone before linking, audit refused/unauthorised attempts, re-state grants.
alter table public.claim_audit_log drop constraint if exists claim_audit_log_event_check;
alter table public.claim_audit_log add constraint claim_audit_log_event_check
  check (event in ('requested','admin_notified','admin_notify_failed','approved','rejected','decision_failed','decision_rejected','unauthorized_attempt'));
revoke all on public.claim_audit_log from public;

create or replace function public.decide_claim(p_claim_id uuid, p_approve boolean, p_actor text, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v record; ph text; linked boolean := false; link_note text := null;
begin
  select * into c from public.vendor_claims where id = p_claim_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'claim not found'); end if;
  if c.status not in ('pending_otp','pending_review') then
    insert into public.claim_audit_log(claim_id, vendor_id, event, actor, source, details)
      values (p_claim_id, c.vendor_id, 'decision_rejected', p_actor, p_source, jsonb_build_object('error', 'already decided', 'status', c.status, 'wanted', case when p_approve then 'approve' else 'reject' end));
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
    -- link the claimant's WhatsApp as the owner console number (normalised, as kapso-brain looks it up), never overwriting a different link
    ph := nullif(public.norm_phone(c.contact_phone), '');
    if ph is null then link_note := 'invalid phone';
    elsif v.owner_whatsapp_phone is null then
      begin
        update public.vendors set owner_whatsapp_phone = ph where vendor_id = c.vendor_id;
        linked := true;
      exception when unique_violation then link_note := 'phone already linked to another vendor';
      end;
    elsif v.owner_whatsapp_phone = ph then linked := true;
    else link_note := 'vendor already has a different owner number';
    end if;
  else
    update public.vendor_claims set status = 'rejected', reviewed_at = now(), otp_hash = null where id = p_claim_id;
  end if;
  insert into public.claim_audit_log(claim_id, vendor_id, event, actor, source, details)
    values (p_claim_id, c.vendor_id, case when p_approve then 'approved' else 'rejected' end, p_actor, p_source,
            jsonb_build_object('owner_linked', linked, 'link_note', link_note, 'contact_name', c.contact_name));
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end, 'vendor_id', c.vendor_id,
    'vendor_name', v.name_en, 'contact_name', c.contact_name, 'contact_phone', ph, 'owner_linked', linked, 'link_note', link_note);
end $$;
revoke all on function public.decide_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.decide_claim(uuid, boolean, text, text) to service_role;
revoke all on function public.review_claim(uuid, boolean) from public, anon;
grant execute on function public.review_claim(uuid, boolean) to authenticated;
