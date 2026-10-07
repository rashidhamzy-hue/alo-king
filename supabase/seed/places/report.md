# Places build report

Built 2026-10-07 by `.github/workflows/places-build.yml`.

- COD-AB: https://data.humdata.org/dataset/569beba7-bad7-4951-a19d-468a035461cd/resource/1d8198d3-8f50-405a-9534-6c131fe3d6d2/download/lbn_admin_boundaries.shp.zip
- OSM: https://overpass.private.coffee/api/interpreter (1983 nodes, 2026-10-07T16:32:50Z)
- DEM: Copernicus GLO-30 (copernicus-dem-30m on AWS open data)

## Totals
what | n
zones without a place (snapping only) | 1
zones | 1610
places without an English name | 77
places without an Arabic name | 86
places | 2268
places with a parent | 664
winter-risk places | 227

## Places by kind
kind | count
village | 1855
neighbourhood | 202
hamlet | 110
town | 91
city | 10

## Places by district
district_code | count
AKR | 227
ALY | 102
BAB | 76
BAT | 87
BEY | 89
BLB | 157
BNJ | 46
BSH | 30
CHF | 182
HRM | 52
HSB | 36
JBL | 142
JZN | 90
KOR | 52
KSR | 98
MND | 82
MRJ | 41
MTN | 130
NBT | 62
RSH | 52
SAI | 109
TRP | 24
TYR | 101
WBQ | 48
ZGH | 73
ZHL | 80

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
ML-ALY-004 | Aramoun (Dawha) | LB-ALY-DAWHA-ARAMOUN | 1925 | 416 | 280
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
ML-CHF-005 | Jdeidet el-Chouf | LB-CHF-JDEIDET-ECH-CHOUF | 1205 | 924 | 870
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
NL-ZGH-002 | Ehden | LB-ZGH-EHDEN | 1754 | 1445 | 1520
SL-JZZ-002 | Bkassine | LB-JZN-BKASSINE | 1213 | 802 | 840
SL-SID-003 | Maghdouche | LB-SAI-MAGHDOUCHEH | 1007 | 218 | 230

## Same name in the same district
district_code | coalesce | count
ALY | Litige | 9
RSH | Litige | 9
JBL | Litige | 8
CHF | Litige | 7
MND | Litige | 6
BLB | Litige | 4
KSR | Litige | 4
AKR | Litige | 3
JZN | Litige | 3
WBQ | Litige | 3
BAT | Beit Chlala | 2
BAT | Litige | 2
BEY | Achrafieh | 2
BEY | Ras Beirut | 2
BNJ | Qatmoun | 2
HRM | Litige | 2
JBL | Ghabat | 2
KOR | Barghoun | 2
MND | Aasaymout | 2
MTN | Dbayeh | 2
MTN | Litige | 2
MTN | Mar Boutros Karm Et Tine | 2
TRP | Tripoli | 2
ZGH | Kfar Sghab | 2
ZGH | Mazraat Jnaid | 2
ZHL | Ksara | 2

