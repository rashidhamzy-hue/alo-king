-- Rollback for 20261011140100_claims_registration.sql. The migration itself deletes no data: the guard
-- matches the DELETE statements inside vendor_remove_listing() (case K) and onboarding_session_set(), which
-- run later. This file removes everything the migration created. Vendors registered through it stay.
select cron.unschedule('claims-tick');
drop function if exists public.onboarding_session_set(text, text, jsonb, public.lang_code);
drop function if exists public.onboarding_session_get(text);
drop function if exists public.vendor_request_note(text, text);
drop function if exists public.member_recover_decide(text, uuid, boolean);
drop function if exists public.member_recover_start(uuid, text, public.lang_code);
drop function if exists public.vendor_remove_listing(uuid, text, uuid);
drop function if exists public.vendor_report(uuid, uuid, text);
drop function if exists public.vendor_set_listing(uuid, public.listing_status, uuid);
drop function if exists public.vendor_branch_add(uuid, text, double precision, double precision);
drop function if exists public.vendor_from_google(text, text, double precision, double precision, public.business_type, text, text);
drop function if exists public.vendor_register(text, text, text, public.business_type, double precision, double precision, boolean, public.lang_code, boolean);
drop function if exists app_private.new_vendor_slug(text);
drop function if exists public.claims_for_phone(text);
drop function if exists app_private.claims_tick();
drop function if exists public.claim_object(text, uuid);
drop function if exists public.claim_decide(uuid, boolean, text, uuid);
drop function if exists app_private.claim_decide(uuid, boolean, text, uuid);
drop function if exists public.claim_no_registration(text, uuid);
drop function if exists public.claim_add_document(text, public.claim_document_kind, text, text, uuid);
drop function if exists public.claim_use_documents(text, uuid);
drop function if exists public.claim_verify_code(text, text, uuid);
drop function if exists app_private.claim_approve(uuid, uuid);
drop function if exists public.claim_start(uuid, text, text, public.lang_code, text);
drop function if exists public.vendor_claim_search(text, text, integer);
drop function if exists app_private.claim_documents_missing(public.vendor_claims);
drop function if exists app_private.claim_rate_ok(text);
drop function if exists app_private.phone_tail(text);
drop function if exists app_private.claim_new_code(uuid, text);
drop function if exists app_private.auth_user_for_phone(text);
drop table if exists app_private.phone_logins;
drop function if exists app_private.is_lebanese_mobile(text);
drop table if exists public.vendor_requests;
drop table if exists public.vendor_listing_reports;
drop table if exists public.merchant_onboarding_sessions;
drop table if exists public.vendor_claims;
drop type if exists public.claim_document_kind;
drop type if exists public.claim_request_status;
-- The config rows are dated: a newer row with the old behaviour replaces them if needed.
