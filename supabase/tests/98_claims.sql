-- Session 5: claims and registration (DECISIONS §18.1 A-M).
begin;

-- Fixtures: D has a mobile seed phone (case A); C (helpers) has a landline seed (case B); E has none (case C).
insert into public.vendors (id, slug, name_en, name_ar, business_type, source, place_id, location) values
  ('20000000-0000-0000-0000-0000000000d1', 'claim-mobile', 'Abu Claim Grill', 'مشاوي أبو كليم', 'restaurant', 'seed_2026_10', 'gpD1', 'SRID=4326;POINT(35.58 33.68)'),
  ('20000000-0000-0000-0000-0000000000d2', 'claim-none', 'Docs Bakery', null, 'bakery_manakish', 'seed_2026_10', 'gpD2', 'SRID=4326;POINT(35.58 33.68)');
insert into public.vendor_private (vendor_id, phone_seed) values
  ('20000000-0000-0000-0000-0000000000d1', '+96170123456'),
  ('20000000-0000-0000-0000-0000000000d2', null);
insert into public.brands (id, slug, name_en) values ('21000000-0000-0000-0000-000000000001', 'chain-test', 'Chain Test');
insert into public.vendors (id, brand_id, slug, name_en, business_type, source, place_id, location) values
  ('20000000-0000-0000-0000-0000000000f1', '21000000-0000-0000-0000-000000000001', 'chain-1', 'Chain Test', 'cafe', 'seed_2026_10', 'gpF1', 'SRID=4326;POINT(35.58 33.68)'),
  ('20000000-0000-0000-0000-0000000000f2', '21000000-0000-0000-0000-000000000001', 'chain-2', 'Chain Test', 'cafe', 'seed_2026_10', 'gpF2', 'SRID=4326;POINT(35.59 33.69)');
insert into public.vendor_private (vendor_id, phone_seed) values
  ('20000000-0000-0000-0000-0000000000f1', null), ('20000000-0000-0000-0000-0000000000f2', null);
insert into public.vendor_removed_places (place_id, reason) values ('ChIJremovedplace00', 'owner asked');

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Helpers
select tests.ok(app_private.is_lebanese_mobile('+96170123456') and app_private.is_lebanese_mobile('+9613123456')
  and not app_private.is_lebanese_mobile('+9615333333') and not app_private.is_lebanese_mobile('+96172123456'),
  'Lebanese mobiles: 3 and 70/71/76/78/79/81; landlines and other prefixes are not');

-- Search ------------------------------------------------------------------------------------------------
select tests.ok((select count(*) >= 1 from public.vendor_claim_search('abu claim grill')
  where vendor_id = '20000000-0000-0000-0000-0000000000d1' and seed_phone_tail = '…56'),
  'claim search finds the business by name and shows only the last two digits of its phone');

