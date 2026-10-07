# Places build report

Built 2026-10-07 by `.github/workflows/places-build.yml`.

- COD-AB: https://data.humdata.org/dataset/569beba7-bad7-4951-a19d-468a035461cd/resource/1d8198d3-8f50-405a-9534-6c131fe3d6d2/download/lbn_admin_boundaries.shp.zip
- OSM: https://overpass.kumi.systems/api/interpreter (1983 nodes, 2026-10-07T18:36:07Z)
- DEM: Copernicus GLO-30 (copernicus-dem-30m on AWS open data)

## Totals
what | n
zones without a place (snapping only) | 84
zones | 1610
places without an English name | 77
places without an Arabic name | 23
winter-risk places | 202
places with a parent | 650
places | 2172

## Places by kind
kind | count
village | 1765
neighbourhood | 197
hamlet | 110
town | 91
city | 9

## Places by district
district_code | count
AKR | 222
ALY | 93
BAB | 75
BAT | 83
BEY | 84
BLB | 151
BNJ | 45
BSH | 30
CHF | 175
HRM | 50
HSB | 36
JBL | 133
JZN | 85
KOR | 50
KSR | 93
MND | 74
MRJ | 41
MTN | 125
NBT | 62
RSH | 43
SAI | 106
TRP | 21
TYR | 101
WBQ | 45
ZGH | 71
ZHL | 78

## Review set (Gazetteer report): matches
?column?
166 of 176 matched

### Not matched
ref | review_name
AK-AKR-002 | Bebnine
AK-AKR-003 | Berkayel
BEY-009 | Karakol el-Druze
BH-BAL-003 | Chmestar
KJ-JBL-005 | Annaya (Kfar Baal)
ML-BBD-015 | Bzebdine
ML-CHF-023 | Kfarhim
ML-MTN-020 | Zaarour
NL-BAT-005 | Tannourine el-Faouqa
SL-TYR-002 | Abbassieh

