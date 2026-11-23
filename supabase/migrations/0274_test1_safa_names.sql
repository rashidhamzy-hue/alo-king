-- Alo King Chouf, session TEST1, migration 0274: the names customers use for Safa Chicken, on staging. docs/DECISIONS.md, "TEST1", row 19.
--
-- The journeys on staging (test1-journeys run 45133808623) showed «بدي ساندويش شاورما لحمة من صفا» not finding Safa Chicken: its "other
-- names customers use" (FD2's place_aliases, the Places page; the founder's step 7 of FD1) were never filled, so «صفا» named no place and the
-- food path (choices asked by code, the card with the place) never started. The names are entered through the Places page's own door
-- (set_place_details, logged in place_log) as the staging probe's ops lead, and only while the list is still empty, so a person's own list
-- is never overwritten. STAGING ONLY (a database marked as staging, 0271).
select set_place_details(s.id, (select id from parties where is_probe and role = 'ops_lead' order by created_at limit 1),
         jsonb_build_object('aliases', jsonb_build_array('صفا', 'صفا تشيكن', 'صفا شيكن', 'دجاج صفا', 'safa', 'safa chicken')))
  from sources s
 where s.name = 'Safa Chicken' and s.buys_for_customer and cardinality(s.place_aliases) = 0 and db_is_staging()
   and exists (select 1 from parties where is_probe and role = 'ops_lead');