-- A: code by WhatsApp to the shop's own mobile ----------------------------------------------------------
select public.claim_start('20000000-0000-0000-0000-0000000000d1', '+96176555001', 'Samir', 'ar') as a1 \gset
select tests.ok(:'a1'::jsonb ->> 'case' = 'A' and :'a1'::jsonb ->> 'status' = 'code_sent'
  and :'a1'::jsonb #>> '{send,to}' = '+96170123456' and :'a1'::jsonb #>> '{send,channel}' = 'whatsapp'
  and (:'a1'::jsonb #>> '{send,code}') ~ '^[0-9]{6}$',
  'A: a 6-digit code goes by WhatsApp to the seed mobile, not to the claimant');
select tests.ok((select claim_status = 'pending' from public.vendors where id = '20000000-0000-0000-0000-0000000000d1'),
  'the vendor is pending while a claim is open');
select tests.ok((select code_hash is not null and code_hash <> (:'a1'::jsonb #>> '{send,code}') from public.vendor_claims
  where id = (:'a1'::jsonb ->> 'claim_id')::uuid), 'only a salted hash of the code is stored');
select tests.ok(public.claim_start('20000000-0000-0000-0000-0000000000d1', '+96176555001') ->> 'claim_id' = :'a1'::jsonb ->> 'claim_id',
  'starting again returns the open claim (no second code while the first is valid)');
select tests.ok(public.claim_verify_code('+96176555999', :'a1'::jsonb #>> '{send,code}') ->> 'status' = 'no_claim',
  'another number cannot use the code');
select tests.ok(public.claim_verify_code('+96176555001', '000000') ->> 'status' in ('wrong_code', 'approved'),
  'a wrong code is counted');
select public.claim_verify_code('+96176555001', :'a1'::jsonb #>> '{send,code}') as a2 \gset
select tests.ok(:'a2'::jsonb ->> 'status' = 'approved', 'A: the right code approves the claim');
select tests.ok((select claim_status = 'claimed' and not orderable and not public_page from public.vendors
  where id = '20000000-0000-0000-0000-0000000000d1'), 'the vendor is claimed but not yet orderable or public');
reset role;
select tests.ok((select m.role = 'owner' and m.status = 'active' and m.user_id is not null
    and exists (select 1 from app_private.phone_logins l where l.user_id = m.user_id and l.phone_e164 = '+96176555001')
  from public.vendor_members m where m.vendor_id = '20000000-0000-0000-0000-0000000000d1' and m.phone_e164 = '+96176555001'),
  'the claimant is the active owner with a phone login');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((select count(*) = 1 from public.outbound_messages where dedupe_key like 'reply:claim-approved:%'
  and target = '+96176555001'), 'the claimant is told, with the next step');
select tests.ok(public.claim_start('20000000-0000-0000-0000-0000000000d1', '+96176555001') ->> 'status' = 'already_owner',
  'an owner claiming again is told it is already theirs');

-- B: landline seed -> voice code; five wrong codes move the claim to documents ------------------------------
select public.claim_start('20000000-0000-0000-0000-00000000000c', '+96176555002', 'Rita', 'en') as b1 \gset
select tests.ok(:'b1'::jsonb ->> 'case' = 'B' and :'b1'::jsonb #>> '{send,channel}' = 'voice'
  and :'b1'::jsonb #>> '{send,to}' = '+9615333333', 'B: a landline seed gets the code by voice call');
reset role;
update public.vendor_claims set code_hash = encode(extensions.digest(code_salt || '123456', 'sha256'), 'hex')
where id = (:'b1'::jsonb ->> 'claim_id')::uuid;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.claim_verify_code('+96176555002', '000001') ->> 'left' = '4', 'a wrong code says how many tries are left');
select public.claim_verify_code('+96176555002', '000002'), public.claim_verify_code('+96176555002', '000003'),
  public.claim_verify_code('+96176555002', '000004');
select tests.ok(public.claim_verify_code('+96176555002', '000005') ->> 'status' = 'locked', 'five wrong codes lock the code path');
select tests.ok((select status = 'awaiting_documents' and code_hash is null from public.vendor_claims
  where id = (:'b1'::jsonb ->> 'claim_id')::uuid), 'a locked claim continues with documents (C)');
select tests.ok(public.claim_verify_code('+96176555002', '123456') ->> 'status' = 'no_claim', 'the old code no longer works');

-- C: no seed phone -> documents; Rasheed decides ------------------------------------------------------------
select public.claim_start('20000000-0000-0000-0000-0000000000d2', '+96176555003', 'Nadim', 'ar') as c1 \gset
select tests.ok(:'c1'::jsonb ->> 'case' = 'C' and :'c1'::jsonb ->> 'status' = 'awaiting_documents'
  and :'c1'::jsonb -> 'send' is null, 'C: no seed phone means documents, no code');
select tests.ok(public.claim_add_document('+96176555003', 'registration', 'wa-media:1', 'image/jpeg') -> 'missing' ? 'sign_photo',
  'after the registration the sign photo is still missing');
select tests.ok(public.claim_add_document('+96176555003', 'sign_photo', 'wa-media:2', 'image/jpeg') ->> 'status' = 'pending_review',
  'with both documents the claim goes to review');
select tests.ok((select count(*) = 1 from public.ops_alerts where kind = 'claim_review' and dedupe_key = 'claim-review:' || (:'c1'::jsonb ->> 'claim_id')),
  'Rasheed is alerted to review it');

-- G: a second claimant freezes both -----------------------------------------------------------------------
select public.claim_start('20000000-0000-0000-0000-0000000000d2', '+96176555004', 'Other', 'ar') as g1 \gset
select tests.ok(:'g1'::jsonb ->> 'case' = 'G' and (:'g1'::jsonb ->> 'contested')::boolean, 'G: a second claimant is contested');
select tests.ok((select claim_status = 'frozen' from public.vendors where id = '20000000-0000-0000-0000-0000000000d2'),
  'G: the vendor is frozen');
select tests.ok((select bool_and(contested) from public.vendor_claims where vendor_id = '20000000-0000-0000-0000-0000000000d2'),
  'G: both claims are marked contested');

-- Operator decision ---------------------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws(format('select public.claim_decide(%L, true)', :'c1'::jsonb ->> 'claim_id'), 'operators only',
  'a customer cannot decide a claim');
select tests.ok((select count(*) = 0 from public.vendor_claims), 'a customer sees no claims');
select tests.throws('select code_hash from public.vendor_claims', 'permission denied', 'code hashes are never readable by clients');
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok((select count(*) >= 3 from public.vendor_claims), 'an operator sees the claims');
select tests.ok(public.claim_decide((:'c1'::jsonb ->> 'claim_id')::uuid, true, 'documents match') ->> 'status' = 'approved',
  'the operator approves the claim with documents');
reset role;
select tests.ok((select status = 'rejected' from public.vendor_claims where id = (:'g1'::jsonb ->> 'claim_id')::uuid),
  'G: the other claim is closed when one is approved');
select tests.ok((select claim_status = 'claimed' from public.vendors where id = '20000000-0000-0000-0000-0000000000d2'),
  'the frozen vendor is claimed by the approved claimant');
select tests.ok((select decided_by = '00000000-0000-0000-0000-00000000000b' from public.vendor_claims where id = (:'c1'::jsonb ->> 'claim_id')::uuid),
  'the deciding operator is recorded');

-- I: sale of a claimed business: documents, approval, 72 h objection window -------------------------------
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.claim_start('20000000-0000-0000-0000-0000000000d1', '+96176555005', 'New owner', 'en') as i1 \gset
select tests.ok(:'i1'::jsonb ->> 'case' = 'I' and :'i1'::jsonb ->> 'status' = 'awaiting_documents', 'I: a claim on a claimed business needs documents');
select public.claim_add_document('+96176555005', 'registration', 'wa-media:3'), public.claim_add_document('+96176555005', 'sign_photo', 'wa-media:4');
select tests.ok(public.claim_decide((:'i1'::jsonb ->> 'claim_id')::uuid, true, 'sale contract', '00000000-0000-0000-0000-00000000000a') ->> 'status' = 'objection_window',
  'I: approving a sale opens the objection window');
select tests.ok((select count(*) = 1 from public.outbound_messages where dedupe_key like 'reply:claim-objection:%' and target = '+96176555001'),
  'I: the current owner gets an Object button');
select tests.throws(format('select public.claim_decide(%L, true, null, %L)', :'i1'::jsonb ->> 'claim_id', '00000000-0000-0000-0000-00000000000c'),
  'operators only', 'the server cannot act for a non-operator');
select tests.ok(public.claim_object('+96176555999', (:'i1'::jsonb ->> 'claim_id')::uuid) ->> 'status' = 'not_allowed',
  'only a current owner or manager can object');
update public.vendor_claims set objection_deadline = now() - interval '1 minute' where id = (:'i1'::jsonb ->> 'claim_id')::uuid;
reset role;
select app_private.claims_tick();
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((select status = 'approved' from public.vendor_claims where id = (:'i1'::jsonb ->> 'claim_id')::uuid),
  'I: with no objection the sale is approved when the window ends');
select tests.ok((select status = 'revoked' from public.vendor_members where vendor_id = '20000000-0000-0000-0000-0000000000d1' and phone_e164 = '+96176555001')
  and (select status = 'active' and role = 'owner' from public.vendor_members where vendor_id = '20000000-0000-0000-0000-0000000000d1' and phone_e164 = '+96176555005'),
  'I: the previous members are revoked and the new owner is active');

-- I with an objection --------------------------------------------------------------------------------------
select public.claim_start('20000000-0000-0000-0000-0000000000d1', '+96176555006') as i2 \gset
select public.claim_add_document('+96176555006', 'company', 'wa-media:5'), public.claim_add_document('+96176555006', 'sign_photo', 'wa-media:6');
select public.claim_decide((:'i2'::jsonb ->> 'claim_id')::uuid, true, null, '00000000-0000-0000-0000-00000000000a');
select tests.ok(public.claim_object('+96176555005', (:'i2'::jsonb ->> 'claim_id')::uuid) ->> 'status' = 'objected',
  'I: the current owner objects in time');
select tests.ok((select status = 'pending_review' and contested from public.vendor_claims where id = (:'i2'::jsonb ->> 'claim_id')::uuid),
  'I: an objected sale goes back to Rasheed, contested');

-- E: registration; a home kitchen without a registration document joins the waitlist ---------------------
select public.vendor_register('+96176555007', 'مطبخ أم علي', 'Um Ali Kitchen', 'restaurant', 33.68, 35.58, true, 'ar') as e1 \gset
select tests.ok(:'e1'::jsonb ->> 'case' = 'E' and :'e1'::jsonb -> 'missing' ? 'registration'
  and not (:'e1'::jsonb -> 'missing' ? 'sign_photo'), 'E: a home kitchen needs its registration document (no sign)');
select tests.ok((select claim_status = 'pending' and not orderable and not public_page and source = 'merchant'
  and field_sources ->> 'name_ar' = 'merchant' from public.vendors where id = (:'e1'::jsonb ->> 'vendor_id')::uuid),
  'E: the new business is pending, private and marked as the merchant''s own data');
select tests.ok(public.claim_no_registration('+96176555007', (:'e1'::jsonb ->> 'claim_id')::uuid) ->> 'status' = 'waitlist',
  'E: without a registration document a home kitchen joins the waitlist');
select tests.throws($$select public.vendor_register('+96176555008', 'x', null, 'cafe', 48.85, 2.35)$$, 'in Lebanon',
  'E: the pin must be in Lebanon');

-- D: live Google place --------------------------------------------------------------------------------------
select tests.ok(public.vendor_from_google('ChIJremovedplace00', 'Removed', 33.68, 35.58, 'cafe') ->> 'status' = 'removed',
  'D/K: a place the owner asked to remove is never re-created');
select public.vendor_from_google('ChIJnewgoogleplace1', 'Google Cafe', 33.68, 35.58, 'cafe', '+96171222333', 'Main road') as d1 \gset
select tests.ok(:'d1'::jsonb ->> 'status' = 'created' and (select source = 'google_live' and claim_status = 'unclaimed'
  and field_sources ->> 'name_en' = 'seed' from public.vendors where id = (:'d1'::jsonb ->> 'vendor_id')::uuid),
  'D: a live Google place is stored unclaimed with every field "please confirm"');
select tests.ok(public.vendor_from_google('ChIJnewgoogleplace1', 'Google Cafe', 33.68, 35.58, 'cafe') ->> 'status' = 'exists',
  'D: the same place is not created twice');
select tests.ok(public.claim_start((:'d1'::jsonb ->> 'vendor_id')::uuid, '+96176555009', null, 'en', 'D') ->> 'case' = 'D',
  'D: the claim keeps its case and continues by code to the Google phone');

-- F: brand-wide claim with a company document, then a new branch ----------------------------------------------
select public.claim_start('20000000-0000-0000-0000-0000000000f1', '+96176555010', 'HQ', 'en') as f1 \gset
update public.vendor_claims set brand_wide = true, claim_case = 'F' where id = (:'f1'::jsonb ->> 'claim_id')::uuid;
select tests.ok(public.claim_add_document('+96176555010', 'company', 'wa-media:7') ->> 'status' = 'pending_review',
  'F: a company document is enough for the brand');
select public.claim_decide((:'f1'::jsonb ->> 'claim_id')::uuid, true, null, '00000000-0000-0000-0000-00000000000a');
select tests.ok((select bool_and(claim_status = 'claimed') from public.vendors where brand_id = '21000000-0000-0000-0000-000000000001'),
  'F: every branch of the brand is claimed');
select id as hq_member from public.vendor_members where vendor_id = '20000000-0000-0000-0000-0000000000f2' and phone_e164 = '+96176555010' \gset
select tests.ok(public.vendor_branch_add(:'hq_member', 'Aley', 33.80, 35.60) ->> 'status' = 'created', 'F: the brand owner adds a branch');
select tests.ok((select count(*) = 3 from public.vendors where brand_id = '21000000-0000-0000-0000-000000000001'), 'F: the brand has three branches');
select tests.throws(format('select public.vendor_branch_add(%L, %L, 33.8, 35.6)',
  (select id from public.vendor_members where phone_e164 = '+96176555005' and vendor_id = '20000000-0000-0000-0000-0000000000d1'), 'x'),
  'brand owner', 'F: an owner without a brand-wide claim cannot add branches');

-- J: closed/moved by the merchant; customer reports hide a listing -------------------------------------------
select id as a_owner from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'owner' \gset
select public.vendor_set_listing('20000000-0000-0000-0000-00000000000a', 'closed', :'a_owner');
select tests.ok((select listing_status = 'closed' and not orderable and not public_page from public.vendors
  where id = '20000000-0000-0000-0000-00000000000a'), 'J: a closed business is not orderable or public');
select tests.throws(format('select public.vendor_set_listing(%L, %L, %L)', '20000000-0000-0000-0000-00000000000a', 'active',
  (select id from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'cashier')),
  'not allowed', 'J: a cashier cannot change the listing');
reset role;
insert into public.customers (id, phone_e164) values
  ('10000000-0000-0000-0000-0000000000c3', '+96170000003'), ('10000000-0000-0000-0000-0000000000c4', '+96170000004');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.vendor_report('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'closed');
select public.vendor_report('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'closed');
select public.vendor_report('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b', 'wrong');
select tests.ok((select listing_status = 'active' from public.vendors where id = '20000000-0000-0000-0000-00000000000b'),
  'J: two customers (one reporting twice) do not hide a listing');
select tests.ok(public.vendor_report('10000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-00000000000b', 'moved') ->> 'status' = 'hidden',
  'J: a third customer hides it until checked');
select tests.ok((select count(*) = 1 from public.ops_alerts where kind = 'listing_report' and vendor_id = '20000000-0000-0000-0000-00000000000b'),
  'J: the operator is alerted');

-- K: removal ------------------------------------------------------------------------------------------------
select id as d2_owner from public.vendor_members where vendor_id = '20000000-0000-0000-0000-0000000000d2' and role = 'owner' \gset
select tests.ok(public.vendor_remove_listing('20000000-0000-0000-0000-0000000000d2', 'closing for good', :'d2_owner') ->> 'status' = 'deleted',
  'K: a business with no orders is deleted');
select tests.ok(exists (select 1 from public.vendor_removed_places where place_id = 'gpD2')
  and not exists (select 1 from public.vendors where id = '20000000-0000-0000-0000-0000000000d2'),
  'K: only its place id is kept as do-not-re-import');
select tests.ok(public.vendor_remove_listing('20000000-0000-0000-0000-00000000000a', 'test', :'a_owner') ->> 'status' = 'hidden',
  'K: a business with orders is hidden, not deleted');
select tests.ok((select listing_status = 'hidden' and place_id is null from public.vendors where id = '20000000-0000-0000-0000-00000000000a')
  and (select phone_seed is null and owner_mobile is null from public.vendor_private where vendor_id = '20000000-0000-0000-0000-00000000000a')
  and not exists (select 1 from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and status = 'active'),
  'K: its contacts and staff are removed');

-- L: lost phone ---------------------------------------------------------------------------------------------
select public.member_recover_start('20000000-0000-0000-0000-0000000000f1', '+96176555011', 'ar') as l1 \gset
select tests.ok(:'l1'::jsonb ->> 'status' = 'awaiting_member', 'L: another owner is asked to confirm the new number');
select tests.ok(public.member_recover_decide('+96176555999', (:'l1'::jsonb ->> 'claim_id')::uuid, true) ->> 'status' = 'not_allowed',
  'L: only that member can confirm');
select tests.ok(public.member_recover_decide('+96176555010', (:'l1'::jsonb ->> 'claim_id')::uuid, true) ->> 'status' = 'approved',
  'L: the member''s tap adds the new number as an owner');

-- M: requests ------------------------------------------------------------------------------------------------
select public.vendor_request_note('Kababji Hasbaya');
select tests.ok(public.vendor_request_note('kababji  hasbaya') ->> 'count' = '2', 'M: requests for a missing business are counted, never sent');

-- Rate limit -----------------------------------------------------------------------------------------------
reset role;
insert into public.app_config (key, value, effective_from, note) values ('claims_daily_per_phone', '1', now() - interval '1 second', 'test');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.claim_start('20000000-0000-0000-0000-0000000000f2', '+96176555005') ->> 'status' = 'rate_limited',
  'one number cannot start unlimited claims');

rollback;
