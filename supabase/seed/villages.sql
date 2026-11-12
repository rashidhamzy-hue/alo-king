-- Launch zone: 20 to 30 minute ride radius around the Baakline-Baqaata corridor.
-- DRAFT. Ring membership is an estimate to be corrected by people who ride these roads.
-- Fees are placeholders. Coordinates are left null on purpose: fill them with
-- scripts/fetch_village_coords.mjs (OpenStreetMap), then build travel_times with OSRM
-- using Baakline and Baqaata as the two seed origins.
insert into zones(name, delivery_fee_usd, base_eta_minutes) values
  ('core',  1.00, 20),   -- up to about 10 minutes from the corridor
  ('mid',   1.50, 30),   -- about 10 to 20 minutes
  ('outer', 2.50, 45)    -- about 20 to 30 minutes
on conflict (name) do nothing;

insert into villages(zone_id, name_en, name_ar, aliases, is_served)
select z.id, v.name_en, v.name_ar, v.aliases, true
from (values
  ('core','Baakline','بعقلين',array['baaqline','ba3aklin','baakleen','b3aklin']),
  ('core','Baqaata','بقعاتا',array['baakata','b2a3ata','bkaata','baqata']),
  ('core','Semqaniyeh','السمقانية',array['simqanieh','sem2aniyeh','smeqaniyeh']),
  ('core','Jdeidet ech Chouf','جديدة الشوف',array['jdeideh','jdaydeh','jdeidet el chouf']),
  ('core','Ain w Zein','عين وزين',array['ain wzein','3ein w zein','ainwzein']),
  ('core','Aainbal','عينبال',array['ainbal','3ainbal']),
  ('mid','Beiteddine','بيت الدين',array['beit eddine','bteddine','beiteddin','beit el din']),
  ('mid','Deir el Qamar','دير القمر',array['deir el kamar','deir el amar','der el 2amar']),
  ('mid','Moukhtara','المختارة',array['mukhtara','el moukhtara','mokhtara']),
  ('mid','Botmeh','بطمة',array['botme','batmeh']),
  ('mid','Ain Qani','عين قني',array['ain kani','3ein 2ani','ainqani']),
  ('mid','Mazraat ech Chouf','مزرعة الشوف',array['mazraa','mazraat el chouf','el mazra3a']),
  ('mid','Kahlouniyeh','الكحلونية',array['kahlounieh','ka7louniyeh']),
  ('mid','Gharifeh','غريفة',array['gharife','ghrifeh']),
  ('mid','Aatrine','عترين',array['atrine','3atrin']),
  ('mid','Kfarnabrakh','كفرنبرخ',array['kfar nabrakh','kfarnabra5']),
  ('mid','Batloun','بتلون',array['batloon','btaloun']),
  ('mid','Maasser Beiteddine','معاصر بيت الدين',array['maaser beiteddine','m3aser beit eddine']),
  ('mid','Kfarhim','كفرحيم',array['kfar him','kfar7im']),
  ('mid','Deir Dourit','دير دوريت',array['deir durit','der dourit']),
  ('mid','Deir Baba','دير بابا',array['der baba']),
  ('mid','Kfarfaqoud','كفرفاقود',array['kfar fakoud','kfarfa2oud']),
  ('mid','Bchetfine','بشتفين',array['bshatfin','bchatfine']),
  ('mid','Fouara','الفوارة',array['fawara','el fouara','fwara']),
  ('mid','Warhaniyeh','الورهانية',array['warhanieh','el warhaniyeh']),
  ('outer','Barouk','الباروك',array['el barouk','barook']),
  ('outer','Fraidis','الفريديس',array['freidis','fraydis','el fraidis']),
  ('outer','Maasser ech Chouf','معاصر الشوف',array['maaser el chouf','m3aser el shouf','maasser']),
  ('outer','Khraibeh','الخريبة',array['khreibeh','5raybeh','kharibeh','khraibet ech chouf']),
  ('outer','Baadarane','بعذران',array['baadaran','ba3daran','baathran']),
  ('outer','Aammatour','عماطور',array['ammatour','3ammatour','amatour']),
  ('outer','Haret Jandal','حارة جندل',array['haret jandel','7aret jandal']),
  ('outer','Jbaa','جباع',array['jbaa ech chouf','jba3','jbaa el chouf']),
  ('outer','Mristi','مرستي',array['mresti','mristy']),
  ('outer','Niha','نيحا',array['niha ech chouf','ni7a']),
  ('outer','Ain Zhalta','عين زحلتا',array['ain zhalta','3ein z7alta','ainzhalta']),
  ('outer','Brih','بريح',array['breeh','bri7']),
  ('outer','Kfar Qatra','كفرقطرة',array['kfarkatra','kfar katra','kfar2atra']),
  ('outer','Wadi es Sitt','وادي الست',array['wadi el sit','wadi sitt']),
  ('outer','Serjbal','سرجبال',array['sirjbal','serjbel']),
  ('outer','Dmit','دميت',array['dmeet','dmit']),
  ('outer','Kfarnis','كفرنيس',array['kfar nis'])
) as v(zone, name_en, name_ar, aliases)
join zones z on z.name = v.zone
on conflict (name_en) do nothing;

insert into settings(key, value) values
  ('hub_seed_villages', '["Baakline","Baqaata"]')
on conflict (key) do update set value = excluded.value;