## Places made from a zone with no OSM place (review: real village or uninhabited land)
id | district_code | name_en | name_ar | elevation_m
LB-AKR-BARCHA | AKR | Barcha | برشا | 48
LB-AKR-BSATINE-AAKKAR | AKR | Bsatine Aakkar | فسقين و عين اشما | 449
LB-AKR-CHEIKH-TABA-ES-SAHL | AKR | Cheikh Taba Es-Sahl | الشيخ طابا السهل | 59
LB-AKR-DAHR-LAISSINE | AKR | Dahr Laissine | ضهر ليسينه | 559
LB-AKR-DAYRET-NAHR-EL-KABIR | AKR | Dayret Nahr El-Kabir | دائرة النهر الكبير | 264
LB-AKR-JDIDET-EJ-JOUMEH | AKR | Jdidet Ej-Joumeh | جديدة الجومه | 89
LB-AKR-KAFR | AKR | Kafr | كفر الفتوح | 422
LB-AKR-KARM-AASFOUR | AKR | Karm Aasfour | كرم عصفور | 324
LB-AKR-KFAR-MELKI-AAKKAR | AKR | Kfar Melki Aakkar | كفرملكي | 26
LB-AKR-KHARNOUBET-AAKKAR | AKR | Kharnoubet Aakkar | الخرنوبه | 111
LB-AKR-KHIRBET-ER-REMMANE | AKR | Khirbet Er Remmane | خربة الرمان | 348
LB-AKR-KHREIBET-AAKKAR | AKR | Khreibet Aakkar | الخريبة | 740
LB-AKR-KNISSEH | AKR | Knisseh | كنيسة | 301
LB-AKR-LITIGE | AKR | Litige |  | 37
LB-AKR-LITIGE-LITIGE | AKR | Litige |  | 1639
LB-AKR-LITIGE-LITIGE-P2093 | AKR | Litige |  | 1620
LB-AKR-MARLAYA-MELHEM | AKR | Marlaya Melhem | مار ليا ملحم | 48
LB-AKR-MAZRAAT-BEIT-GHATTAS | AKR | Mazraat Beit Ghattas | بيت غطاس | 162
LB-AKR-MAZRAAT-EN-NAHRIYEH | AKR | Mazraat En-Nahriyeh | النهريه | 519
LB-AKR-MZEIHMEH | AKR | Mzeihmeh | مزيحمة | 175
LB-AKR-QBOULA | AKR | Qboula | قبولا | 547
LB-AKR-SADAQA | AKR | Sadaqa | صدقة | 1054
LB-AKR-SEMMAQLI | AKR | Semmaqli | سمقالي | 31
LB-AKR-TALLET-CHATTAHA | AKR | Tallet Chattaha | شطاحة | 514
LB-AKR-TALL-MEAAYAN-TALL-KIRI | AKR | Tall Meaayan Tall Kiri | تلمعيان | 17
LB-AKR-TALL-SEBAAL | AKR | Tall Sebaal | تل سبعل | 40
LB-AKR-ZOUARIB | AKR | Zouarib | الزواريب | 176
LB-AKR-ZOUQ-EL-HOSNIYEH | AKR | Zouq El Hosniyeh | ذوق الحصينة | 201
LB-ALY-BHAMDOUN-ED-DAYAA | ALY | Bhamdoun Ed-Dayaa | بحمدون الضيعة | 1117
LB-ALY-CHOUEIFAT-EL-OUMARA | ALY | Choueifat El-Oumara | الشويفات الامراء | 20
LB-ALY-CHOUEIFAT-EL-QUOUBBEH | ALY | Choueifat El-Quoubbeh | قبة الشويفات | 103
LB-ALY-HOMS-OUA-HAMA | ALY | Homs Oua Hama | حمص وحمى | 661
LB-ALY-LITIGE | ALY | Litige |  | 798
LB-ALY-LITIGE-LITIGE | ALY | Litige |  | 795
LB-ALY-LITIGE-LITIGE-P2008 | ALY | Litige |  | 887
LB-ALY-LITIGE-LITIGE-P2009 | ALY | Litige |  | 710
LB-ALY-LITIGE-LITIGE-P2010 | ALY | Litige |  | 495
LB-ALY-LITIGE-LITIGE-P2011 | ALY | Litige |  | 489
LB-ALY-LITIGE-LITIGE-P2012 | ALY | Litige |  | 372
LB-ALY-LITIGE-LITIGE-P2013 | ALY | Litige |  | 907
LB-ALY-LITIGE-LITIGE-P2014 | ALY | Litige |  | 276
LB-ALY-MAZRAAT-EN-NAHR-AALEY | ALY | Mazraat En-Nahr Aaley | مزرعة النهر | 504
LB-BAB-FURN-ECH-CHEBBAK | BAB | Furn Ech-Chebbak | فرن الشباك | 18
LB-BAB-HARET-ES-SIT | BAB | Haret Es-Sit | حارة الست | 360
LB-BAB-OUADI-CHAHROUR-EL-AAOULIA | BAB | Ouadi Chahrour El Aaoulia | وادي شحرور العليا | 193
LB-BAB-TAHOUITAT-EL-GHADIR | BAB | Tahouitat El Ghadir | تحويطة الغدير | 16
LB-BAT-AARTIZ | BAT | Aartiz | عرطز | 459
LB-BAT-BEIT-CHLALA | BAT | Beit Chlala | بيت شلالا | 638
LB-BAT-DAAEL | BAT | Daael | داعل | 561
LB-BAT-DARAYA-EL-BATROUN | BAT | Daraya El-Batroun | دريا | 506
LB-BAT-DEIR-KFIFANE | BAT | Deir Kfifane | دير كفيفان | 432
LB-BAT-DEIR-MAR-YOUHANNA-EL-BATROUN | BAT | Deir Mar Youhanna EL-Batroun | دير مار يوحنا دوما | 756
LB-BAT-DEIR-MAR-YOUSSEF-JRABTA | BAT | Deir Mar Youssef Jrabta | دير مار يوسف جربتا | 342
LB-BAT-JEBLA | BAT | Jebla | جبلا | 538
LB-BAT-KFAR-KHOLLOS | BAT | Kfar Khollos | كفر خلص | 186
LB-BAT-LITIGE | BAT | Litige |  | 173
LB-BAT-LITIGE-LITIGE | BAT | Litige |  | 345
LB-BAT-NAHLEH-EL-BATROUN | BAT | Nahleh El-Batroun | نحلا البترون | 842
LB-BAT-OUAJH-EL-HAJJAR | BAT | Ouajh El-Hajjar | وجه الحجر | 199
LB-BAT-QATNAAOUN | BAT | Qatnaaoun | قرنعون | 153
LB-BEY-BEIRUT-CENTRAL-DISTRICT | BEY | Beirut Central District | وسط بيروت | 1
LB-BLB-AADOUS | BLB | Aadous | عدّوس | 1031
LB-BLB-AAIN-ES-SIYAA-CHADOURA | BLB | Aain Es-Siyaa Chadoura | حصن الشادورا | 1967
LB-BLB-AAMCHKI | BLB | Aamchki | عمشكي | 1893
LB-BLB-CHAAIBEH | BLB | Chaaibeh | جبل الشعيبة | 1845
LB-BLB-DEIR-MAR-MAROUN-BAALBEK | BLB | Deir Mar Maroun Baalbek | دير مار مارون بعلبك | 714
LB-BLB-HAOUCH-EL-DEHAB | BLB | Haouch El-Dehab | حوش الدهب | 1001
LB-BLB-JEBAA | BLB | Jebaa | جبعا | 1177
LB-BLB-LITIGE | BLB | Litige |  | 1438
LB-BLB-LITIGE-LITIGE | BLB | Litige | حوارته | 1555
LB-BLB-LITIGE-LITIGE-P2177 | BLB | Litige |  | 2099
LB-BLB-LITIGE-LITIGE-P2194 | BLB | Litige |  | 563
LB-BLB-MAZRAAT-BEIT-MCHAIK | BLB | Mazraat beit Mchaik | مزرعة بيت مشيك | 1775
LB-BLB-MOUSRAYEH | BLB | Mousrayeh | مطحنة مصراية | 982
LB-BLB-OUADI-EL-AAOSS | BLB | Ouadi El-Aaoss | وادي القصص | 1635
LB-BLB-QAA-BAAYOUN | BLB | Qaa Baayoun | قاع بعيون | 721
LB-BLB-QAA-JOUAR-MAQIYE | BLB | Qaa Jouar Maqiyé | قاع جوار مكية | 583
LB-BLB-QAA-OUADI-EL-KHANZIR | BLB | Qaa Ouadi El-Khanzir | قاع وادي الخنزير | 640
LB-BLB-RAS-BAALBEK-ECH-CHARQI | BLB | Ras Baalbek Ech-Charqi | راس بعلبك الشرقي | 1326
LB-BLB-SLOUQI | BLB | Slouqi | سلوقي | 2310
LB-BNJ-KAFRA-BANT-JBAYL | BNJ | Kafra Bant Jbayl | كفرا بنت جبيل | 591
LB-BNJ-QATMOUN | BNJ | Qatmoun | قطموم | 616
LB-BSH-MAZRAAT-AASSAF | BSH | Mazraat Aassaf | مزرعة عساف | 1007
LB-BSH-MCHAA-EJ-JIBBE | BSH | Mchaa Ej-Jibbé | مشاع الجبه | 2447
LB-BSH-OUADI-QANNOUBINE | BSH | Ouadi Qannoubine | وادي قنوبين | 743
LB-CHF-BENOUATI-ECH-CHOUF | CHF | Benouati Ech-Chouf | بنواتي | 407
LB-CHF-BKECHTINE-OUEL-MCHEIAA | CHF | Bkechtine Ouel Mcheiaa | بكشتين | 601
LB-CHF-BQAIAA-ECH-CHOUF | CHF | Bqaiaa Ech-Chouf | بقيعة | 242
LB-CHF-CHMAARINE | CHF | Chmaarine | شمعرين | 385
LB-CHF-GHABET-JAAFAR | CHF | GHabet Jaafar | غابة جعفر | 654
LB-CHF-JDEIDET-ECH-CHOUF | CHF | Jdeidet Ech-Chouf | جديدة الشوف | 924
LB-CHF-KFAR-HAY | CHF | Kfar hay | كفر حي | 534
LB-CHF-LITIGE | CHF | Litige |  | 1836
LB-CHF-LITIGE-LITIGE | CHF | Litige |  | 920
LB-CHF-LITIGE-LITIGE-P1990 | CHF | Litige |  | 254
LB-CHF-LITIGE-LITIGE-P1991 | CHF | Litige |  | 1714
LB-CHF-LITIGE-LITIGE-P1992 | CHF | Litige |  | 411
LB-CHF-LITIGE-LITIGE-P1993 | CHF | Litige |  | 331
LB-CHF-LITIGE-LITIGE-P1994 | CHF | Litige |  | 511
LB-CHF-MOUGHAYRET-ECH-CHOUF | CHF | Moughayret Ech-Chouf | مغيره | 208
LB-CHF-OUADI-ABOU-YOUSSEF | CHF | Ouadi Abou Youssef | وادي ابو يوسف | 351
LB-CHF-OUADI-BNEHLAY | CHF | Ouadi bnehlay | وادي بنحليه | 467
LB-CHF-OUADI-ED-DEIR | CHF | Ouadi Ed-Deir | وادي الدير | 382
LB-HRM-HERMEL-JBAB | HRM | Hermel Jbab | هرمل جباب | 1869
LB-HRM-LITIGE | HRM | Litige |  | 545
LB-HRM-LITIGE-LITIGE | HRM | Litige |  | 2028
LB-HRM-MICHAA-MRAJHINEH | HRM | Michaa Mrajhineh | سويدية | 1741
LB-HRM-OUADI-FAARA | HRM | Ouadi Faara | وادي فعرا | 1592
LB-HRM-RAS-BAALBEK-EL-GHARBI | HRM | Ras Baalbek El Gharbi | راس بعلبك الغربي | 1801
LB-HRM-RAS-BAALBEK-OUADI-FAARA | HRM | Ras Baalbek Ouadi Faara | راس بعلبك وادي فعرا | 876
LB-JBL-AARAB-EL-LAHIB | JBL | Aarab El-Lahib | عرب اللهيب | 1957
LB-JBL-AARASTA | JBL | Aarasta | عرستا | 1031
LB-JBL-GHABAT | JBL | Ghabat | غابات | 1140
LB-JBL-HEMA-ER-REHBAN | JBL | Hema Er-Rehban | حمى الرهبان | 1711
LB-JBL-HEMA-MAR-MAROUN-AANNAYA | JBL | Hema Mar Maroun Aannaya | حمى مار مارون عنَايا | 1618
LB-JBL-JOURET-EL-QATTINE | JBL | Jouret El-Qattine | جورة القطين | 741
LB-JBL-LITIGE | JBL | Litige |  | 1102
LB-JBL-LITIGE-LITIGE | JBL | Litige |  | 834
LB-JBL-LITIGE-LITIGE-P2036 | JBL | Litige |  | 763
LB-JBL-LITIGE-LITIGE-P2037 | JBL | Litige |  | 745
LB-JBL-LITIGE-LITIGE-P2038 | JBL | Litige |  | 1097
LB-JBL-LITIGE-LITIGE-P2039 | JBL | Litige |  | 1179
LB-JBL-LITIGE-LITIGE-P2040 | JBL | Litige |  | 1433
LB-JBL-LITIGE-LITIGE-P2042 | JBL | Litige |  | 1246
LB-JBL-MAZRAAT-EL-MAADEN | JBL | Mazraat El-Maaden | مزرعة المعادن | 1151
LB-JBL-SAQIET-EL-KHAYT | JBL | Saqiet El-Khayt | ساقية الخيط | 582
LB-JBL-TADMOR | JBL | Tadmor | تدمر | 1389
LB-JZN-AARAY | JZN | Aaray | عاريه | 747
LB-JZN-BEHBEH | JZN | Behbeh | بيبه | 705
LB-JZN-DAHR-ED-DEIR | JZN | Dahr Ed-Deir | ضهر الدير | 536
LB-JZN-DEIR-EL-QATTINE | JZN | Deir El Qattine | دير قطِين | 711
LB-JZN-DEMACHQIYEH | JZN | Demachqiyeh | دمشقية | 404
LB-JZN-GHABBATIYEH | JZN | Ghabbatiyeh | غبَاطية | 620
LB-JZN-JABAL-TOURA | JZN | Jabal Toura | جبل طوره | 1299
LB-JZN-LITIGE | JZN | Litige |  | 695
LB-JZN-LITIGE-LITIGE | JZN | Litige |  | 1238
LB-JZN-LITIGE-LITIGE-P2235 | JZN | Litige |  | 952
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
LB-KOR-AIN-AAKRINE | KOR | Ain Aakrine | عين عكرين | 523
LB-KOR-BARGHOUN | KOR | Barghoun | برغون | 203
LB-KOR-BQAIAA-EL-KOURA | KOR | Bqaiaa El-Koura | البقيعة | 177
LB-KOR-ZGHARTA-EL-MTAOUILE | KOR | Zgharta El-Mtaouile | زغرتا المتاولة | 594
LB-KSR-AAQAIBEH-KESROUANE | KSR | Aaqaibeh Kesrouane | عقيبة | 93
LB-KSR-BEQAATA-AACHQOUT | KSR | Beqaata Aachqout | بقعاتة عشقوت | 1266
LB-KSR-BQAQ-ED-DINE | KSR | Bqaq Ed-Dine | بقاق الدين | 69
LB-KSR-CHOUANE | KSR | Chouane | شوان | 802
LB-KSR-DEIR-BAQLOUCH | KSR | Deir Baqlouch | دير بقلوش | 373
LB-KSR-KFAR-TAY-KESROUANE | KSR | Kfar Tay Kesrouane | دير زرعيا | 1003
LB-KSR-KHARAYEB-NAHR-IBRAHIM | KSR | Kharayeb Nahr Ibrahim | زاير | 20
LB-KSR-LITIGE | KSR | Litige |  | 1849
LB-KSR-LITIGE-LITIGE | KSR | Litige |  | 2040
LB-KSR-LITIGE-LITIGE-P2022 | KSR | Litige |  | 925
LB-KSR-LITIGE-LITIGE-P2041 | KSR | Litige |  | 1807
LB-KSR-MAZRAAT-ER-RAS | KSR | Mazraat Er-Ras | مزرعة الراس | 323
LB-KSR-MCHAA-EL-FTOUH | KSR | Mchaa El Ftouh | مشاع الفتوح | 1948
LB-KSR-MCHAA-FARAYA | KSR | Mchaa Faraya | مشاع فاريا | 1895
LB-KSR-MCHAA-KFAR-DIBIANE | KSR | Mchaa Kfar Dibiane | مشاع كفر ذبيان | 2312
LB-MND-AAIN-ET-TINEH-MINIYEH | MND | Aain Et-Tineh-Miniyeh | عين التينه المنيه | 878
LB-MND-AASAYMOUT | MND | Aasaymout | عصيموت | 731
LB-MND-BECHEHHARA | MND | Bechehhara | بشحارة | 654
LB-MND-BECHNNATA | MND | Bechnnata | بشناتا | 1656
LB-MND-BEIT-HAOUIK | MND | Beit Haouik | بيت حاويك | 847
LB-MND-HARF-ES-SAYAD | MND | Harf Es-Sayad | حرف السياد | 399
LB-MND-HAZMIYET-MINIYEH | MND | Hazmiyet-Miniyeh | حازمية المنيه | 714
LB-MND-JARJOUR | MND | Jarjour | جرجور | 651
LB-MND-KHARROUB-MINIYEH | MND | Kharroub-Miniyeh | خرنوب المنيه | 746
LB-MND-LITIGE | MND | Litige |  | 922
LB-MND-LITIGE-LITIGE | MND | Litige |  | 2286
LB-MND-LITIGE-LITIGE-P2124 | MND | Litige |  | 1218
LB-MND-LITIGE-LITIGE-P2125 | MND | Litige |  | 1047
LB-MND-LITIGE-LITIGE-P2126 | MND | Litige |  | 1010
LB-MND-LITIGE-LITIGE-P2127 | MND | Litige |  | 2089
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
LB-MTN-DBAYEH | MTN | Dbayeh | ضبية | 7
LB-MTN-KFAR-TAY-EL-MATN | MTN | Kfar Tay El-Matn | كفرتيه | 1663
LB-MTN-LITIGE | MTN | Litige |  | 883
LB-MTN-LITIGE-LITIGE | MTN | Litige |  | 1269
LB-MTN-MAZRAAT-DEIR-AAOUKAR | MTN | Mazraat Deir Aaoukar | مزرعة دير عوكر | 118
LB-MTN-MHAIDSET-MATN | MTN | Mhaidset Matn | محيدثة المتن | 908
LB-MTN-MZAKKEH | MTN | Mzakkeh | مزكة | 836
LB-NBT-MAZRAAT-BSAFFOUR | NBT | Mazraat Bsaffour | مزرعة بصفُور | 308
LB-NBT-MAZRAAT-CHALBAAL | NBT | Mazraat Chalbaal | مزرعة شلبعل | 365
LB-NBT-MAZRAAT-DMOUL | NBT | Mazraat Dmoul | مزرعة دمول | 300
LB-NBT-MAZRAAT-QALAAT-EL-MEIS | NBT | Mazraat Qalaat El-Meis | مزرعة قلعة ميس | 254
LB-RSH-LITIGE | RSH | Litige |  | 1330
LB-RSH-LITIGE-LITIGE | RSH | Litige |  | 1172
LB-RSH-LITIGE-LITIGE-P2203 | RSH | Litige |  | 1155
LB-RSH-LITIGE-LITIGE-P2204 | RSH | Litige |  | 1180
LB-RSH-LITIGE-LITIGE-P2205 | RSH | Litige |  | 1265
LB-RSH-LITIGE-LITIGE-P2206 | RSH | Litige |  | 1640
LB-RSH-LITIGE-LITIGE-P2207 | RSH | Litige |  | 888
LB-RSH-LITIGE-LITIGE-P2208 | RSH | Litige |  | 2088
LB-RSH-LITIGE-LITIGE-P2209 | RSH | Litige |  | 1813
LB-RSH-NABI-SAFA | RSH | Nabi Safa | نبي صفا | 1242
LB-RSH-SELSATA-MAZRAAT-DEIR-EL-AACHAIYER | RSH | Selsata (Mazraat Deir El-Aachaiyer) | مزرعة سلساتا | 1525
LB-SAI-HARTIYEH | SAI | Hartiyeh | حارتية | 144
LB-SAI-JAZIRA-SAIDA | SAI | Jazira Saida | جزيرة صيدا | 6
LB-SAI-KFAR-MELKI-SAIDA | SAI | Kfar Melki Saida | كفرملكي صيدا | 378
LB-SAI-KHIRBET-ED-DOUAIR-SAIDA | SAI | Khirbet Ed-Douair Saida | خربة الدوير صيدا | 155
LB-SAI-KHIRBET-EL-BASSAL | SAI | Khirbet El-Bassal | خربة البصل | 262
LB-SAI-LITIGE | SAI | Litige |  | 57
LB-SAI-MAZRAAT-EL-HOUSSAINIYEH | SAI | Mazraat El-Houssainiyeh | مزرعة الحسينية | 70
LB-SAI-MAZRAAT-EL-YAHOUDIYEH-AAITANIYEH | SAI | Mazraat El Yahoudiyeh (Aaitaniyeh) | مزرعة العيتانية | 10
LB-SAI-MAZRAAT-JAMJIM | SAI | Mazraat Jamjim | مزرعة جمجيم | 140
LB-SAI-MAZRAAT-OUSSAMIYAT | SAI | Mazraat Oussamiyat | الاوساميات | 145
LB-SAI-MAZRAAT-SARI | SAI | Mazraat Sari | ساري | 135
LB-SAI-MAZRAAT-SNAIBER | SAI | Mazraat 'Snaiber | مزرعة سنيبر | 100
LB-SAI-MZARAAT-EL-OUASTA | SAI | Mzaraat El-Ouasta | مزرعة الواسطة | 62
LB-SAI-QAAQAIYET-ES-SNAOUBAR | SAI | Qaaqaiyet Es-Snaoubar | قعقعية الصنوبر | 181
LB-SAI-SAIDA-EL-OUSTANI | SAI | Saida El-Oustani | الوسطاني | 13
LB-SAI-SAIDA-EL-QADIMEH | SAI | Saida El-Qadimeh | صيدا | 2
LB-TRP-MINA-JARDIN | TRP | Mina Jardin | بساتين المينا | 5
LB-TRP-MINA-N-1 | TRP | Mina N:1 | مينا طرابلس 1 | 10
LB-TRP-MINA-N-3 | TRP | Mina N:3 | المينا | 8
LB-TRP-TRABLOUS-EL-HADDADINE-EL-HADID-EL-MHARTA | TRP | Trablous El-Haddadine, El-Hadid, El-Mharta | الحدادين | 25
LB-TRP-TRABLOUS-EL-HADID | TRP | Trablous El Hadid | الحديد | 25
LB-TRP-TRABLOUS-EL-MHATRA | TRP | Trablous El Mhatra | المهاترة | 43
LB-TRP-TRABLOUS-EL-QOBBE | TRP | Trablous El-Qobbe | القبة | 86
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
LB-WBQ-LITIGE | WBQ | Litige |  | 1059
LB-WBQ-LITIGE-LITIGE | WBQ | Litige |  | 1797
LB-WBQ-LITIGE-LITIGE-P2168 | WBQ | Litige |  | 1836
LB-WBQ-OUAQF-BG | WBQ | Ouaqf BG | الوقف بقاع الغربي | 865
LB-WBQ-SOLTAN-YACOUB-EL-ARADI | WBQ | Soltan Yacoub el Aradi | سلطان يعقوب أراضي | 1049
LB-ZGH-AINTOURINE | ZGH | Aintourine | عينطورين | 1246
LB-ZGH-DANHA | ZGH | Danha | دنها | 173
LB-ZGH-HARIQ-ZGHARTA | ZGH | Hariq Zgharta | حريق زغرتا | 178
LB-ZGH-HOUAKIR | ZGH | Houakir | حواكير | 390
LB-ZGH-MAZRAAT-AJBEAA | ZGH | Mazraat Ajbeaa | مزرعة إجبع | 141
LB-ZGH-MAZRAAT-JNAID | ZGH | Mazraat Jnaid | مزرعة جنيد | 153
LB-ZGH-MIRIATA | ZGH | Miriata | مرياطا | 189
LB-ZGH-QARAH-BACH | ZGH | Qarah Bach | قره باش | 115
LB-ZHL-CHEBRQIYET-TABET | ZHL | Chebrqiyet Tabet | شبرقية تابت | 870
LB-ZHL-HAOUCH-EL-AAMARA | ZHL | Haouch El-Aamara | تل العمارة | 913
LB-ZHL-HAOUCH-ES-SIYADEH | ZHL | Haouch Es-Siyadeh | حوش الصيادي | 869
LB-ZHL-HAOUCH-MANDARA | ZHL | Haouch Mandara | حوش مندره | 870
LB-ZHL-HAOUCH-QAYSSAR | ZHL | Haouch Qayssar | قيصر | 870
LB-ZHL-KSARA | ZHL | Ksara | كسارة | 913
LB-ZHL-LITIGE | ZHL | Litige |  | 1055
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
22439 | MTN | Bsalim | بصاليم |  | 