### Matched more than 1 km away, or elevation off by more than 150 m
ref | review_name | id | distance_m | elevation_m | review_elevation
BEY-006 | Beirut Central District | LB-BEY-BEIRUT-CENTRAL-DISTRICT | 1794 | 1 | 15
BH-HER-002 | Al-Qaa | LB-BLB-QAA | 1490 | 668 | 690
BQ-ZAH-003 | Bar Elias | LB-ZHL-BAR-ELIAS | 1356 | 878 | 880
BQ-ZAH-004 | Saadnayel | LB-ZHL-SAADNAYEL | 1117 | 906 | 900
KJ-JBL-006 | Ehmej | LB-JBL-EHMEJ | 1810 | 1183 | 1180
KJ-JBL-008 | Aqoura | LB-JBL-AAQOURA | 1630 | 1377 | 1480
KJ-JBL-009 | Laqlouq | LB-JBL-LAQLOUQ | 1408 | 1795 | 1720
KJ-KES-004 | Zouk Mosbeh | LB-KSR-ZOUK-MOSBEH | 1529 | 184 | 90
KJ-KES-006 | Daraoun | LB-KSR-DARAOUN | 1160 | 549 | 640
KJ-KES-014 | Kfardebian | LB-KSR-KFARDEBIAN | 643 | 1643 | 1260
KJ-KES-015 | Faqra | LB-KSR-FAQRA | 1518 | 1724 | 1580
ML-ALY-005 | Bchamoun | LB-ALY-BESHAMOUN | 1278 | 444 | 320
ML-ALY-010 | Ain Dara | LB-ALY-AIN-DARA | 1991 | 1258 | 1310
ML-BBD-007 | Hadath | LB-BAB-HADATH | 1034 | 185 | 90
ML-BBD-009 | Wadi Chahrour el-Oulya | LB-BAB-OUADI-CHAHROUR-EL-AAOULIA | 1004 | 193 | 260
ML-BBD-010 | Jamhour | LB-BAB-JAMHOUR | 1500 | 360 | 320
ML-BBD-011 | Araya | LB-BAB-AARAIYA | 1165 | 558 | 480
ML-BBD-013 | Falougha | LB-BAB-FALOUGHA | 1078 | 1228 | 1260
ML-BBD-017 | Chouit | LB-BAB-CHOUIT | 2088 | 603 | 540
ML-BBD-019 | Betchay | LB-BAB-BUTSHAY | 1462 | 145 | 180
ML-BBD-020 | Bsaba | LB-BAB-BISABA | 1673 | 278 | 240
ML-CHF-003 | Baakline | LB-CHF-BAAKLINE | 2155 | 855 | 840
ML-CHF-004 | Bakaata | LB-CHF-BAKAATA | 1831 | 917 | 880
ML-CHF-005 | Jdeidet el-Chouf | LB-CHF-JDEIDET-EL-CHOUF | 1205 | 924 | 870
ML-CHF-006 | Semqanieh | LB-CHF-SEMQANIEH | 1275 | 896 | 890
ML-CHF-007 | Ain Wazein | LB-CHF-AIN-OUZAIN | 1459 | 995 | 960
ML-CHF-009 | Moukhtara | LB-CHF-MOUKHTARA | 2117 | 797 | 820
ML-CHF-010 | Amatour | LB-CHF-AMMATOUR | 1991 | 846 | 850
ML-CHF-011 | Baadaran | LB-CHF-BAADARAN | 2039 | 1054 | 1020
ML-CHF-014 | Bater | LB-CHF-BATER | 2726 | 836 | 820
ML-CHF-016 | Jbaa Chouf | LB-CHF-JBAA | 1494 | 1184 | 1180
ML-CHF-017 | Chhim | LB-CHF-SHAHIM | 1017 | 586 | 520
ML-CHF-019 | Ketermaya | LB-CHF-KETERMAYA | 2245 | 363 | 380
ML-CHF-020 | Mazboud | LB-CHF-MAZBOUD | 1791 | 417 | 460
ML-CHF-022 | Jiyeh | LB-CHF-JIEH | 2935 | 49 | 25
ML-CHF-024 | Kfar Nabrakh | LB-CHF-KFAR-NABRAKH | 2372 | 1050 | 980
ML-MTN-010 | Broummana | LB-MTN-BROUMANA | 1327 | 777 | 760
ML-MTN-011 | Baabdat | LB-MTN-BAABDAT | 1763 | 773 | 850
ML-MTN-018 | Ain Saadeh | LB-MTN-AIN-SAADEH | 1230 | 396 | 420
NA-BNT-004 | Rmeich | LB-BNJ-RMEISH | 1881 | 571 | 610
NA-HAS-002 | Chebaa | LB-HSB-SHEBAA | 2357 | 1220 | 1280
NA-MAR-003 | Meiss el-Jabal | LB-MRJ-MEISS-EJ-JABAL | 2946 | 633 | 710
NA-NAB-003 | Habbouch | LB-NBT-HABBOUSH | 2151 | 469 | 410
NL-BAT-003 | Hamat | LB-BAT-HAMAT | 1474 | 240 | 280
NL-BAT-004 | Douma | LB-BAT-DOUMA | 1566 | 1057 | 1020
NL-BSC-004 | Hasroun | LB-BSH-HASROUN | 1198 | 1403 | 1420
NL-BSC-005 | The Cedars (Al-Arz) | LB-BSH-THE-CEDARS | 1425 | 1847 | 1920
NL-KOU-002 | Kousba | LB-KOR-KOUSBA | 605 | 488 | 310
NL-KOU-003 | Bishmizzine | LB-KOR-BECHMIZZINE | 2191 | 278 | 280
NL-MIN-001 | Minieh | LB-MND-MINIYEH | 2217 | 19 | 35
NL-MIN-003 | Bakhoun | LB-MND-BAKHAOUN | 2048 | 588 | 820
NL-TRP-001 | Tripoli | LB-TRP-TRIPOLI | 1366 | 23 | 20
NL-ZGH-002 | Ehden | LB-ZGH-EHDEN | 1754 | 1445 | 1520
SL-JZZ-002 | Bkassine | LB-JZN-BKASSINE | 1213 | 802 | 840
SL-SID-003 | Maghdouche | LB-SAI-MAGHDOUCHEH | 1007 | 218 | 230

## Same name in the same district
district_code | coalesce | count
ZGH | Kfar Sghab | 2

## Same Arabic name in one district (separate villages more than 1.5 km apart)
id | other_id | name_ar | distance_m
LB-BAT-RACHKIDA | LB-BAT-RACHKIDDE | راشكيدا | 5455
LB-MTN-SFAILA | LB-MTN-SUFAYLA | سفيلة | 6684
LB-ZGH-KFAR-SGHAB | LB-ZGH-KFAR-SGHAB-KFARSGHAB | كفر صغاب | 8566
LB-AKR-AL-KANISA | LB-AKR-KNISSEH | الكنيسة | 11181
LB-MTN-AL-MASHRAH | LB-MTN-MACHRAA | المشرح | 11648
LB-TYR-AL-BAYAZ | LB-TYR-BIYAD | البياض | 13164
LB-CHF-BOUTMEH | LB-CHF-N5176838961 | بطمة | 17559
LB-AKR-EL-MAJDAL | LB-AKR-MAJDAL | المجدل | 17711
LB-AKR-KANISA | LB-AKR-KNISSEH | كنيسة | 29095
LB-AKR-AL-KANISA | LB-AKR-KANISA | الكنيسة | 38372

## Places made from a zone with no OSM place (review: real village or uninhabited land)
id | district_code | name_en | name_ar | elevation_m
LB-AKR-BARCHA | AKR | Barcha | برشا | 48
LB-AKR-BSATINE-AAKKAR | AKR | Bsatine Aakkar | فسقين و عين اشما | 449
LB-AKR-CHEIKH-TABA-ES-SAHL | AKR | Cheikh Taba Es-Sahl | الشيخ طابا السهل | 59
LB-AKR-DAHR-LAISSINE | AKR | Dahr Laissine | ضهر ليسينه | 559
LB-AKR-DAYRET-NAHR-EL-KABIR | AKR | Dayret Nahr El-Kabir | دائرة النهر الكبير | 264
LB-AKR-KAFR | AKR | Kafr | كفر الفتوح | 422
LB-AKR-KARM-AASFOUR | AKR | Karm Aasfour | كرم عصفور | 324
LB-AKR-KFAR-MELKI-AAKKAR | AKR | Kfar Melki Aakkar | كفرملكي | 26
LB-AKR-KHARNOUBET-AAKKAR | AKR | Kharnoubet Aakkar | الخرنوبه | 111
LB-AKR-KHIRBET-ER-REMMANE | AKR | Khirbet Er Remmane | خربة الرمان | 348
LB-AKR-KHREIBET-AAKKAR | AKR | Khreibet Aakkar | الخريبة | 740
LB-AKR-KNISSEH | AKR | Knisseh | كنيسة | 301
LB-AKR-MARLAYA-MELHEM | AKR | Marlaya Melhem | مار ليا ملحم | 48
LB-AKR-MAZRAAT-BEIT-GHATTAS | AKR | Mazraat Beit Ghattas | بيت غطاس | 162
LB-AKR-MAZRAAT-EN-NAHRIYEH | AKR | Mazraat En-Nahriyeh | النهريه | 519
LB-AKR-MZEIHMEH | AKR | Mzeihmeh | مزيحمة | 175
LB-AKR-QBOULA | AKR | Qboula | قبولا | 547
LB-AKR-SADAQA | AKR | Sadaqa | صدقة | 1054
LB-AKR-SEMMAQLI | AKR | Semmaqli | سمقالي | 31
LB-AKR-TALL-MEAAYAN-TALL-KIRI | AKR | Tall Meaayan Tall Kiri | تلمعيان | 17
LB-AKR-TALL-SEBAAL | AKR | Tall Sebaal | تل سبعل | 40
LB-AKR-ZOUARIB | AKR | Zouarib | الزواريب | 176
LB-AKR-ZOUQ-EL-HOSNIYEH | AKR | Zouq El Hosniyeh | ذوق الحصينة | 201
LB-ALY-BHAMDOUN-ED-DAYAA | ALY | Bhamdoun Ed-Dayaa | بحمدون الضيعة | 1117
LB-ALY-CHOUEIFAT-EL-OUMARA | ALY | Choueifat El-Oumara | الشويفات الامراء | 20
LB-ALY-CHOUEIFAT-EL-QUOUBBEH | ALY | Choueifat El-Quoubbeh | قبة الشويفات | 103
LB-ALY-HOMS-OUA-HAMA | ALY | Homs Oua Hama | حمص وحمى | 661
LB-BAB-HARET-ES-SIT | BAB | Haret Es-Sit | حارة الست | 360
LB-BAB-OUADI-CHAHROUR-EL-AAOULIA | BAB | Ouadi Chahrour El Aaoulia | وادي شحرور العليا | 193
LB-BAB-TAHOUITAT-EL-GHADIR | BAB | Tahouitat El Ghadir | تحويطة الغدير | 16
LB-BAT-AARTIZ | BAT | Aartiz | عرطز | 459
LB-BAT-DAAEL | BAT | Daael | داعل | 561
LB-BAT-DEIR-KFIFANE | BAT | Deir Kfifane | دير كفيفان | 432
LB-BAT-DEIR-MAR-YOUHANNA-EL-BATROUN | BAT | Deir Mar Youhanna EL-Batroun | دير مار يوحنا دوما | 756
LB-BAT-DEIR-MAR-YOUSSEF-JRABTA | BAT | Deir Mar Youssef Jrabta | دير مار يوسف جربتا | 342
LB-BAT-JEBLA | BAT | Jebla | جبلا | 538
LB-BAT-KFAR-KHOLLOS | BAT | Kfar Khollos | كفر خلص | 186
LB-BAT-NAHLEH-EL-BATROUN | BAT | Nahleh El-Batroun | نحلا البترون | 842
LB-BAT-OUAJH-EL-HAJJAR | BAT | Ouajh El-Hajjar | وجه الحجر | 199
LB-BAT-QATNAAOUN | BAT | Qatnaaoun | قرنعون | 153
LB-BEY-BEIRUT-CENTRAL-DISTRICT | BEY | Beirut Central District | وسط بيروت | 1
LB-BLB-AAIN-ES-SIYAA-CHADOURA | BLB | Aain Es-Siyaa Chadoura | حصن الشادورا | 1967
LB-BLB-AAMCHKI | BLB | Aamchki | عمشكي | 1893
LB-BLB-CHAAIBEH | BLB | Chaaibeh | جبل الشعيبة | 1845
LB-BLB-DEIR-MAR-MAROUN-BAALBEK | BLB | Deir Mar Maroun Baalbek | دير مار مارون بعلبك | 714
LB-BLB-HAOUCH-EL-DEHAB | BLB | Haouch El-Dehab | حوش الدهب | 1001
LB-BLB-MAZRAAT-BEIT-MCHAIK | BLB | Mazraat beit Mchaik | مزرعة بيت مشيك | 1775
LB-BLB-MOUSRAYEH | BLB | Mousrayeh | مطحنة مصراية | 982
LB-BLB-OUADI-EL-AAOSS | BLB | Ouadi El-Aaoss | وادي القصص | 1635
LB-BLB-QAA-BAAYOUN | BLB | Qaa Baayoun | قاع بعيون | 721
LB-BLB-QAA-JOUAR-MAQIYE | BLB | Qaa Jouar Maqiyé | قاع جوار مكية | 583
LB-BLB-QAA-OUADI-EL-KHANZIR | BLB | Qaa Ouadi El-Khanzir | قاع وادي الخنزير | 640
LB-BLB-RAS-BAALBEK-ECH-CHARQI | BLB | Ras Baalbek Ech-Charqi | راس بعلبك الشرقي | 1326
LB-BLB-SLOUQI | BLB | Slouqi | سلوقي | 2310
LB-BNJ-KAFRA-BANT-JBAYL | BNJ | Kafra Bant Jbayl | كفرا بنت جبيل | 591
LB-BSH-MAZRAAT-AASSAF | BSH | Mazraat Aassaf | مزرعة عساف | 1007
LB-BSH-MCHAA-EJ-JIBBE | BSH | Mchaa Ej-Jibbé | مشاع الجبه | 2447
LB-BSH-OUADI-QANNOUBINE | BSH | Ouadi Qannoubine | وادي قنوبين | 743
LB-CHF-BENOUATI-ECH-CHOUF | CHF | Benouati Ech-Chouf | بنواتي | 407
LB-CHF-BKECHTINE-OUEL-MCHEIAA | CHF | Bkechtine Ouel Mcheiaa | بكشتين | 601
LB-CHF-BQAIAA-ECH-CHOUF | CHF | Bqaiaa Ech-Chouf | بقيعة | 242
LB-CHF-CHMAARINE | CHF | Chmaarine | شمعرين | 385
LB-CHF-GHABET-JAAFAR | CHF | GHabet Jaafar | غابة جعفر | 654
LB-CHF-KFAR-HAY | CHF | Kfar hay | كفر حي | 534
LB-CHF-MOUGHAYRET-ECH-CHOUF | CHF | Moughayret Ech-Chouf | مغيره | 208
LB-CHF-OUADI-ABOU-YOUSSEF | CHF | Ouadi Abou Youssef | وادي ابو يوسف | 351
LB-CHF-OUADI-BNEHLAY | CHF | Ouadi bnehlay | وادي بنحليه | 467
LB-CHF-OUADI-ED-DEIR | CHF | Ouadi Ed-Deir | وادي الدير | 382
LB-HRM-HERMEL-JBAB | HRM | Hermel Jbab | هرمل جباب | 1869
LB-HRM-MICHAA-MRAJHINEH | HRM | Michaa Mrajhineh | سويدية | 1741
LB-HRM-OUADI-FAARA | HRM | Ouadi Faara | وادي فعرا | 1592
LB-HRM-RAS-BAALBEK-EL-GHARBI | HRM | Ras Baalbek El Gharbi | راس بعلبك الغربي | 1801
LB-HRM-RAS-BAALBEK-OUADI-FAARA | HRM | Ras Baalbek Ouadi Faara | راس بعلبك وادي فعرا | 876
LB-JBL-AARAB-EL-LAHIB | JBL | Aarab El-Lahib | عرب اللهيب | 1957
LB-JBL-AARASTA | JBL | Aarasta | عرستا | 1031
LB-JBL-HEMA-ER-REHBAN | JBL | Hema Er-Rehban | حمى الرهبان | 1711
LB-JBL-HEMA-MAR-MAROUN-AANNAYA | JBL | Hema Mar Maroun Aannaya | حمى مار مارون عنَايا | 1618
LB-JBL-JOURET-EL-QATTINE | JBL | Jouret El-Qattine | جورة القطين | 741
LB-JBL-MAZRAAT-EL-MAADEN | JBL | Mazraat El-Maaden | مزرعة المعادن | 1151
LB-JBL-SAQIET-EL-KHAYT | JBL | Saqiet El-Khayt | ساقية الخيط | 582
LB-JBL-TADMOR | JBL | Tadmor | تدمر | 1389
LB-JZN-BEHBEH | JZN | Behbeh | بيبه | 705
LB-JZN-DAHR-ED-DEIR | JZN | Dahr Ed-Deir | ضهر الدير | 536
LB-JZN-DEIR-EL-QATTINE | JZN | Deir El Qattine | دير قطِين | 711
LB-JZN-DEMACHQIYEH | JZN | Demachqiyeh | دمشقية | 404
LB-JZN-JABAL-TOURA | JZN | Jabal Toura | جبل طوره | 1299
LB-JZN-MACHMOUCHEH | JZN | Machmoucheh | مشموشة | 934
LB-JZN-MARAAT-OUAZAIYEH | JZN | Maraat Ouazaiyeh | اوزاعية | 444
LB-JZN-MAZRAAT | JZN | Mazraat | مزرعة عقماتا | 921
LB-JZN-MAZRAAT-DARAYA | JZN | Mazraat Daraya | داريا جزين | 942
LB-JZN-MAZRAAT-ER-ROUHBANE | JZN | Mazraat Er-Rouhbane | مزرعة الرهبان | 1295
LB-JZN-MAZRAAT-KHALLET-KHAZEN | JZN | Mazraat Khallet Khazen | خلة خازن | 767
LB-JZN-MAZRAAT-LOUZID-LOUAYZIYEH | JZN | Mazraat Louzid (Louayziyeh) | مزرعة لوزيد | 670
LB-JZN-MAZRAAT-QROUH | JZN | Mazraat Qrouh | قروح | 739
LB-JZN-MAZRAAT-TAMRA | JZN | Mazraat Tamra | مزرعة طمره | 260
LB-JZN-MAZRAAT-ZIGHRINE-JEZZINE | JZN | Mazraat Zighrine Jezzine | زغرين جزين | 807
LB-JZN-MIDANE-JEZZINE | JZN | Midane Jezzine | ميدان | 715
LB-JZN-QABAA-JEZZINE | JZN | Qabaa Jezzine | قبع | 977
LB-JZN-QTALEH-JEZZINE | JZN | Qtaleh Jezzine | قتالة جزين | 360
LB-JZN-RIHANE-JEZZINE | JZN | Rihane Jezzine | ريحانة جزين | 956
LB-JZN-ROUMMANET | JZN | Roummanet | رمانة | 1238
LB-JZN-WADI-JEZZINE | JZN | Wadi Jezzine | وادي جزين | 768
LB-KOR-BQAIAA-EL-KOURA | KOR | Bqaiaa El-Koura | البقيعة | 177
LB-KOR-ZGHARTA-EL-MTAOUILE | KOR | Zgharta El-Mtaouile | زغرتا المتاولة | 594
LB-KSR-BEQAATA-AACHQOUT | KSR | Beqaata Aachqout | بقعاتة عشقوت | 1266
LB-KSR-BQAQ-ED-DINE | KSR | Bqaq Ed-Dine | بقاق الدين | 69
LB-KSR-CHOUANE | KSR | Chouane | شوان | 802
LB-KSR-DEIR-BAQLOUCH | KSR | Deir Baqlouch | دير بقلوش | 373
LB-KSR-KFAR-TAY-KESROUANE | KSR | Kfar Tay Kesrouane | دير زرعيا | 1003
LB-KSR-KHARAYEB-NAHR-IBRAHIM | KSR | Kharayeb Nahr Ibrahim | زاير | 20
LB-KSR-MAZRAAT-ER-RAS | KSR | Mazraat Er-Ras | مزرعة الراس | 323
LB-KSR-MCHAA-EL-FTOUH | KSR | Mchaa El Ftouh | مشاع الفتوح | 1948
LB-KSR-MCHAA-FARAYA | KSR | Mchaa Faraya | مشاع فاريا | 1895
LB-KSR-MCHAA-KFAR-DIBIANE | KSR | Mchaa Kfar Dibiane | مشاع كفر ذبيان | 2312
LB-MND-AAIN-ET-TINEH-MINIYEH | MND | Aain Et-Tineh-Miniyeh | عين التينه المنيه | 878
LB-MND-BECHEHHARA | MND | Bechehhara | بشحارة | 654
LB-MND-BECHNNATA | MND | Bechnnata | بشناتا | 1656
LB-MND-BEIT-HAOUIK | MND | Beit Haouik | بيت حاويك | 847
LB-MND-HAZMIYET-MINIYEH | MND | Hazmiyet-Miniyeh | حازمية المنيه | 714
LB-MND-JARJOUR | MND | Jarjour | جرجور | 651
LB-MND-KHARROUB-MINIYEH | MND | Kharroub-Miniyeh | خرنوب المنيه | 746
LB-MND-MAZRAAT-EL-KREME | MND | Mazraat El-Kreme | مزرعة الكريم | 887
LB-MND-MAZRAAT-KETRANE | MND | Mazraat Ketrane | مزرعة كتران | 1047
LB-MND-MRAH-ES-SFIRE | MND | Mrah Es-Sfire | مراح السفيرة | 790
LB-MND-MREBBINE | MND | Mrebbine | مربين | 2094
LB-MND-NABI-YOUCHEAA | MND | Nabi Youcheaa | النبي يوشع | 75
LB-MND-RAOUDA-AADOUA | MND | Raouda-Aadoua | روضه المنيه | 214
LB-MRJ-BLAT-MARJAAYOUN | MRJ | Blat Marjaayoun | بلاط مرجعيون | 731
LB-MRJ-BOUEYDA-MARJAAYOUN | MRJ | Boueyda Marjaayoun | بويضة مرجعيون | 468
LB-MRJ-MAZRAAT-DOUMIAT | MRJ | Mazraat Doumiat | مزرعة دمياط | 299
LB-MRJ-TAYBET-MATJAAYOUN | MRJ | Taybet Matjaayoun | طيبة مرجعيون | 559
LB-MTN-CHAOUIYEH | MTN | Chaouiyeh | شاوية | 552
LB-MTN-KFAR-TAY-EL-MATN | MTN | Kfar Tay El-Matn | كفرتيه | 1663
LB-MTN-MHAIDSET-MATN | MTN | Mhaidset Matn | محيدثة المتن | 908
LB-MTN-MZAKKEH | MTN | Mzakkeh | مزكة | 836
LB-NBT-MAZRAAT-BSAFFOUR | NBT | Mazraat Bsaffour | مزرعة بصفُور | 308
LB-NBT-MAZRAAT-CHALBAAL | NBT | Mazraat Chalbaal | مزرعة شلبعل | 365
LB-NBT-MAZRAAT-DMOUL | NBT | Mazraat Dmoul | مزرعة دمول | 300
LB-NBT-MAZRAAT-QALAAT-EL-MEIS | NBT | Mazraat Qalaat El-Meis | مزرعة قلعة ميس | 254
LB-RSH-NABI-SAFA | RSH | Nabi Safa | نبي صفا | 1242
LB-RSH-SELSATA-MAZRAAT-DEIR-EL-AACHAIYER | RSH | Selsata (Mazraat Deir El-Aachaiyer) | مزرعة سلساتا | 1525
LB-SAI-HARTIYEH | SAI | Hartiyeh | حارتية | 144
LB-SAI-JAZIRA-SAIDA | SAI | Jazira Saida | جزيرة صيدا | 6
LB-SAI-KFAR-MELKI-SAIDA | SAI | Kfar Melki Saida | كفرملكي صيدا | 378
LB-SAI-KHIRBET-ED-DOUAIR-SAIDA | SAI | Khirbet Ed-Douair Saida | خربة الدوير صيدا | 155
LB-SAI-KHIRBET-EL-BASSAL | SAI | Khirbet El-Bassal | خربة البصل | 262
LB-SAI-MAZRAAT-EL-HOUSSAINIYEH | SAI | Mazraat El-Houssainiyeh | مزرعة الحسينية | 70
LB-SAI-MAZRAAT-EL-YAHOUDIYEH-AAITANIYEH | SAI | Mazraat El Yahoudiyeh (Aaitaniyeh) | مزرعة العيتانية | 10
LB-SAI-MAZRAAT-JAMJIM | SAI | Mazraat Jamjim | مزرعة جمجيم | 140
LB-SAI-MAZRAAT-OUSSAMIYAT | SAI | Mazraat Oussamiyat | الاوساميات | 145
LB-SAI-MAZRAAT-SNAIBER | SAI | Mazraat 'Snaiber | مزرعة سنيبر | 100
LB-SAI-MZARAAT-EL-OUASTA | SAI | Mzaraat El-Ouasta | مزرعة الواسطة | 62
LB-SAI-QAAQAIYET-ES-SNAOUBAR | SAI | Qaaqaiyet Es-Snaoubar | قعقعية الصنوبر | 181
LB-SAI-SAIDA-EL-OUSTANI | SAI | Saida El-Oustani | الوسطاني | 13
LB-TRP-MINA-JARDIN | TRP | Mina Jardin | بساتين المينا | 5
LB-TRP-MINA-N-1 | TRP | Mina N:1 | مينا طرابلس 1 | 10
LB-TRP-TRABLOUS-EL-HADDADINE-EL-HADID-EL-MHARTA | TRP | Trablous El-Haddadine, El-Hadid, El-Mharta | الحدادين | 25
LB-TRP-TRABLOUS-EL-HADID | TRP | Trablous El Hadid | الحديد | 25
LB-TRP-TRABLOUS-EL-MHATRA | TRP | Trablous El Mhatra | المهاترة | 43
LB-TRP-TRABLOUS-EN-NOURI | TRP | Trablous En-Nouri | النوري | 19
LB-TRP-TRABLOUS-ER-REMMANEH | TRP | Trablous Er-Remmaneh | الرمانة | 28
LB-TRP-TRABLOUS-ES-SOUAYQA | TRP | Trablous Es-Souayqa | السويقة | 59
LB-TRP-TRABLOUS-ET-TABBANEH | TRP | Trablous et Tabbaneh | التبانة | 21
LB-TRP-TRABLOUS-ET-TELL | TRP | Trablous Et-Tell | التل | 17
LB-TRP-TRABLOUS-JARDINS | TRP | Trablous jardins | بساتين طرابلس | 6
LB-TYR-AAIYEH | TYR | Aaiyeh | مزرعة عيا | 398
LB-TYR-AAZIYEH | TYR | Aaziyeh | عزِّيه | 217
LB-TYR-MARNBA | TYR | Marnba | مرنبا | 191
LB-TYR-MAZRAAT-TAYR-SEMHAT | TYR | Mazraat Tayr Semhat | طير سمحات | 296
LB-TYR-MHEILIB | TYR | Mheilib | محيليب | 19
LB-WBQ-DEIR-AAIN-EJ-JAOUZEH | WBQ | Deir Aain Ej-Jaouzeh | دير عين الجوزة | 852
LB-WBQ-HARIMEH-ES-SOUGHRA | WBQ | Harimeh Es-Soughra | حريمة الصغرى | 871
LB-WBQ-JAZIRA-BG | WBQ | Jazira BG | الجزيرة | 865
LB-WBQ-KHIARA-EL-AATIQA | WBQ | Khiara El-Aatiqa | خيارة العتيقة | 864
LB-WBQ-OUAQF-BG | WBQ | Ouaqf BG | الوقف بقاع الغربي | 865
LB-WBQ-SOLTAN-YACOUB-EL-ARADI | WBQ | Soltan Yacoub el Aradi | سلطان يعقوب أراضي | 1049
LB-ZGH-AINTOURINE | ZGH | Aintourine | عينطورين | 1246
LB-ZGH-DANHA | ZGH | Danha | دنها | 173
LB-ZGH-HARIQ-ZGHARTA | ZGH | Hariq Zgharta | حريق زغرتا | 178
LB-ZGH-HOUAKIR | ZGH | Houakir | حواكير | 390
LB-ZGH-MAZRAAT-AJBEAA | ZGH | Mazraat Ajbeaa | مزرعة إجبع | 141
LB-ZGH-QARAH-BACH | ZGH | Qarah Bach | قره باش | 115
LB-ZHL-CHEBRQIYET-TABET | ZHL | Chebrqiyet Tabet | شبرقية تابت | 870
LB-ZHL-HAOUCH-EL-AAMARA | ZHL | Haouch El-Aamara | تل العمارة | 913
LB-ZHL-HAOUCH-ES-SIYADEH | ZHL | Haouch Es-Siyadeh | حوش الصيادي | 869
LB-ZHL-HAOUCH-MANDARA | ZHL | Haouch Mandara | حوش مندره | 870
LB-ZHL-HAOUCH-QAYSSAR | ZHL | Haouch Qayssar | قيصر | 870
LB-ZHL-MAZRAAT-ER-REMTANIYEH | ZHL | Mazraat Er-Remtaniyeh | الرمطانية | 1503
LB-ZHL-MZARAAT-ZAHLEH | ZHL | Mzaraat Zahleh | مزرعة زحلة | 930
LB-ZHL-NASRIYET-ZAHLEH | ZHL | Nasriyet Zahleh | ناصرية زحلة | 865
LB-ZHL-OUADI-EL-AARAYECH | ZHL | Ouadi El-Aarayech | وادي العرايش | 1334
LB-ZHL-TCHEFLIK-EDDE-HAOUCH | ZHL | Tcheflik Eddé Haouch | تشفلك اده حوش | 869
LB-ZHL-TCHEFLIK-QIQANO | ZHL | Tcheflik Qiqano | تشفلك قيقانو | 866
LB-ZHL-ZAHLE-HAOUCH-EL-OUMARA-ARADI | ZHL | Zahlé Haouch El-Oumara Aradi | زحلة حوش الامراء أراضي | 877
LB-ZHL-ZAHLEH-ARADI | ZHL | Zahleh Aradi | زحلة أراضي | 1140
LB-ZHL-ZAHLEH-EL-BERBARA | ZHL | Zahleh El-Berbara | بربارة زحلة | 1010
LB-ZHL-ZAHLEH-EL-MAALLAQA | ZHL | Zahleh El-Maallaqa | زحلة معلقة أراضي | 947
LB-ZHL-ZAHLEH-ER-RASSIYEH | ZHL | Zahleh Er-Rassiyeh | الراسية | 977
LB-ZHL-ZAHLEH-HAOUCH-EZ-ZARAANE | ZHL | Zahleh Haouch Ez-Zaraane | حوش الزراعنة | 970
LB-ZHL-ZAHLEH-MAALLAQA-ARADI | ZHL | Zahleh Maallaqa Aradi | مدينة الصناعية | 886
LB-ZHL-ZAHLE-MAR-ANTONIOS | ZHL | Zahlé Mar Antonios | زحلة مار أنطونيوس | 989
LB-ZHL-ZAHLE-MAR-ELIAS | ZHL | Zahlé Mar Elias | مار الياس زحلة | 1008
LB-ZHL-ZAHLE-MAR-GERGES | ZHL | Zahlé Mar Gerges | زحلة مار جرجس | 960

## Zones without a place (first 400)
pcode | district_code | name_en | name_ar | elevation_min_m | elevation_max_m
35125 | AKR | Jdidet Ej-Joumeh | جديدة الجومه |  | 
35002 | AKR | Litige |  |  | 
35003 | AKR | Litige |  |  | 
35001 | AKR | Litige |  |  | 
35173 | AKR | Tallet Chattaha | شطاحة |  | 
24005 | ALY | Litige |  |  | 
24009 | ALY | Litige |  |  | 
24008 | ALY | Litige |  |  | 
24007 | ALY | Litige |  |  | 
24002 | ALY | Litige |  |  | 
24003 | ALY | Litige |  |  | 
24004 | ALY | Litige |  |  | 
24006 | ALY | Litige |  |  | 
24001 | ALY | Litige |  |  | 
24474 | ALY | Mazraat En-Nahr Aaley | مزرعة النهر |  | 
21133 | BAB | Furn Ech-Chebbak | فرن الشباك |  | 
34321 | BAT | Beit Chlala | بيت شلالا |  | 
34215 | BAT | Daraya El-Batroun | دريا |  | 
34002 | BAT | Litige |  |  | 
34001 | BAT | Litige |  |  | 
53127 | BLB | Aadous | عدّوس |  | 
53002 | BLB | Litige | حوارته |  | 
53003 | BLB | Litige |  |  | 
54003 | BLB | Litige |  |  | 
53001 | BLB | Litige |  |  | 
72175 | BNJ | Qatmoun | قطموم |  | 
23005 | CHF | Litige |  |  | 
23007 | CHF | Litige |  |  | 
23003 | CHF | Litige |  |  | 
23004 | CHF | Litige |  |  | 
23002 | CHF | Litige |  |  | 
23006 | CHF | Litige |  |  | 
23001 | CHF | Litige |  |  | 
54002 | HRM | Litige |  |  | 
54001 | HRM | Litige |  |  | 
26337 | JBL | Ghabat | غابات |  | 
26007 | JBL | Litige |  |  | 
26009 | JBL | Litige |  |  | 
26001 | JBL | Litige |  |  | 
26002 | JBL | Litige |  |  | 
26003 | JBL | Litige |  |  | 
26004 | JBL | Litige |  |  | 
63141 | JZN | Ghabbatiyeh | غبَاطية |  | 
63002 | JZN | Litige |  |  | 
63003 | JZN | Litige |  |  | 
63001 | JZN | Litige |  |  | 
32135 | KOR | Ain Aakrine | عين عكرين |  | 
32163 | KOR | Barghoun | برغون |  | 
25171 | KSR | Aaqaibeh Kesrouane | عقيبة |  | 
25002 | KSR | Litige |  |  | 
25001 | KSR | Litige |  |  | 
26008 | KSR | Litige |  |  | 
25003 | KSR | Litige |  |  | 
37362 | MND | Aasaymout | عصيموت |  | 
37006 | MND | Litige |  |  | 
37001 | MND | Litige |  |  | 
37002 | MND | Litige |  |  | 
37003 | MND | Litige |  |  | 
37004 | MND | Litige |  |  | 
37005 | MND | Litige |  |  | 
22439 | MTN | Bsalim | بصاليم |  | 
22375 | MTN | Dbayeh | ضبية |  | 
22002 | MTN | Litige |  |  | 
22001 | MTN | Litige |  |  | 
22391 | MTN | Mazraat Deir Aaoukar | مزرعة دير عوكر |  | 
55006 | RSH | Litige |  |  | 
55001 | RSH | Litige |  |  | 
55003 | RSH | Litige |  |  | 
55004 | RSH | Litige |  |  | 
55005 | RSH | Litige |  |  | 
55007 | RSH | Litige |  |  | 
55008 | RSH | Litige |  |  | 
55009 | RSH | Litige |  |  | 
61001 | SAI | Litige |  |  | 
61429 | SAI | Mazraat Sari | ساري |  | 
61115 | SAI | Saida El-Qadimeh | صيدا |  | 
31181 | TRP | Mina N:3 | المينا |  | 
31151 | TRP | Trablous El-Qobbe | القبة |  | 
52003 | WBQ | Litige |  |  | 
52002 | WBQ | Litige |  |  | 
33135 | ZGH | Mazraat Jnaid | مزرعة جنيد |  | 
33271 | ZGH | Miriata | مرياطا |  | 
51184 | ZHL | Ksara | كسارة |  | 
51001 | ZHL | Litige |  |  | 
