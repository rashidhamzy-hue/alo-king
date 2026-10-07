# **National Geospatial Master Dataset and Settlement Topology of Lebanon: Institutional Gazetteers, Topographic Modeling, and Relational Geography for Conversational Logistics**

## **Structural Demarcation and Administrative Hierarchy**

Lebanon’s territorial organization is governed by a dual administrative framework comprising deconcentrated arms of the central executive and decentralized local government units, codified through Legislative-Decree No. 116 of June 12, 1959, and amended by Law No. 522 of July 16, 2003, and Law No. 51 of September 7, 2017\. A foundational challenge in Lebanese geospatial data engineering is the systemic conflation of three distinct territorial entities: the cadastral zone (*Al-Mantaqah Al-Iqariyyah*), the municipality (*Al-Baladiyyah*), and the populated locality or village (*Al-Qaryah* / *Al-Dayaa* / *Al-Mahallah*). Disentangling these layers is a functional prerequisite for physical delivery logistics, route optimization, and customer addressing.  
The sovereign territory is partitioned into nine Governorates (*Muhafazat*), which represent deconcentrated administrative jurisdictions led by a centrally appointed Governor (*Muhafiz*) operating under the statutory supervision of the Ministry of Interior and Municipalities (MoIM). With the structural exceptions of Beirut—which functions as a unitary metropolitan municipality without sub-districts—and Akkar—which operates as a single-district governorate—each governorate is partitioned into administrative Districts (*Aqdya*, singular *Qadaa* or *Caza*), establishing twenty-six districts nationwide. Districts are administered by a Sub-Prefect (*Qaimaqam*), who exercises regulatory tutelage over municipal councils and directly governs unincorporated territories.

| Governorate (*Muhafaza*) | Official Arabic Name | Administrative Capital | Districts (*Aqdya*) | Statutory Basis |
| :---- | :---- | :---- | :---- | :---- |
| **Beirut** | محافظة بيروت | Beirut | Unitary (Quarters & Sectors) | Historic urban core; Decree 116/1959 |
| **Mount Lebanon** | محافظة جبل لبنان | Baabda | Baabda, Metn, Chouf, Aley | Decree 116/1959; reorganized Law 51/2017 |
| **Keserwan-Jbeil** | محافظة كسروان \- جبيل | Jounieh | Keserwan, Jbeil | Law 51 of Sept 7, 2017; operationalized 2020 |
| **North Lebanon** | محافظة الشمال | Tripoli | Tripoli, Koura, Batroun, Bcharre, Zgharta, Minieh-Dannieh | Decree 116/1959; modified Law 522/2003 |
| **Akkar** | محافظة عكار | Halba | Akkar (Coterminous) | Law 522 of July 16, 2003; operationalized 2014 |
| **Beqaa** | محافظة البقاع | Zahle | Zahle, Western Beqaa, Rashaya | Decree 116/1959; modified Law 522/2003 |
| **Baalbek-Hermel** | محافظة بعلبك \- الهرمل | Baalbek | Baalbek, Hermel | Law 522 of July 16, 2003; operationalized 2014 |
| **South Lebanon** | محافظة الجنوب | Sidon (*Saida*) | Sidon, Tyre, Jezzine | Decree 116/1959; modified Law 8/1983 |
| **Nabatieh** | محافظة النبطية | Nabatieh | Nabatieh, Bint Jbeil, Marjeyoun, Hasbaya | Law No. 8 of February 7, 1983 |

Below the district tier, spatial boundaries diverge significantly from a clean hierarchical cascade. Cadastral zones, delineated by the Directorate of Land Registry and Cadastre (GDLRC) under the Ministry of Finance and formalized across United Nations and Central Administration of Statistics (CAS) cartographic layers, total exactly 1,623 spatial units. A cadastral zone is strictly a fiscal and property boundary framework established during the French Mandate under Decree No. 186/1926. It possesses no administrative, political, or municipal authority. Over 340 cadastral zones represent uninhabited agricultural land parcels (*Mazraa*), protected forests, state domains, or high mountain massifs that contain zero permanent residences or commercial storefronts.  
Decentralized governance is exercised exclusively at the municipal tier under Decree-Law No. 118 of June 30, 1977\. The state maintains approximately 1,029 legally constituted municipalities, a figure that fluctuates up to 1,050 through selective executive decrees. While a municipality frequently corresponds to a single historic settlement, over two hundred municipal councils govern multiple distinct villages (such as the combined councils of Beit Chabab \- Chaouiye & Qnaytra, or Mezyara \- Haref \- Hmayss \- Sakhra). Furthermore, extensive rural areas remain completely unincorporated; these localities lack municipal councils entirely and depend directly on the *Qaimaqam* for administrative functions.  
At the functional base of this hierarchy are the physical populated places: the cities, commercial towns, villages, agricultural hamlets, and distinct urban quarters where commerce and residency occur. CAS inventories record roughly 1,409 to 1,500 historic settlements. However, comprehensive geospatial databases that integrate OpenStreetMap nodes, field gazetteers, and local business directories reveal over 2,200 distinct, named populated destinations. In dense commercial hubs like Bakaata in the Chouf, economic life flourishes within a well-defined urban core that is not an independent municipality, but rather a commercial district legally situated within the municipal boundaries of Jdeidet el-Chouf. Relying solely on official municipal registries would omit such high-volume delivery destinations entirely.

## **Vernacular, Geomorphological, and Historical District Subdivisions**

While formal administrative statutes recognize only the Governorate, the District, and the Municipality, commercial operations and transport navigation rely heavily on customary sub-district territories. These subregions reflect geomorphological barriers, river valleys (*Wadis*), microclimatic changes, and historic feudal or confessional borders. Incorporating these informal and historical divisions into the geographic architecture is essential for zone-based dispatching, driver territory assignments, and terrain-based pricing.  
The territorial nesting operates across four functional tiers. At the sovereign summit, the national territory encompasses the nine deconcentrated Governorates, each of which contains its statutory administrative Districts headed by a *Qaimaqam*. Within these districts sit the vernacular, geomorphological, and historical subregions, which group both organized municipal councils and unincorporated state lands. At the operational base, these subregions encompass the populated localities, commercial clusters, and street-level neighborhoods that function as physical delivery points. Operating alongside this administrative cascade is the fiscal cadastral network of 1,623 property boundaries, which provides a spatial framework for boundary-snapping without constraining local municipal or commercial activity.

| District (*Qadaa*) | Subregion Name | Arabic Name | Typological Classification | Spatial Scope & Descriptive Boundary |
| :---- | :---- | :---- | :---- | :---- |
| **Chouf** | Chouf el-Aala (Upper Chouf) | الشوف الأعلى | Historical / Geomorphological | High mountain spine; Moukhtara, Barouk, Khraybeh, Maasser, Bater |
| **Chouf** | Chouf el-Awsat (Central Chouf) | الشوف الأوسط | Historical / Colloquial | Middle limestone hills; Baakline, Beiteddine, Semqanieh, Deir el-Qamar |
| **Chouf** | Chouf el-Saheli (Chouf Coast) | الشوف الساحلي | Geomorphological / Functional | Littoral plain; Damour, Jiyeh, Rmeyleh, Naameh |
| **Chouf** | Iqlim al-Kharroub | إقليم الخروب | Historical / Cultural Region | Southwestern highland & coastal hills; Chhim, Barja, Ketermaya, Mazboud |
| **Metn** | Matn al-Saheli (Coastal Metn) | المتن الساحلي | Geomorphological / Urban | High-density plain; Bourj Hammoud, Jdeideh, Antelias, Dbayeh |
| **Metn** | Matn al-Awsat (Middle Metn) | المتن الأوسط | Geomorphological / Colloquial | Intermediate pine ridge; Beit Mery, Broummana, Mansourieh, Baabdat |
| **Metn** | Matn al-Aala (Upper Metn) | المتن الأعلى | Historical / Geomorphological | High mountain rim; Bikfaya, Dhour el-Choueir, Bteghrine, Baskinta |
| **Keserwan** | Keserwan al-Saheli | ساحل كسروان | Geomorphological / Urban | Littoral basin; Jounieh, Kaslik, Sarba, Zouk Mikael, Zouk Mosbeh |
| **Keserwan** | Al-Ftouh | الفتوح | Historical / Feudal Canton | Middle plateau & limestone valleys; Ghazir, Dlebta, Chahtoul, Aramoun |
| **Keserwan** | Keserwan al-Jurd (High Jurd) | جرد كسروان | Geomorphological / Alpine | Karstic ski plateau; Feytroun, Rayfoun, Mayrouba, Faraya, Kfardebian |
| **Batroun** | Sahel al-Batroun | ساحل البترون | Geomorphological / Coastal | Littoral strip; Batroun city, Chekka, Hamat promontory, Selaata |
| **Batroun** | Wasat al-Batroun | وسط البترون | Geomorphological / Rural | Olive hills; Ibrine, Kour, Smar Jbeil, Eddeh, Bcheeleh |
| **Batroun** | Jurd al-Batroun | جرد البترون | Geomorphological / Alpine | High limestone plateau; Douma, Tannourine el-Faouqa, Hardine, Chatine |
| **Akkar** | Sahel Akkar (Akkar Plain) | سهل عكار | Geomorphological / Agricultural | Alluvial littoral basin; Bebnine, Abdeh, Arida border crossing |
| **Akkar** | Qora al-Qaytaa & Jurd al-Qaytaa | القيطع وجرد القيطع | Historical / Geographic | Low-to-high western corridor; Berkayel, Fnaydek, Mish Mish, Qammouaa |
| **Akkar** | Al-Joumeh | الجومة | Historical / Geographic Basin | Central valley depression; Rahbe, Bazbina, Tikrit, Beit Mallat |
| **Akkar** | Al-Drayb (Awsat & Aala) | الدريب | Historical / Administrative Canton | Middle-to-high eastern plateau; Kobayat, Andket, Chadra, Akkar el-Atika |
| **Akkar** | Wadi Khaled | وادي خالد | Geomorphological / Border Basin | Northeastern frontier plain; Al-Amayer, Mqaibleh, Hicheh |
| **Akkar** | Jabal Akroum | جبل أكروم | Geomorphological / Ridge | High northeastern border ridge; Akroum, Kfartoun, Sahleh |
| **Baalbek** | Sahel Baalbek (Central Plain) | سهل بعلبك | Geomorphological / Agricultural | Intramontane valley floor; Baalbek city, Douris, Iaat, Chaat |
| **Baalbek** | Gharbi Baalbek (Western Flank) | غربي بعلبك | Geomorphological / Rural Foothills | Eastern Lebanon mountain base; Chmestar, Deir el-Ahmar, Bednayel, Bodai |
| **Baalbek** | Sharqi Baalbek & Arsal Highlands | شرقي بعلبك وجرد عرسال | Geomorphological / Semi-Arid | Anti-Lebanon base & scrub plateau; Brital, Nabi Chit, Arsal, Labweh |
| **Zahle** | Sahel Zahle (Zahle Plain) | سهل زحلة | Geomorphological / Transport Core | Central Beqaa floor; Chtaura, Saadnayel, Bar Elias, Taanayel |
| **Zahle** | Wasat Zahle & Sannine Slopes | سفوح صنين ووسط زحلة | Geomorphological / Urban Mountain | Narrow gorge & hillside city; Zahle core, Qaa el-Rim, Berdaleh, Hezerta |
| **Zahle** | Sharqi Zahle (Eastern Border) | شرقي زحلة | Geomorphological / Border Basin | Anti-Lebanon slopes; Kfarzabad, Anjar, Majdel Anjar, Masnaa corridor |
| **West Beqaa** | Sahl al-Litani (Litani Plain) | سهل الليطاني | Geomorphological / Agricultural | Graben floor; Joub Jannine, Ghazze, Al-Marj, Khiara |
| **West Beqaa** | Jabal Barouk Eastern Escarpment | سفوح الباروك الشرقية | Geomorphological / Escarpment | Western slope settlements; Saghbine, Kefraya, Ain Zebdeh, Aitanit |
| **West Beqaa** | Bohayrat Qaraoun & Machghara Basin | حوض القرعون ومشغرة | Geomorphological / Riparian Lake | Southern lake margins & gorge; Qaraoun, Sohmor, Machghara, Yohmor |
| **Rashaya** | Sahl Rashaya (Rashaya Basin) | سهل راشيا | Geomorphological / Highland Plain | Intramontane plateau; Dahr el-Ahmar, Kfar Danis, Rafid |
| **Rashaya** | Jabal el-Sheikh Western Slopes | سفوح جبل الشيخ | Geomorphological / Alpine | High Mount Hermon flank; Rashaya el-Wadi, Ain Ata, Bakka, Kfarmeshki |
| **Sidon** | Saida al-Hadariyya (Urban Core) | صيدا الحضرية | Functional / Metropolitan | Coastal agglomeration; Sidon, Hilaliyeh, Bramiyeh, Haret Saida, Mieh ou Mieh |
| **Sidon** | Sahel al-Zahrani (Zahrani Coast) | ساحل الزهراني | Geomorphological / Transport Axis | Southern coastal littoral; Ghazieh, Sarafand, Adloun, Saksakiyeh |
| **Sidon** | Hadabat Saida (Sidon Foothills) | هضاب صيدا | Geomorphological / Rural Hills | Interior citrus/olive uplands; Maghdouche, Qennarit, Ankoun, Kfar Hatta |
| **Tyre** | Sahel Sour (Tyre Littoral) | ساحل صور | Geomorphological / Coastal Plain | Alluvial coastal plain; Tyre city, Abbassieh, Bourj el-Chmali, Bazourieh |
| **Tyre** | Jabal Amel (Tyre Uplands) | مرتفعات جبل عامل | Historical / Geomorphological | Rolling limestone plateaus; Qana, Jouaiya, Siddiqine, Deir Qanoun el-Nahr |
| **Tyre** | Al-Sahel al-Janoubi (Border Coast) | الساحل الجنوبي | Geomorphological / Border Littoral | Coastal border fringe; Naqoura, Alma el-Chaab, Mansouri, Qlaileh |
| **Jezzine** | Hwd Jezzine (Jezzine Basin) | حوض جزين | Geomorphological / Escarpment | Cliff waterfall amphitheater; Jezzine town, Ain Majdaleyn, Wadi Jezzine |
| **Jezzine** | Horsh Bkassine & Roum Ridge | حرج بكاسين وظهر روم | Geomorphological / Forest Uplands | Pine basin & western hills; Bkassine, Roum, Benweteh, Kaitouleh |
| **Jezzine** | Jabal al-Rihan | جبل الريحان | Geomorphological / Ridge Spine | Southern frontier ridge; Kfarhouna, Rihane, Aramta, Louaizeh, Sojod |
| **Nabatieh** | Hwd Nabatieh (Nabatieh Basin) | حوض النبطية | Geomorphological / Commercial Core | Central bowl & commercial crossroads; Nabatieh el-Tahta, Nabatieh el-Fawqa, Kfar Remen |
| **Nabatieh** | Iqlim al-Touffah | إقليم التفاح | Historical / Mountain Escarpment | Northern apple highlands; Jbaa, Ain Bouswar, Jarjouh, Ain Qana, Arab Salim |
| **Nabatieh** | Hadabat al-Chaqif (Litani Ridge) | ربى الشقيف | Historical / Geomorphological | Southern plateau over Litani; Arnoun (Beaufort), Mayfadoun, Zawtar, Kaakaiyet |
| **Bint Jbeil** | Jabal Amel Central Highlands | قلب جبل عامل | Historical / Mountain Plateau | High plateau market core; Bint Jbeil town, Ain Ebel, Tebnine, Aitaroun |
| *Bint Jbeil* | Al-Hadd al-Gharbi (Border Crest) | الحد الغربي الجنوبي | Geomorphological / Border Ridge | High southwestern frontier; Rmeich, Ayta ach-Chaab, Yaroun, Debel, Maroun el-Ras |
| **Marjeyoun** | Sahl Marjeyoun & Khiam Ridge | سهل مرجعيون ومرتفع الخيام | Geomorphological / Agricultural | Alluvial plain & high eastern rim; Marjeyoun (Jdeidet), Khiam, Qlaiaa, Ibl el-Saqi |
| **Marjeyoun** | Meiss el-Jabal Eastern Escarpment | حافة ميس الجبل | Geomorphological / Plateau Ridge | Eastern border ridge; Meiss el-Jabal, Houla, Markaba, Blida |
| **Hasbaya** | Wadi el-Taym (Hasbani Basin) | وادي التيم | Historical / Riparian Valley | Upper Hasbani river basin; Hasbaya town, Kawkaba, Souq el-Khan, Ain Qanya |
| **Hasbaya** | Al-Arqoub | العرقوب | Historical / Alpine Foothills | High Mount Hermon gorges; Chebaa, Kfarchouba, Hbariyeh, Rachaya el-Fokhar |
| **Minieh-Dan.** | Sahel al-Minieh | ساحل المنية | Geomorphological / Littoral | Coastal agricultural corridor; Minieh, Deir Aamar, Bhanine, Beddawi fringe |
| **Minieh-Dan.** | Jurd Dannieh | جرد الضنية | Geomorphological / Alpine Basin | Alpine limestone cirque; Sir el-Dannieh, Bakhoun, Bqarsouna, Nemrine |
| **Koura** | Hadabat al-Koura (Olive Plateau) | هضبة الكورة | Geomorphological / Agricultural | Interior olive plateau; Amioun, Kousba, Bishmizzine, Kfarhazir |
| **Bcharre** | Jebbet Bcharre & Qadisha Gorge | جبة بشري ووادي قاديشا | Historical / Holy Valley Canyon | Dramatic gorge & alpine terraces; Bcharre town, Hadchit, Hasroun, Bqaa Kafra |
| **Baabda** | Sahel Baabda & Southern Suburbs | ساحل بعبدا والضاحية | Functional / High-Density Urban | Littoral plain; Chiyah, Haret Hreik, Bourj el-Barajneh, Ghobeiry, Hadath |
| **Baabda** | Wasat Baabda (Administrative Spine) | وسط بعبدا | Geomorphological / Foothills | Intermediate ridge; Baabda town, Hazmieh, Yarze, Jamhour, Kfarchima |
| **Baabda** | Jabal al-Matn (Southern Upper Metn) | جبل المتن الجنوبي | Historical / High Mountain Valley | High interior valley; Hammana, Falougha, Qornayel, Bzebdine, Arsoun |
| **Aley** | Sahel Aley (Aley Coast) | ساحل عاليه | Functional / Industrial Littoral | Littoral industrial corridor; Choueifat, Khalde, Naameh |
| **Aley** | Al-Gharb al-Aala (Higher Gharb) | الغرب الأعلى | Historical / Ridge Corridor | Historic western ridge; Aley city, Souk el-Gharb, Shimlan, Ainab, Kaifoun |
| **Aley** | Jurd Aley (High Mountain Pass) | جرد عاليه | Geomorphological / High Ridge | Damascus highway transit crest; Bhamdoun, Sofar, Ain Dara, Mdeirej |

## **Geodetic Foundations, Topographic Modeling, and Distance Methodologies**

Topographic precision is mandatory for on-demand logistics across Lebanon. The western maritime slope ascends from sea level to over 3,000 meters across a horizontal distance of less than 35 kilometers, resulting in steep mechanical gradients, rapid microclimatic variations, and high road curvature. Elevation values cannot be treated as uniform integers across a municipality's geographic extent. In high-relief mountainous topography, a municipality’s territory often spans several hundred meters of vertical elevation.  
To maintain dispatch consistency, geospatial data architectures must distinguish the elevation of the village center from the broader cadastral boundary. The village center elevation captures the altitude of the historic, administrative, or commercial settlement core (typically the municipal hall, primary square, or central church or mosque), serving as the physical baseline for last-mile customer drops. In contrast, the cadastral bounds record the minimum and maximum elevations registered across the entire property polygon (*Manatiq Iqariyya*).  
Authoritative elevation modeling relies on a synthesis of three primary assets: Shuttle Radar Topography Mission (SRTM) 1-arcsecond global digital elevation models (30-meter resolution); the UN-OCHA and CAS settlements dataset, which records elevations queried via web services at centroid coordinates alongside CAS maximum elevation attributes (CAS\_MaxElevation); and official 1:20,000 and 1:50,000 topographic sheets published by the Lebanese Army Directorate of Geographic Affairs (DAG).  
Significant discrepancies between sources frequently emerge in high-altitude localities. In Bqaa Kafra within the Bcharre District—the highest continuously inhabited village in Lebanon and the wider Levant—historic village center elevations are documented at 1,600 to 1,650 meters above sea level, while its residential periphery climbs to 1,850 meters and its upper agricultural lands reach 2,750 meters. The operational baseline for commercial delivery dispatch to Bqaa Kafra is established at 1,650 meters.  
Similarly, in Faraya within the Keserwan District, the traditional municipal center rests at 1,290 to 1,320 meters, while its upper ski resort chalets and commercial hotels at Mzaar and Wardeh span from 1,600 to 1,950 meters. An on-demand delivery platform must distinguish Faraya Village (1,300 meters) from the Mzaar ski sector (1,850 meters) to avoid miscalculating fuel burn and travel time.  
In Kfardebian, the village core sits at 1,220 meters, while Faqra Club and the surrounding resort complexes sit between 1,550 and 1,950 meters. In Tannourine within the Batroun District, Tannourine el-Tahta sits at 900 meters, Tannourine el-Faouqa center rests at 1,450 meters, and the Cedar Reserve plateau exceeds 1,800 meters.  
Straight-line distance calculation relies on the Great-Circle Haversine equation over the WGS84 reference ellipsoid (R \= 6,371.0 \\text{ km}), computing the geodesic distance between two coordinate pairs ((\\phi\_1, \\lambda\_1) and (\\phi\_2, \\lambda\_2)):  
\\Delta \\sigma \= 2 \\arcsin \\left( \\sqrt{\\sin^2\\left(\\frac{\\Delta \\phi}{2}\\right) \+ \\cos(\\phi\_1) \\cos(\\phi\_2) \\sin^2\\left(\\frac{\\Delta \\lambda}{2}\\right)} \\right) D\_{\\text{straight}} \= R \\cdot \\Delta \\sigma  
However, straight-line distance is fundamentally inadequate for delivery operations in mountainous terrain. Actual road distance (D\_{\\text{road}}) diverges substantially based on the terrain's Tortuosity Factor (\\tau), defined as:  
\\tau \= \\frac{D\_{\\text{road}}}{D\_{\\text{straight}}}  
Across Lebanon's coastal plains (such as Tripoli to Batroun, or Beirut to Dbayeh), \\tau ranges between 1.15 and 1.25. In contrast, within middle and high mountain zones dissected by deep karstic canyons (such as Jounieh up to Harissa, or Damour climbing into Beiteddine), \\tau expands from 1.60 to 4.20 due to switchbacks, hairpin turns, and impassable cliffs. Consequently, physical transit time cannot be derived from horizontal distance alone. Delivery dispatch models must calculate transit duration as a multi-variable function of horizontal distance, altitudinal gradient, and road tortuosity:  
T\_{\\text{transit}} \= \\frac{D\_{\\text{road}}}{V\_{\\text{base}}} \\cdot \\left( 1 \+ \\alpha \\frac{\\Delta h}{D\_{\\text{road}}} \+ \\beta \\, \\tau \\right)  
where V\_{\\text{base}} represents baseline vehicle velocity on flat terrain, \\Delta h is the positive elevation climb, and \\alpha and \\beta are empirical mechanical resistance coefficients calibrated to specific delivery vehicle classes.

## **National Master Settlement Gazetteer**

The gazetteer below presents a verified cross-section of primary urban centers, secondary commercial hubs, intermediate villages, and smaller rural localities across Lebanon's twenty-six districts. It explicitly integrates settlements that are frequently omitted from tourist gazetteers or merged into adjacent municipal councils, such as Bakaata, Semqanieh, and Khraybeh in the Chouf District. Elevations represent village-center altitudes compiled from SRTM 30m digital elevation data, UN-OCHA / CAS datasets, and DAG topographic sheets. Geodetic coordinates represent settlement centroids in the WGS84 datum (EPSG:4326).

| Locality ID | Official Arabic Name | Canonical English Name | Type | Governorate | District | Subregion | Municipality | Cadastral Zone | Latitude | Longitude | Elev (m) | Elevation Source | Confidence |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **BEY-001** | بيروت \- الحمراء | Hamra (Ras Beirut) | Neighborhood | Beirut | Beirut | Western Littoral | Beirut | Ras Beirut (Zone 31\) | 33.8972 | 35.4819 | 35 | SRTM 30m / DAG | Verified |
| **BEY-002** | الأشرفية | Achrafieh | Quarter | Beirut | Beirut | Eastern Ridge | Beirut | Achrafieh (Zone 21\) | 33.8886 | 35.5186 | 95 | SRTM 30m / DAG | Verified |
| **BEY-003** | الرميل (مار مخايل) | Mar Mikhael / Rmeil | Neighborhood | Beirut | Beirut | Port Escarpment | Beirut | Rmeil (Zone 23\) | 33.8981 | 35.5264 | 30 | SRTM 30m / CAS | Verified |
| **BEY-004** | المزرعة (طريق الجديدة) | Tariq el-Jdideh | Neighborhood | Beirut | Beirut | Southern Plain | Beirut | Mazraa (Zone 42\) | 33.8732 | 35.5028 | 45 | SRTM 30m / CAS | Verified |
| **BEY-005** | بدارو | Badaro | Neighborhood | Beirut | Beirut | Central Plain | Beirut | Mazraa (Zone 41\) | 33.8755 | 35.5189 | 50 | SRTM 30m / DAG | Verified |
| **BEY-006** | وسط بيروت | Beirut Central District | Commercial Core | Beirut | Beirut | Historic Port | Beirut | Mina el-Hosn / Port | 33.8998 | 35.5052 | 15 | SRTM 30m / DAG | Verified |
| **BEY-007** | المصيطبة | Moussaitbeh | Quarter | Beirut | Beirut | Western Uplands | Beirut | Moussaitbeh (Zone 33\) | 33.8856 | 35.4947 | 55 | SRTM 30m / CAS | Verified |
| **BEY-008** | عين المريسة | Ain el-Mreisseh | Waterfront | Beirut | Beirut | Coastal Fringe | Beirut | Ain el-Mreisseh (11) | 33.9011 | 35.4883 | 10 | SRTM 30m / DAG | Verified |
| **BEY-009** | كركول الدروز | Karakol el-Druze | Locality | Beirut | Beirut | Central Uplands | Beirut | Zokak el-Blat (Zone 32\) | 33.8919 | 35.4939 | 48 | SRTM 30m / CAS | High |
| **BEY-010** | قريطم | Qoreitem | Locality | Beirut | Beirut | Western Uplands | Beirut | Ras Beirut (Zone 31\) | 33.8897 | 35.4789 | 42 | SRTM 30m / CAS | High |
| **ML-BBD-001** | بعبدا | Baabda | Town (Capital) | Mount Lebanon | Baabda | Wasat Baabda | Baabda \- Louaizeh | Baabda | 33.8336 | 35.5442 | 220 | SRTM 30m / CAS | Verified |
| **ML-BBD-002** | الحازمية | Hazmieh | Town | Mount Lebanon | Baabda | Wasat Baabda | Hazmieh | Hazmieh | 33.8608 | 35.5342 | 110 | SRTM 30m / DAG | Verified |
| **ML-BBD-003** | فرن الشباك | Furn el-Chebbak | Town | Mount Lebanon | Baabda | Sahel Baabda | Furn el-Chebbak | Furn el-Chebbak | 33.8711 | 35.5267 | 45 | SRTM 30m / CAS | Verified |
| **ML-BBD-004** | حارة حريك | Haret Hreik | City Suburb | Mount Lebanon | Baabda | Sahel Baabda (Dahiyeh) | Haret Hreik | Haret Hreik | 33.8544 | 35.5133 | 35 | SRTM 30m / CAS | Verified |
| **ML-BBD-005** | برج البراجنة | Bourj el-Barajneh | City Suburb | Mount Lebanon | Baabda | Sahel Baabda (Dahiyeh) | Bourj el-Barajneh | Bourj el-Barajneh | 33.8439 | 35.5086 | 30 | SRTM 30m / CAS | Verified |
| **ML-BBD-006** | الغبيري | Ghobeiry | City Suburb | Mount Lebanon | Baabda | Sahel Baabda (Dahiyeh) | Ghobeiry | Ghobeiry | 33.8642 | 35.5097 | 25 | SRTM 30m / CAS | Verified |
| **ML-BBD-007** | الحدث | Hadath | Town | Mount Lebanon | Baabda | Wasat Baabda | Hadath | Hadath | 33.8425 | 35.5297 | 90 | SRTM 30m / CAS | Verified |
| **ML-BBD-008** | كفرشيما | Kfarchima | Town | Mount Lebanon | Baabda | Wasat Baabda | Kfarchima | Kfarchima | 33.8122 | 35.5347 | 130 | SRTM 30m / CAS | Verified |
| **ML-BBD-009** | وادي شحرور العليا | Wadi Chahrour el-Oulya | Village | Mount Lebanon | Baabda | Wasat Baabda | Wadi Chahrour el-Oulya | Wadi Chahrour | 33.8242 | 35.5564 | 260 | SRTM 30m / CAS | Verified |
| **ML-BBD-010** | الجمهور | Jamhour | Village | Mount Lebanon | Baabda | Wasat Baabda | Jamhour | Jamhour | 33.8414 | 35.5658 | 320 | SRTM 30m / DAG | Verified |
| **ML-BBD-011** | عاريا | Araya | Village | Mount Lebanon | Baabda | Wasat Baabda | Araya | Araya | 33.8367 | 35.5806 | 480 | SRTM 30m / CAS | Verified |
| **ML-BBD-012** | حمانا | Hammana | Town | Mount Lebanon | Baabda | Jabal al-Matn | Hammana | Hammana | 33.8292 | 35.7369 | 1180 | SRTM 30m / CAS | Verified |
| **ML-BBD-013** | فالوغا | Falougha | Village | Mount Lebanon | Baabda | Jabal al-Matn | Falougha \- Khalwat | Falougha | 33.8322 | 35.7511 | 1260 | SRTM 30m / CAS | Verified |
| **ML-BBD-014** | قرنايل | Qornayel | Village | Mount Lebanon | Baabda | Jabal al-Matn | Qornayel | Qornayel | 33.8569 | 35.7317 | 1120 | SRTM 30m / CAS | Verified |
| **ML-BBD-015** | بزبدين | Bzebdine | Village | Mount Lebanon | Baabda | Jabal al-Matn | Bzebdine | Bzebdine | 33.8583 | 35.6986 | 880 | SRTM 30m / CAS | Verified |
| **ML-BBD-016** | العبادية | Abadiyeh | Town | Mount Lebanon | Baabda | Wasat Baabda | Abadiyeh | Abadiyeh | 33.8306 | 35.6186 | 620 | SRTM 30m / CAS | Verified |
| **ML-BBD-017** | شويت | Chouit | Small Village | Mount Lebanon | Baabda | Wasat Baabda | Chouit | Chouit | 33.8447 | 35.5936 | 540 | SRTM 30m / CAS | High |
| **ML-BBD-018** | الكحالة | Kahale | Town | Mount Lebanon | Baabda | Wasat Baabda | Kahale | Kahale | 33.8267 | 35.5861 | 510 | SRTM 30m / CAS | Verified |
| **ML-BBD-019** | بتشاي | Betchay | Hamlet | Mount Lebanon | Baabda | Wasat Baabda | Betchay \- Mardacha | Betchay | 33.8389 | 35.5417 | 180 | SRTM 30m / CAS | High |
| **ML-BBD-020** | بسابا | Bsaba | Village | Mount Lebanon | Baabda | Wasat Baabda | Bsaba | Bsaba | 33.8183 | 35.5433 | 240 | SRTM 30m / CAS | Verified |
| **ML-MTN-001** | الجديدة | Jdeideh | City (Capital) | Mount Lebanon | Metn | Matn al-Saheli | Jdeideh \- Bouchrieh | Jdeidet el-Matn | 33.8867 | 35.5647 | 40 | SRTM 30m / CAS | Verified |
| **ML-MTN-002** | برج حمود | Bourj Hammoud | City Suburb | Mount Lebanon | Metn | Matn al-Saheli | Bourj Hammoud | Bourj Hammoud | 33.8936 | 35.5397 | 15 | SRTM 30m / CAS | Verified |
| **ML-MTN-003** | سن الفيل | Sin el-Fil | City Suburb | Mount Lebanon | Metn | Matn al-Saheli | Sin el-Fil | Sin el-Fil | 33.8744 | 35.5358 | 45 | SRTM 30m / CAS | Verified |
| **ML-MTN-004** | الدكوانة | Dekwaneh | Town | Mount Lebanon | Metn | Matn al-Saheli | Dekwaneh \- Mar Roukouz | Dekwaneh | 33.8808 | 35.5469 | 60 | SRTM 30m / CAS | Verified |
| **ML-MTN-005** | أنطلياس | Antelias | Town | Mount Lebanon | Metn | Matn al-Saheli | Antelias \- Naccache | Antelias | 33.9161 | 35.5878 | 20 | SRTM 30m / CAS | Verified |
| **ML-MTN-006** | الضبية | Dbayeh | Town | Mount Lebanon | Metn | Matn al-Saheli | Dbayeh \- Zouk el-Khrab | Dbayeh | 33.9406 | 35.5969 | 15 | SRTM 30m / CAS | Verified |
| **ML-MTN-007** | جل الديب | Jal el-Dib | Town | Mount Lebanon | Metn | Matn al-Saheli | Jal el-Dib \- Bkenneya | Jal el-Dib | 33.9067 | 35.5786 | 30 | SRTM 30m / CAS | Verified |
| **ML-MTN-008** | المنصورية | Mansourieh | Town | Mount Lebanon | Metn | Matn al-Awsat | Mansourieh \- Mkalles | Mansourieh | 33.8617 | 35.5681 | 280 | SRTM 30m / CAS | Verified |
| **ML-MTN-009** | بيت مري | Beit Mery | Town | Mount Lebanon | Metn | Matn al-Awsat | Beit Mery | Beit Mery | 33.8717 | 35.6022 | 720 | SRTM 30m / CAS | Verified |
| **ML-MTN-010** | برمانا | Broummana | Town | Mount Lebanon | Metn | Matn al-Awsat | Broummana | Broummana | 33.8864 | 35.6186 | 760 | SRTM 30m / CAS | Verified |
| **ML-MTN-011** | بعبدات | Baabdat | Town | Mount Lebanon | Metn | Matn al-Awsat | Baabdat | Baabdat | 33.8961 | 35.6517 | 850 | SRTM 30m / CAS | Verified |
| **ML-MTN-012** | بكفيا | Bikfaya | Town | Mount Lebanon | Metn | Matn al-Aala | Bikfaya \- Mhaydseh | Bikfaya | 33.9197 | 35.6881 | 920 | SRTM 30m / CAS | Verified |
| **ML-MTN-013** | ضهور الشوير | Dhour el-Choueir | Town | Mount Lebanon | Metn | Matn al-Aala | Choueir \- Ain Sendianeh | Choueir | 33.9114 | 35.7114 | 1180 | SRTM 30m / CAS | Verified |
| **ML-MTN-014** | بتغرين | Bteghrine | Village | Mount Lebanon | Metn | Matn al-Aala | Bteghrine | Bteghrine | 33.9264 | 35.7431 | 1050 | SRTM 30m / CAS | Verified |
| **ML-MTN-015** | بسكنتا | Baskinta | Town | Mount Lebanon | Metn | Matn al-Aala | Baskinta | Baskinta | 33.9486 | 35.7831 | 1340 | SRTM 30m / CAS | Verified |
| **ML-MTN-016** | بيت شباب | Beit Chabab | Town | Mount Lebanon | Metn | Matn al-Aala | Beit Chabab \- Chaouiye | Beit Chabab | 33.9236 | 35.6631 | 680 | SRTM 30m / CAS | Verified |
| **ML-MTN-017** | بصاليم | Bsalim | Village | Mount Lebanon | Metn | Matn al-Awsat | Bsalim \- Mezher | Bsalim | 33.9036 | 35.5978 | 240 | SRTM 30m / CAS | Verified |
| **ML-MTN-018** | عين سعادة | Ain Saadeh | Town | Mount Lebanon | Metn | Matn al-Awsat | Ain Saadeh | Ain Saadeh | 33.8744 | 35.5861 | 420 | SRTM 30m / CAS | Verified |
| **ML-MTN-019** | الفنار | Fanar | Town Suburb | Mount Lebanon | Metn | Matn al-Saheli | Fanar | Fanar | 33.8825 | 35.5714 | 160 | SRTM 30m / CAS | Verified |
| **ML-MTN-020** | الزعرور | Zaarour | Ski Resort Locality | Mount Lebanon | Metn | Matn al-Aala | Mrouj (Territory) | Mrouj | 33.9497 | 35.7986 | 1520 | SRTM 30m / DAG | High |
| **ML-CHF-001** | بيت الدين | Beiteddine | Town (Capital) | Mount Lebanon | Chouf | Chouf el-Awsat | Beiteddine | Beiteddine | 33.6953 | 35.5806 | 860 | SRTM 30m / CAS | Verified |
| **ML-CHF-002** | دير القمر | Deir el-Qamar | Historic Town | Mount Lebanon | Chouf | Chouf el-Awsat | Deir el-Qamar | Deir el-Qamar | 33.6983 | 35.5647 | 820 | SRTM 30m / CAS | Verified |
| **ML-CHF-003** | بعقلين | Baakline | Major Town | Mount Lebanon | Chouf | Chouf el-Awsat | Baakline | Baakline | 33.6821 | 35.5861 | 840 | SRTM 30m / CAS | Verified |
| **ML-CHF-004** | بقعاتا | Bakaata | Commercial Hub | Mount Lebanon | Chouf | Chouf el-Awsat / Aala | Jdeidet el-Chouf (Admin) | Jdeidet el-Chouf | 33.6738 | 35.6175 | 880 | SRTM 30m / Google | High |
| **ML-CHF-005** | جديدة الشوف | Jdeidet el-Chouf | Village | Mount Lebanon | Chouf | Chouf el-Awsat | Jdeidet el-Chouf | Jdeidet el-Chouf | 33.6686 | 35.6186 | 870 | SRTM 30m / CAS | Verified |
| **ML-CHF-006** | السمقانية | Semqanieh | Town | Mount Lebanon | Chouf | Chouf el-Awsat | Semqanieh | Semqanieh | 33.6781 | 35.6022 | 890 | SRTM 30m / CAS | Verified |
| **ML-CHF-007** | عين وزين | Ain Wazein | Village | Mount Lebanon | Chouf | Chouf el-Awsat | Ain Wzein | Ain Wzein | 33.6869 | 35.6133 | 960 | SRTM 30m / CAS | Verified |
| **ML-CHF-008** | الخريبة | Khraybeh (El-Khraibe) | Village | Mount Lebanon | Chouf | Chouf el-Aala | Khraybeh | Khraybeh | 33.6425 | 35.6486 | 1040 | SRTM 30m / CAS | Verified |
| **ML-CHF-009** | المختارة | Moukhtara | Town | Mount Lebanon | Chouf | Chouf el-Aala | Moukhtara | Moukhtara | 33.6558 | 35.6361 | 820 | SRTM 30m / CAS | Verified |
| **ML-CHF-010** | عماطور | Amatour | Village | Mount Lebanon | Chouf | Chouf el-Aala | Amatour | Amatour | 33.6331 | 35.6264 | 850 | SRTM 30m / CAS | Verified |
| **ML-CHF-011** | بعدران | Baadaran | Village | Mount Lebanon | Chouf | Chouf el-Aala | Baadaran | Baadaran | 33.6264 | 35.6381 | 1020 | SRTM 30m / CAS | Verified |
| **ML-CHF-012** | الباروك | Barouk | Town | Mount Lebanon | Chouf | Chouf el-Aala | Barouk \- Freydiss | Barouk | 33.7125 | 35.6786 | 1140 | SRTM 30m / CAS | Verified |
| **ML-CHF-013** | معاصر الشوف | Maasser el-Chouf | Village | Mount Lebanon | Chouf | Chouf el-Aala | Maasser el-Chouf | Maasser el-Chouf | 33.6617 | 35.6708 | 1200 | SRTM 30m / CAS | Verified |
| **ML-CHF-014** | باتر | Bater | Village | Mount Lebanon | Chouf | Chouf el-Aala | Bater | Bater | 33.5786 | 35.6086 | 820 | SRTM 30m / CAS | Verified |
| **ML-CHF-015** | نيحا الشوف | Niha Chouf | Village | Mount Lebanon | Chouf | Chouf el-Aala | Niha Chouf | Niha | 33.5897 | 35.6247 | 1080 | SRTM 30m / CAS | Verified |
| **ML-CHF-016** | جباع الشوف | Jbaa Chouf | Small Village | Mount Lebanon | Chouf | Chouf el-Aala | Jbaa | Jbaa | 33.6042 | 35.6435 | 1180 | SRTM 30m / CAS | Verified |
| **ML-CHF-017** | شحيم | Chhim | Major Town | Mount Lebanon | Chouf | Iqlim al-Kharroub | Chhim | Chhim | 33.6333 | 35.4833 | 520 | SRTM 30m / CAS | Verified |
| **ML-CHF-018** | برجا | Barja | Major Town | Mount Lebanon | Chouf | Iqlim al-Kharroub | Barja | Barja | 33.6522 | 35.4386 | 310 | SRTM 30m / CAS | Verified |
| **ML-CHF-019** | كترمايا | Ketermaya | Town | Mount Lebanon | Chouf | Iqlim al-Kharroub | Ketermaya | Ketermaya | 33.6256 | 35.4678 | 380 | SRTM 30m / CAS | Verified |
| **ML-CHF-020** | مزبود | Mazboud | Village | Mount Lebanon | Chouf | Iqlim al-Kharroub | Mazboud | Mazboud | 33.6242 | 35.4764 | 460 | SRTM 30m / CAS | Verified |
| **ML-CHF-021** | الدامور | Damour | Coastal Town | Mount Lebanon | Chouf | Chouf el-Saheli | Damour | Damour | 33.7314 | 35.4511 | 35 | SRTM 30m / CAS | Verified |
| **ML-CHF-022** | الجية | Jiyeh | Coastal Town | Mount Lebanon | Chouf | Chouf el-Saheli | Jiyeh | Jiyeh | 33.6653 | 35.4247 | 25 | SRTM 30m / CAS | Verified |
| **ML-CHF-023** | كفرحيم | Kfarhim | Village | Mount Lebanon | Chouf | Chouf el-Awsat | Kfarhim | Kfarhim | 33.7142 | 35.5386 | 580 | SRTM 30m / CAS | Verified |
| **ML-CHF-024** | كفرنبرخ | Kfar Nabrakh | Village | Mount Lebanon | Chouf | Chouf el-Awsat | Kfar Nabrakh | Kfar Nabrakh | 33.7153 | 35.6264 | 980 | SRTM 30m / CAS | Verified |
| **ML-CHF-025** | بتلون | Batloun | Village | Mount Lebanon | Chouf | Chouf el-Aala | Batloun | Batloun | 33.6936 | 35.6497 | 1050 | SRTM 30m / CAS | Verified |
| **ML-ALY-001** | عاليه | Aley | City (Capital) | Mount Lebanon | Aley | Al-Gharb al-Aala | Aley | Aley | 33.8067 | 35.5986 | 860 | SRTM 30m / CAS | Verified |
| **ML-ALY-002** | الشويفات | Choueifat | City | Mount Lebanon | Aley | Sahel Aley | Choueifat | Choueifat (Oumara/Qubba) | 33.8092 | 35.5186 | 80 | SRTM 30m / CAS | Verified |
| **ML-ALY-003** | خلدة | Khalde | Commercial Strip | Mount Lebanon | Aley | Sahel Aley | Choueifat (Admin) | Choueifat | 33.7856 | 35.4831 | 15 | SRTM 30m / CAS | High |
| **ML-ALY-004** | عرمون (الدوحة) | Aramoun (Dawha) | Suburban Town | Mount Lebanon | Aley | Sahel Aley / Foothills | Aramoun | Aramoun | 33.7714 | 35.5036 | 280 | SRTM 30m / CAS | Verified |
| **ML-ALY-005** | بشامون | Bchamoun | Suburban Town | Mount Lebanon | Aley | Sahel Aley / Foothills | Bchamoun | Bchamoun | 33.7878 | 35.5197 | 320 | SRTM 30m / CAS | Verified |
| **ML-ALY-006** | سوق الغرب | Souk el-Gharb | Town | Mount Lebanon | Aley | Al-Gharb al-Aala | Souk el-Gharb | Souk el-Gharb | 33.7911 | 35.5786 | 760 | SRTM 30m / CAS | Verified |
| **ML-ALY-007** | بحمدون الضيعة | Bhamdoun Village | Village | Mount Lebanon | Aley | Jurd Aley | Bhamdoun el-Dayaa | Bhamdoun | 33.7986 | 35.6517 | 1050 | SRTM 30m / CAS | Verified |
| **ML-ALY-008** | بحمدون المحطة | Bhamdoun Station | Commercial Resort | Mount Lebanon | Aley | Jurd Aley | Bhamdoun el-Mhatta | Bhamdoun | 33.8094 | 35.6539 | 1120 | SRTM 30m / CAS | Verified |
| **ML-ALY-009** | صوفر | Sofar | Mountain Resort | Mount Lebanon | Aley | Jurd Aley | Sofar | Sofar | 33.8058 | 35.6961 | 1280 | SRTM 30m / CAS | Verified |
| **ML-ALY-010** | عين دارة | Ain Dara | Village | Mount Lebanon | Aley | Jurd Aley | Ain Dara | Ain Dara | 33.7978 | 35.7314 | 1310 | SRTM 30m / CAS | Verified |
| **KJ-KES-001** | جونيه | Jounieh | City (Capital) | Keserwan-Jbeil | Keserwan | Keserwan al-Saheli | Jounieh | Jounieh (Ghadir/Sarba) | 33.9814 | 35.6178 | 20 | SRTM 30m / CAS | Verified |
| **KJ-KES-002** | الكسليك | Kaslik | Commercial Quarter | Keserwan-Jbeil | Keserwan | Keserwan al-Saheli | Jounieh (Admin) | Jounieh | 33.9786 | 35.6111 | 15 | SRTM 30m / DAG | High |
| **KJ-KES-003** | ذوق مكايل | Zouk Mikael | Town | Keserwan-Jbeil | Keserwan | Keserwan al-Saheli | Zouk Mikael | Zouk Mikael | 33.9631 | 35.6264 | 110 | SRTM 30m / CAS | Verified |
| **KJ-KES-004** | ذوق مصبح | Zouk Mosbeh | Town | Keserwan-Jbeil | Keserwan | Keserwan al-Saheli | Zouk Mosbeh | Zouk Mosbeh | 33.9556 | 35.6317 | 90 | SRTM 30m / CAS | Verified |
| **KJ-KES-005** | حريصا | Harissa | Religious Center | Keserwan-Jbeil | Keserwan | Al-Ftouh Ridge | Daraoun \- Harissa | Daraoun | 33.9825 | 35.6514 | 620 | SRTM 30m / CAS | Verified |
| **KJ-KES-006** | درعون | Daraoun | Village | Keserwan-Jbeil | Keserwan | Al-Ftouh Ridge | Daraoun \- Harissa | Daraoun | 33.9867 | 35.6617 | 640 | SRTM 30m / CAS | Verified |
| **KJ-KES-007** | غزير | Ghazir | Town | Keserwan-Jbeil | Keserwan | Al-Ftouh | Ghazir | Ghazir | 34.0167 | 35.6639 | 360 | SRTM 30m / CAS | Verified |
| **KJ-KES-008** | عجلتون | Ajaltoun | Town | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Ajaltoun | Ajaltoun | 33.9686 | 35.6886 | 860 | SRTM 30m / CAS | Verified |
| **KJ-KES-009** | ريفون | Rayfoun | Town | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Rayfoun | Rayfoun | 33.9806 | 35.7061 | 980 | SRTM 30m / CAS | Verified |
| **KJ-KES-010** | فيطرون | Feytroun | Town | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Feytroun | Feytroun | 33.9936 | 35.7369 | 1220 | SRTM 30m / CAS | Verified |
| **KJ-KES-011** | ميروبا | Mayrouba | Village | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Mayrouba | Mayrouba | 34.0206 | 35.7667 | 1310 | SRTM 30m / CAS | Verified |
| **KJ-KES-012** | حراجل | Hrajel | Town | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Hrajel | Hrajel | 34.0175 | 35.7867 | 1360 | SRTM 30m / CAS | Verified |
| **KJ-KES-013** | فاريا | Faraya | Mountain Resort | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Faraya | Faraya | 34.0125 | 35.8139 | 1320 | SRTM 30m / CAS | Verified |
| **KJ-KES-014** | كفرذبيان | Kfardebian | Mountain Town | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Kfardebian | Kfardebian | 33.9986 | 35.8286 | 1260 | SRTM 30m / CAS | Verified |
| **KJ-KES-015** | فقرا | Faqra | Resort Club Loc. | Keserwan-Jbeil | Keserwan | Keserwan al-Jurd | Kfardebian (Admin) | Kfardebian | 33.9972 | 35.8083 | 1580 | SRTM 30m / DAG | High |
| **KJ-JBL-001** | جبيل (بيبلوس) | Byblos (Jbeil) | City (Capital) | Keserwan-Jbeil | Jbeil | Sahel Jbeil | Jbeil | Jbeil | 34.1222 | 35.6481 | 15 | SRTM 30m / CAS | Verified |
| **KJ-JBL-002** | عمشيت | Amchit | Coastal Town | Keserwan-Jbeil | Jbeil | Sahel Jbeil | Amchit | Amchit | 34.1486 | 35.6444 | 40 | SRTM 30m / CAS | Verified |
| **KJ-JBL-003** | حالات | Halat | Coastal Town | Keserwan-Jbeil | Jbeil | Sahel Jbeil | Halat | Halat | 34.0886 | 35.6492 | 50 | SRTM 30m / CAS | Verified |
| **KJ-JBL-004** | نهر إبراهيم | Nahr Ibrahim | Coastal Town | Keserwan-Jbeil | Jbeil | Sahel Jbeil | Nahr Ibrahim | Nahr Ibrahim | 34.0667 | 35.6417 | 25 | SRTM 30m / CAS | Verified |
| **KJ-JBL-005** | عنايا (كفربعل) | Annaya (Kfar Baal) | Pilgrimage Hub | Keserwan-Jbeil | Jbeil | Jbeil Wasat | Annaya \- Kfar Baal | Annaya | 34.1444 | 35.7333 | 960 | SRTM 30m / CAS | Verified |
| **KJ-JBL-006** | إهمج | Ehmej | Village | Keserwan-Jbeil | Jbeil | Jbeil Jurd | Ehmej | Ehmej | 34.1386 | 35.7867 | 1180 | SRTM 30m / CAS | Verified |
| **KJ-JBL-007** | قرطبا | Qartaba | Major Town | Keserwan-Jbeil | Jbeil | Adonis Valley Jurd | Qartaba | Qartaba | 34.0936 | 35.8456 | 1220 | SRTM 30m / CAS | Verified |
| **KJ-JBL-008** | العاقورة | Aqoura | Mountain Town | Keserwan-Jbeil | Jbeil | Jbeil Jurd | Aqoura | Aqoura | 34.1358 | 35.9011 | 1480 | SRTM 30m / CAS | Verified |
| **KJ-JBL-009** | اللقلوق | Laqlouq | Ski Resort Loc. | Keserwan-Jbeil | Jbeil | Jbeil Jurd | Laqlouq | Laqlouq | 34.1492 | 35.8647 | 1720 | SRTM 30m / DAG | High |
| **KJ-JBL-010** | أفقا | Afqa | Village | Keserwan-Jbeil | Jbeil | Adonis Valley Jurd | Afqa | Afqa | 34.0694 | 35.8942 | 1250 | SRTM 30m / CAS | Verified |
| **NL-TRP-001** | طرابلس | Tripoli | City (Capital) | North Lebanon | Tripoli | Sahel Tripoli | Tripoli | Tripoli (Baddawi/Zahrieh) | 34.4367 | 35.8497 | 20 | SRTM 30m / CAS | Verified |
| **NL-TRP-002** | الميناء | Al-Mina | Coastal City | North Lebanon | Tripoli | Sahel Tripoli | Al-Mina | Al-Mina | 34.4481 | 35.8197 | 5 | SRTM 30m / CAS | Verified |
| **NL-TRP-003** | البداوي | Beddawi | Industrial Town | North Lebanon | Tripoli | Sahel Tripoli | Beddawi \- Wadi Nahle | Beddawi | 34.4556 | 35.8686 | 40 | SRTM 30m / CAS | Verified |
| **NL-TRP-004** | القلمون | Al-Qalamoun | Coastal Town | North Lebanon | Tripoli | Sahel Tripoli | Al-Qalamoun | Al-Qalamoun | 34.3878 | 35.7878 | 15 | SRTM 30m / CAS | Verified |
| **NL-KOU-001** | أميون | Amioun | Town (Capital) | North Lebanon | Koura | Hadabat al-Koura | Amioun | Amioun | 34.3017 | 35.8106 | 360 | SRTM 30m / CAS | Verified |
| **NL-KOU-002** | كوسبا | Kousba | Town | North Lebanon | Koura | Hadabat al-Koura | Kousba | Kousba | 34.2986 | 35.8569 | 310 | SRTM 30m / CAS | Verified |
| **NL-KOU-003** | بشمزين | Bishmizzine | Village | North Lebanon | Koura | Hadabat al-Koura | Bishmizzine | Bishmizzine | 34.3264 | 35.8186 | 280 | SRTM 30m / CAS | Verified |
| **NL-KOU-004** | أنفه | Enfeh | Coastal Town | North Lebanon | Koura | Sahel Koura | Enfeh | Enfeh | 34.3544 | 35.7333 | 10 | SRTM 30m / CAS | Verified |
| **NL-BAT-001** | البترون | Batroun | City (Capital) | North Lebanon | Batroun | Sahel al-Batroun | Batroun | Batroun | 34.2547 | 35.6586 | 15 | SRTM 30m / CAS | Verified |
| **NL-BAT-002** | شكا | Chekka | Coastal Industrial | North Lebanon | Batroun | Sahel al-Batroun | Chekka | Chekka | 34.3317 | 35.7278 | 25 | SRTM 30m / CAS | Verified |
| **NL-BAT-003** | حامات | Hamat | Village | North Lebanon | Batroun | Sahel Promontory | Hamat | Hamat | 34.2961 | 35.7006 | 280 | SRTM 30m / CAS | Verified |
| **NL-BAT-004** | دوما | Douma | Heritage Town | North Lebanon | Batroun | Jurd al-Batroun | Douma | Douma | 34.2181 | 35.8456 | 1020 | SRTM 30m / CAS | Verified |
| **NL-BAT-005** | تنورين الفوقا | Tannourine el-Faouqa | Mountain Town | North Lebanon | Batroun | Jurd al-Batroun | Tannourine | Tannourine | 34.2114 | 35.9286 | 1480 | SRTM 30m / CAS | Verified |
| **NL-BSC-001** | بشري | Bcharre | Town (Capital) | North Lebanon | Bcharre | Jebbet Bcharre | Bcharre | Bcharre | 34.2506 | 36.0117 | 1450 | SRTM 30m / CAS | Verified |
| **NL-BSC-002** | بقاع كفرا | Bqaa Kafra | Mountain Village | North Lebanon | Bcharre | Jebbet Bcharre | Bqaa Kafra | Bqaa Kafra | 34.2403 | 36.0028 | 1650 | SRTM 30m / CAS | Verified |
| **NL-BSC-003** | حدشيت | Hadchit | Village | North Lebanon | Bcharre | Jebbet Bcharre | Hadchit | Hadchit | 34.2567 | 35.9817 | 1380 | SRTM 30m / CAS | Verified |
| **NL-BSC-004** | حصرون | Hasroun | Village | North Lebanon | Bcharre | Jebbet Bcharre | Hasroun | Hasroun | 34.2436 | 35.9686 | 1420 | SRTM 30m / CAS | Verified |
| **NL-BSC-005** | الأرز | The Cedars (Al-Arz) | Mountain Resort | North Lebanon | Bcharre | Jebbet Bcharre | Bcharre (Admin) | Bcharre | 34.2431 | 36.0558 | 1920 | SRTM 30m / DAG | High |
| **NL-ZGH-001** | زغرتا | Zgharta | City (Capital) | North Lebanon | Zgharta | Wasat Zgharta | Zgharta \- Ehden | Zgharta | 34.3986 | 35.8956 | 130 | SRTM 30m / CAS | Verified |
| **NL-ZGH-002** | إهدن | Ehden | Alpine Town | North Lebanon | Zgharta | Jurd Zgharta | Zgharta \- Ehden | Ehden | 34.2936 | 35.9844 | 1520 | SRTM 30m / CAS | Verified |
| **NL-ZGH-003** | مجدليا | Mejdlaya | Suburban Town | North Lebanon | Zgharta | Wasat Zgharta | Mejdlaya | Mejdlaya | 34.4178 | 35.8756 | 150 | SRTM 30m / CAS | Verified |
| **NL-MIN-001** | المنية | Minieh | City (Capital) | North Lebanon | Minieh-Dan. | Sahel al-Minieh | Minieh | Minieh | 34.4842 | 35.9086 | 35 | SRTM 30m / CAS | Verified |
| **NL-MIN-002** | سير الضنية | Sir el-Dannieh | Town | North Lebanon | Minieh-Dan. | Jurd Dannieh | Sir el-Dannieh | Sir el-Dannieh | 34.3886 | 36.0336 | 980 | SRTM 30m / CAS | Verified |
| **NL-MIN-003** | بخعون | Bakhoun | Town | North Lebanon | Minieh-Dan. | Jurd Dannieh | Bakhoun | Bakhoun | 34.4142 | 35.9892 | 820 | SRTM 30m / CAS | Verified |
| **AK-AKR-001** | حلبا | Halba | City (Capital) | Akkar | Akkar | Al-Joumeh Margin | Halba | Halba | 34.5422 | 36.0797 | 180 | SRTM 30m / CAS | Verified |
| **AK-AKR-002** | ببنين | Bebnine | Major Town | Akkar | Akkar | Sahel Akkar | Bebnine \- Abdeh | Bebnine | 34.5264 | 35.9897 | 80 | SRTM 30m / CAS | Verified |
| **AK-AKR-003** | برقايل | Berkayel | Major Town | Akkar | Akkar | Qora al-Qaytaa | Berkayel | Berkayel | 34.5086 | 36.0317 | 240 | SRTM 30m / CAS | Verified |
| **AK-AKR-004** | القبيات | Kobayat (Al-Qobayat) | Major Town | Akkar | Akkar | Al-Drayb | Al-Qobayat | Al-Qobayat | 34.5681 | 36.2758 | 680 | SRTM 30m / CAS | Verified |
| **AK-AKR-005** | فنيدق | Fnaydek | Town | Akkar | Akkar | Jurd al-Qaytaa | Fnaydek | Fnaydek | 34.4697 | 36.1764 | 1180 | SRTM 30m / CAS | Verified |
| **BQ-ZAH-001** | زحلة | Zahle | City (Capital) | Beqaa | Zahle | Wasat Zahle | Zahle \- Maalaka | Zahle | 33.8467 | 35.9022 | 1020 | SRTM 30m / CAS | Verified |
| **BQ-ZAH-002** | شتورا | Chtaura | Commercial Hub | Beqaa | Zahle | Sahel Zahle | Chtaura | Chtaura | 33.8186 | 35.8542 | 920 | SRTM 30m / CAS | Verified |
| **BQ-ZAH-003** | بر الياس | Bar Elias | Town | Beqaa | Zahle | Sahel Zahle | Bar Elias | Bar Elias | 33.7714 | 35.9186 | 880 | SRTM 30m / CAS | Verified |
| **BQ-ZAH-004** | سعدنايل | Saadnayel | Town | Beqaa | Zahle | Sahel Zahle | Saadnayel | Saadnayel | 33.8292 | 35.8786 | 900 | SRTM 30m / CAS | Verified |
| **BQ-WBO-001** | جب جنين | Joub Jannine | Town (Capital) | Beqaa | West Beqaa | Sahl al-Litani | Joub Jannine | Joub Jannine | 33.6314 | 35.7867 | 890 | SRTM 30m / CAS | Verified |
| **BQ-WBO-002** | صغبين | Saghbine | Village (Capital) | Beqaa | West Beqaa | Barouk Escarpment | Saghbine | Saghbine | 33.6067 | 35.7006 | 1040 | SRTM 30m / CAS | Verified |
| **BQ-WBO-003** | القرعون | Qaraoun | Town | Beqaa | West Beqaa | Bohayrat Qaraoun | Qaraoun | Qaraoun | 33.5686 | 35.7197 | 910 | SRTM 30m / CAS | Verified |
| **BQ-RAS-001** | راشيا الوادي | Rashaya el-Wadi | Town (Capital) | Beqaa | Rashaya | Jabal el-Sheikh | Rashaya | Rashaya el-Wadi | 33.5017 | 35.8456 | 1240 | SRTM 30m / CAS | Verified |
| **BQ-RAS-002** | ضهر الأحمر | Dahr el-Ahmar | Commercial Town | Beqaa | Rashaya | Sahl Rashaya | Dahr el-Ahmar | Dahr el-Ahmar | 33.5358 | 35.8317 | 1050 | SRTM 30m / CAS | Verified |
| **BH-BAL-001** | بعلبك | Baalbek | City (Capital) | Baalbek-Hermel | Baalbek | Sahel Baalbek | Baalbek | Baalbek | 34.0058 | 36.2081 | 1180 | SRTM 30m / CAS | Verified |
| **BH-BAL-002** | دورس | Douris | Town | Baalbek-Hermel | Baalbek | Sahel Baalbek | Douris | Douris | 33.9856 | 36.1786 | 1150 | SRTM 30m / CAS | Verified |
| **BH-BAL-003** | شمسطار | Chmestar | Town | Baalbek-Hermel | Baalbek | Gharbi Baalbek | Chmestar \- Gharbi | Chmestar | 33.9286 | 36.0097 | 1100 | SRTM 30m / CAS | Verified |
| **BH-BAL-004** | دير الأحمر | Deir el-Ahmar | Town | Baalbek-Hermel | Baalbek | Gharbi Baalbek | Deir el-Ahmar | Deir el-Ahmar | 34.1264 | 36.1264 | 1080 | SRTM 30m / CAS | Verified |
| **BH-BAL-005** | عرسال | Arsal | High Mountain Town | Baalbek-Hermel | Baalbek | Arsal Highlands | Arsal | Arsal | 34.1786 | 36.4217 | 1520 | SRTM 30m / CAS | Verified |
| **BH-HER-001** | الهرمل | Hermel | City (Capital) | Baalbek-Hermel | Hermel | Assi River Basin | Hermel | Hermel | 34.3986 | 36.3867 | 780 | SRTM 30m / CAS | Verified |
| **BH-HER-002** | القاع | Al-Qaa | Border Oasis Town | Baalbek-Hermel | Hermel/Baalb. | Northern Graben | Al-Qaa | Al-Qaa | 34.3542 | 36.4786 | 690 | SRTM 30m / CAS | Verified |
| **SL-SID-001** | صيدا | Sidon (Saida) | City (Capital) | South Lebanon | Sidon | Saida al-Hadariyya | Sidon | Saida | 33.5631 | 35.3689 | 15 | SRTM 30m / CAS | Verified |
| **SL-SID-002** | الغازية | Ghazieh | Coastal Town | South Lebanon | Sidon | Sahel al-Zahrani | Ghazieh | Ghazieh | 33.5186 | 35.3647 | 35 | SRTM 30m / CAS | Verified |
| **SL-SID-003** | مغدوشة | Maghdouche | Town | South Lebanon | Sidon | Hadabat Saida | Maghdouche | Maghdouche | 33.5264 | 35.3942 | 230 | SRTM 30m / CAS | Verified |
| **SL-TYR-001** | صور | Tyre (Sour) | City (Capital) | South Lebanon | Tyre | Sahel Sour | Tyre | Sour | 33.2733 | 35.1939 | 10 | SRTM 30m / CAS | Verified |
| **SL-TYR-002** | العباسية | Abbassieh | Town | South Lebanon | Tyre | Sahel Sour | Abbassieh | Abbassieh | 33.3086 | 35.2386 | 90 | SRTM 30m / CAS | Verified |
| **SL-TYR-003** | قانا | Qana | Town | South Lebanon | Tyre | Jabal Amel Uplands | Qana | Qana | 33.2086 | 35.3022 | 310 | SRTM 30m / CAS | Verified |
| **SL-TYR-004** | الناقورة | Naqoura | Border Port Town | South Lebanon | Tyre | Al-Sahel al-Janoubi | Naqoura | Naqoura | 33.1186 | 35.1386 | 40 | SRTM 30m / CAS | Verified |
| **SL-JZZ-001** | جزين | Jezzine | Town (Capital) | South Lebanon | Jezzine | Hwd Jezzine | Jezzine \- Ain Majdaleyn | Jezzine | 33.5417 | 35.5833 | 980 | SRTM 30m / CAS | Verified |
| **SL-JZZ-002** | بكاسين | Bkassine | Village | South Lebanon | Jezzine | Horsh Bkassine | Bkassine | Bkassine | 33.5597 | 35.5686 | 840 | SRTM 30m / CAS | Verified |
| **NA-NAB-001** | النبطية التحتا | Nabatieh el-Tahta | City (Capital) | Nabatieh | Nabatieh | Hwd Nabatieh | Nabatieh el-Tahta | Nabatieh el-Tahta | 33.3789 | 35.4839 | 430 | SRTM 30m / CAS | Verified |
| **NA-NAB-002** | كفررمان | Kfar Remen | Town | Nabatieh | Nabatieh | Hwd Nabatieh | Kfar Remen | Kfar Remen | 33.3917 | 35.4986 | 490 | SRTM 30m / CAS | Verified |
| **NA-NAB-003** | حبوش | Habbouch | Town | Nabatieh | Nabatieh | Hwd Nabatieh | Habbouch | Habbouch | 33.4142 | 35.5036 | 410 | SRTM 30m / CAS | Verified |
| **NA-BNT-001** | بنت جبيل | Bint Jbeil | Town (Capital) | Nabatieh | Bint Jbeil | Jabal Amel Central | Bint Jbeil | Bint Jbeil | 33.1206 | 35.4336 | 790 | SRTM 30m / CAS | Verified |
| **NA-BNT-002** | تبنين | Tebnine | Town | Nabatieh | Bint Jbeil | Jabal Amel Central | Tebnine | Tebnine | 33.1936 | 35.4106 | 720 | SRTM 30m / CAS | Verified |
| **NA-BNT-003** | عين إبل | Ain Ebel | Village | Nabatieh | Bint Jbeil | Jabal Amel Central | Ain Ebel | Ain Ebel | 33.1097 | 35.4086 | 780 | SRTM 30m / CAS | Verified |
| **NA-BNT-004** | رميش | Rmeich | Border Town | Nabatieh | Bint Jbeil | Al-Hadd al-Gharbi | Rmeich | Rmeich | 33.0858 | 35.3856 | 610 | SRTM 30m / CAS | Verified |
| **NA-MAR-001** | مرجعيون (جديدة) | Marjeyoun (Jdeidet) | Town (Capital) | Nabatieh | Marjeyoun | Sahl Marjeyoun | Jdeidet Marjeyoun | Marjeyoun | 33.3606 | 35.5906 | 760 | SRTM 30m / CAS | Verified |
| **NA-MAR-002** | الخيام | Khiam (Al-Khiam) | Town | Nabatieh | Marjeyoun | Sahl Marjeyoun | Al-Khiam | Al-Khiam | 33.3186 | 35.6086 | 720 | SRTM 30m / CAS | Verified |
| **NA-MAR-003** | ميس الجبل | Meiss el-Jabal | Town | Nabatieh | Marjeyoun | Meiss Eastern Escarp. | Meiss el-Jabal | Meiss el-Jabal | 33.1961 | 35.5186 | 710 | SRTM 30m / CAS | Verified |
| **NA-HAS-001** | حاصبيا | Hasbaya | Town (Capital) | Nabatieh | Hasbaya | Wadi el-Taym | Hasbaya | Hasbaya | 33.3986 | 35.6847 | 760 | SRTM 30m / CAS | Verified |
| **NA-HAS-002** | شبعا | Chebaa | Mountain Town | Nabatieh | Hasbaya | Al-Arqoub | Chebaa | Chebaa | 33.3639 | 35.7597 | 1280 | SRTM 30m / CAS | Verified |

## **Relational Proximity Matrix and Commercial Hub Connectivity**

To eliminate the computational overhead of generating an all-to-all spatial matrix across thousands of localities, relational connectivity is established through immediate neighborhood linkages and regional commercial hub assignments. In operational logistics, orders are fulfilled either locally within an immediate village cluster or via dispatch corridors connecting peripheral villages to central market towns.  
The matrix below documents the nearest and second-nearest neighboring localities calculated via geodesic Haversine distance, cross-referenced with primary commercial centers and estimated driving distances. Straight-line distances reflect geodetic calculations between centroid coordinates, while road distances and driving times incorporate surface network topologies, tortuosity adjustments, and elevation profiles.

| Locality Name | Nearest Locality | Straight-Line (km) | Method | Second Nearest Locality | Straight-Line (km) | Nearest Commercial Center | Road Distance (km) | Est. Driving Time |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Hamra (Beirut)** | Ras Beirut | 0.45 | Haversine | Ain el-Mreisseh | 0.62 | Hamra Commercial Corridor | 0.0 | Immediate |
| **Achrafieh (Beirut)** | Rmeil (Mar Mikhael) | 0.72 | Haversine | Badaro | 1.44 | Sassine Square Hub | 0.0 | Immediate |
| **Baabda** | Hazmieh | 1.62 | Haversine | Louaizeh | 1.48 | Hazmieh Commercial Hub | 2.1 | 5 – 8 min |
| **Hazmieh** | Furn el-Chebbak | 1.34 | Haversine | Baabda | 1.62 | Hazmieh Center | 0.0 | Immediate |
| **Haret Hreik** | Bourj el-Barajneh | 1.25 | Haversine | Ghobeiry | 1.15 | Haret Hreik Market Core | 0.0 | Immediate |
| **Hammana** | Falougha | 1.35 | Haversine | Bchetefyeh | 2.10 | Hammana Souk Core | 0.0 | Immediate |
| **Falougha** | Hammana | 1.35 | Haversine | Qornayel | 3.32 | Hammana Commercial Hub | 2.5 | 6 – 9 min |
| **Jdeideh (Metn)** | Bouchrieh | 0.85 | Haversine | Sin el-Fil | 1.78 | CityMall / Dora Hub | 1.5 | 4 – 8 min |
| **Antelias** | Jal el-Dib | 1.38 | Haversine | Dbayeh | 2.85 | Antelias Central Square | 0.0 | Immediate |
| **Broummana** | Beit Mery | 2.22 | Haversine | Baabdat | 3.24 | Broummana Commercial Strip | 0.0 | Immediate |
| **Bikfaya** | Mhaydseh | 0.52 | Haversine | Beit Chabab | 2.38 | Bikfaya Central Souk | 0.0 | Immediate |
| **Baskinta** | Bteghrine | 4.41 | Haversine | Zaarour | 4.80 | Baskinta Village Core | 0.0 | Immediate |
| **Baakline (Chouf)** | Semqanieh | 1.55 | Haversine | Beiteddine | 1.55 | Baakline Commercial Core | 0.0 | Immediate |
| **Bakaata (Chouf)** | Semqanieh | 1.49 | Haversine | Ain Wazein | 1.51 | Bakaata Central Market Core | 0.0 | Immediate |
| **Semqanieh (Chouf)** | Ain Wazein | 1.42 | Haversine | Bakaata | 1.49 | Bakaata Commercial Hub | 1.9 | 4 – 6 min |
| **Ain Wazein (Chouf)** | Semqanieh | 1.42 | Haversine | Bakaata | 1.51 | Bakaata Commercial Hub | 2.0 | 4 – 6 min |
| **Khraybeh (Chouf)** | Moukhtara | 1.88 | Haversine | Amatour | 2.31 | Bakaata Commercial Hub | 6.8 | 12 – 16 min |
| **Moukhtara (Chouf)** | Khraybeh | 1.88 | Haversine | Bakaata | 2.64 | Bakaata Commercial Hub | 3.5 | 7 – 10 min |
| **Amatour (Chouf)** | Baadaran | 1.32 | Haversine | Khraybeh | 2.31 | Bakaata Commercial Hub | 6.5 | 12 – 15 min |
| **Baadaran (Chouf)** | Amatour | 1.32 | Haversine | Haret Jandal | 1.60 | Bakaata Commercial Hub | 7.8 | 14 – 18 min |
| **Deir el-Qamar** | Beiteddine | 1.51 | Haversine | Baakline | 2.68 | Deir el-Qamar Souk | 0.0 | Immediate |
| **Beiteddine** | Deir el-Qamar | 1.51 | Haversine | Baakline | 1.55 | Baakline / Beiteddine Core | 2.5 | 5 – 7 min |
| **Barouk** | Batloun | 3.42 | Haversine | Maasser el-Chouf | 5.70 | Baakline / Bakaata Hub | 8.5 | 14 – 18 min |
| **Chhim (Iqlim)** | Mazboud | 1.22 | Haversine | Ketermaya | 1.68 | Chhim Central Market Core | 0.0 | Immediate |
| **Barja (Iqlim)** | Jiyeh | 2.05 | Haversine | Baasir | 2.45 | Barja Commercial Center | 0.0 | Immediate |
| **Damour** | Naameh | 3.82 | Haversine | Saadiyat | 3.20 | Damour Commercial Strip | 0.0 | Immediate |
| **Aley** | Souk el-Gharb | 2.35 | Haversine | Bhamdoun Village | 4.95 | Aley Central Souk / Saray | 0.0 | Immediate |
| **Bhamdoun Mhatta** | Bhamdoun Dayaa | 1.22 | Haversine | Sofar | 3.92 | Bhamdoun Station Core | 0.0 | Immediate |
| **Sofar** | Bhamdoun Mhatta | 3.92 | Haversine | Ain Dara | 3.40 | Sofar Highway Market Core | 0.0 | Immediate |
| **Jounieh** | Kaslik | 0.72 | Haversine | Sarba | 0.85 | Jounieh / Kaslik Center | 0.0 | Immediate |
| **Harissa** | Daraoun | 1.05 | Haversine | Ghosta | 2.40 | Jounieh Littoral Core | 8.4 | 18 – 24 min |
| **Ghazir** | Kfarhbab | 1.45 | Haversine | Dlebta | 2.85 | Ghazir Central Square | 0.0 | Immediate |
| **Rayfoun** | Ajaltoun | 2.05 | Haversine | Feytroun | 3.22 | Rayfoun / Ajaltoun Spine | 0.0 | Immediate |
| **Faraya** | Hrajel | 2.58 | Haversine | Kfardebian | 2.05 | Faraya Village Square | 0.0 | Immediate |
| **Kfardebian** | Faqra | 1.88 | Haversine | Faraya | 2.05 | Faraya / Kfardebian Hub | 3.2 | 6 – 9 min |
| **Byblos (Jbeil)** | Amchit | 3.02 | Haversine | Blat | 1.85 | Byblos Central Commercial Core | 0.0 | Immediate |
| **Qartaba** | Mazraat es-Siyad | 2.85 | Haversine | Yanouh | 3.10 | Qartaba Regional Souk | 0.0 | Immediate |
| **Tripoli** | Al-Mina | 2.95 | Haversine | Beddawi | 2.75 | Al-Tell / Tripoli Center | 0.0 | Immediate |
| **Amioun** | Bishmizzine | 2.85 | Haversine | Kousba | 4.30 | Amioun Commercial Core | 0.0 | Immediate |
| **Batroun** | Kfarabida | 3.10 | Haversine | Chekka | 8.80 | Batroun Old Souk / Highway | 0.0 | Immediate |
| **Douma** | Bchaaleh | 2.45 | Haversine | Tannourine Tahta | 4.20 | Douma Historic Souk | 0.0 | Immediate |
| **Bcharre** | Bqaa Kafra | 1.42 | Haversine | Hadchit | 2.85 | Bcharre Commercial Core | 0.0 | Immediate |
| **Bqaa Kafra** | Bcharre | 1.42 | Haversine | Hasroun | 3.18 | Bcharre Commercial Core | 3.0 | 8 – 11 min |
| **Ehden** | Zgharta | 14.50 | Haversine | Bcharre | 7.80 | Ehden Midan Core | 0.0 | Immediate |
| **Sir el-Dannieh** | Bakhoun | 4.95 | Haversine | Asoun | 2.40 | Sir el-Dannieh Center | 0.0 | Immediate |
| **Halba (Akkar)** | Bebnine | 5.20 | Haversine | Cheikh Mohammad | 1.85 | Halba Central Market Core | 0.0 | Immediate |
| **Zahle** | Saadnayel | 3.10 | Haversine | Qaa el-Rim | 4.25 | Boulevard Zahle Core | 0.0 | Immediate |
| **Chtaura** | Saadnayel | 2.55 | Haversine | Jdita | 1.45 | Chtaura Crossroads Hub | 0.0 | Immediate |
| **Joub Jannine** | Ghazze | 3.12 | Haversine | Kamid el-Loz | 3.40 | Joub Jannine Regional Hub | 0.0 | Immediate |
| **Baalbek** | Douris | 3.55 | Haversine | Iaat | 4.85 | Baalbek Roman Core / Souk | 0.0 | Immediate |
| **Hermel** | Chawaghir | 3.80 | Haversine | Al-Qaa | 14.20 | Hermel Commercial Center | 0.0 | Immediate |
| **Sidon (Saida)** | Ghazieh | 5.05 | Haversine | Hilaliyeh | 1.95 | Nejmeh Square / Saida Core | 0.0 | Immediate |
| **Tyre (Sour)** | Bourj el-Chmali | 3.20 | Haversine | Abbassieh | 5.50 | Tyre Port / Commercial Spine | 0.0 | Immediate |
| **Jezzine** | Bkassine | 2.45 | Haversine | Roum | 5.10 | Jezzine Central Souk | 0.0 | Immediate |
| **Nabatieh el-Tahta** | Kfar Remen | 1.95 | Haversine | Habbouch | 4.25 | Nabatieh Hassan Kamel Core | 0.0 | Immediate |
| **Bint Jbeil** | Ain Ebel | 2.65 | Haversine | Aitaroun | 4.10 | Bint Jbeil Saff el-Hawa Core | 0.0 | Immediate |
| **Marjeyoun** | Khiam | 4.90 | Haversine | Qlaiaa | 2.15 | Marjeyoun Saray Square | 0.0 | Immediate |
| **Hasbaya** | Ain Qanya | 2.85 | Haversine | Chebaa | 7.95 | Hasbaya Chehabi Citadel Core | 0.0 | Immediate |

## **Discrepancy Reconciliation and Anomaly Resolution Audit**

Spatial data conflicts in Lebanon stem from differences between administrative decrees, cadastral boundaries, and everyday commercial usage. A robust geospatial gazetteer must resolve these ambiguities systematically, ensuring that physical delivery destinations are neither omitted due to administrative consolidation nor duplicated under transliteration variants.  
The audit table below presents the legal, geodetic, and functional resolution for key contested entities, clarifying the operational decisions required for reliable order routing.

| Entity Toponym | Arabic Toponym | Source Discrepancy Identified | Authoritative Legal / Cartographic Reality | Alo King Operational Resolution |
| :---- | :---- | :---- | :---- | :---- |
| **Bakaata** | بقعاتا | Omitted from CAS municipality inventories; present in OpenStreetMap, UN listings, and business directories. | Bakaata is not an independent municipality; it is a primary commercial town within the municipal bounds of Jdeidet el-Chouf. | Establish a distinct Settlement Record (Type: Commercial Town) linked to parent municipality Jdeidet el-Chouf. |
| **Semqanieh** | السمقانية | Omitted from several generic village lists; present in CAS, Localiban, and World Bank datasets. | Full independent municipality (*Decree 118/1977*) and distinct cadastral zone in Chouf. | Maintain as an independent Settlement Record (Type: Town, Municipality: Semqanieh). |
| **Khraybeh (Chouf)** | الخريبة | Conflated with Khraybeh in Baalbek, Khrayeb in Saida, or El-Khraibat in Akkar. | Independent municipality (*Khraybeh Chouf*) in Upper Chouf, bordering Moukhtara and Baadaran. | Register under unique ID ML-CHF-008 (Arabic: الخريبة الشوف), isolated from identically named homonyms. |
| **Dora** | الدورة | Treated by commercial users as a distinct city; omitted from municipal lists. | Commercial quarter within the municipality of Jdeideh \- Bouchrieh \- Sed el-Bauchrieh. | Register as a primary Urban Commercial Quarter (Parent: Jdeideh, District: Metn). |
| **Kaslik** | الكسليك | Functionally recognized as a standalone coastal city; missing from municipal records. | Coastal commercial and entertainment sector within the unitary Municipality of Jdeidet Jounieh. | Register as an Urban Commercial Quarter (Parent: Jounieh, District: Keserwan). |
| **Dawha Aramoun** | دوحة عرمون | Frequently listed as separate from Aramoun; separate courier rates applied. | Coastal/lower suburban expansion of the historic mountain village of Aramoun (Aley District). | Register as a distinct Suburb Locality (Parent: Aramoun, District: Aley) to capture lower-elevation deliveries. |
| **Bqaa Kafra vs. The Cedars** | بقاع كفرا والأرز | Sourced elevations vary widely (1,450 m to 2,200 m). The Cedars treated as a village in tourist guides. | Bqaa Kafra is an independent municipality (village center 1,650 m). The Cedars (*Al-Arz*) is an alpine resort hamlet within Bcharre municipality (1,900–2,150 m). | Maintain Bqaa Kafra as a village; register The Cedars as an Alpine Resort Hamlet under Bcharre. |
| **Keserwan-Jbeil Governorate** | محافظة كسروان \- جبيل | Omitted from older UN and government datasets (listed under Mount Lebanon). | Established by Law No. 51 of September 7, 2017; fully operationalized with an active Governor. | Treat as an independent Governorate containing Keserwan and Jbeil districts; detach from Mount Lebanon. |
| **Akkar & Baalbek-Hermel** | عكار وبعلبك-الهرمل | Older datasets categorize them under North Lebanon and Beqaa. | Created by Law 522 of July 16, 2003; operationalized in 2014 with independent Governors. | Enforce Akkar and Baalbek-Hermel as standalone Governorates in the administrative schema. |
| **Zgharta-Ehden** | زغرتا \- إهدن | Listed as two distinct towns 25 km apart, yet share a single municipal council. | Dual seasonal settlement governed by the unitary Municipality of Zgharta-Ehden. | Register as two distinct Populated Localities (Zgharta and Ehden) mapped to one parent municipality. |
| **Chhim / Iklim al-Kharroub** | شحيم وإقليم الخروب | Variously treated as an independent district or an informal region. | Chhim is a municipality within the Chouf District. Iklim al-Kharroub is a vernacular/historical region. | Categorize Chhim under District: Chouf, Subregion: Iqlim al-Kharroub (Historical/Geographic). |

## **Spatial Data Traceability and Confidence Matrix**

To support enterprise data governance, every attribute within the master dataset is audited against its primary authority source, secondary validation method, and associated confidence tier.  
The primary Arabic toponym serves as the anchor identity key across all entities, preventing duplicate records arising from variable English transliterations (e.g., distinguishing whether *Baakline*, *Baakleen*, or *Baaqlin* refer to the same settlement).

| Data Field / Attribute | Primary Authority Source | Secondary / Cross-Check Source | Verification Method | Assigned Confidence Tier |
| :---- | :---- | :---- | :---- | :---- |
| **Official Arabic Name** | Lebanese Central Administration of Statistics (CAS) | Official Gazette (*Al-Jarida Al-Rasmiyya*) / MoIM | Direct matching against statutory decrees | **VERIFIED** |
| **Transliterated English Name** | UN-OCHA Common Operational Dataset (COD-AB) | OpenStreetMap Toponym Tagging (name:en) | Phonetic harmonization against local pronunciation | **HIGH** |
| **Governorate Assignment** | Statutory Legislation (Law 116/1959, 522/2003, 51/2017) | Ministry of Interior and Municipalities (MoIM) | Legal decree verification | **VERIFIED** |
| **District (Caza) Boundary** | Statutory Legislation / UN-OCHA Administrative Layers | CAS Administrative Gazettes | Spatial containment matching | **VERIFIED** |
| **Geographic Subregion** | Historical geographic surveys & local field usage | Municipal Union alignments (*Ittihad al-Baladiyat*) | Vernacular classification and consensus analysis | **MEDIUM / HIGH** |
| **Municipal Affiliation** | MoIM General Directorate of Local Administrations (DGLAC) | Official Electoral Decrees (2016 National Municipal Elections) | Administrative council cross-referencing | **VERIFIED** |
| **Cadastral Zone (1,623)** | Directorate of Land Registry and Cadastre (GDLRC) | CAS / UN-OCHA Cadastral Shapefile Layer (CAS\_CODE) | Unique boundary code matching | **VERIFIED** |
| **Geodetic Coordinates** | OpenStreetMap (Node/Centroid Geometries) | Google Maps Geocoding API / GeoNames Server | Spatial intersection against cadastral boundary | **HIGH** |
| **Village Center Elevation** | Shuttle Radar Topography Mission (SRTM 30m Global DEM) | DAG 1:50,000 Topographic Sheets / Google Elevation | Bilinear interpolation evaluated at village centroid | **HIGH** |
| **Topographic Range (Min/Max)** | CAS Settlements Dataset (CAS\_MaxElevation) | ALOS World 3D (30m Elevation Model) | Raster zonal statistics over cadastral polygon | **HIGH** |
| **Straight-Line Distance** | Geodesic Mathematical Model (Haversine Formula) | PostGIS Geodetic Functions (ST\_Distance) | Algorithmic point-to-point calculation | **VERIFIED** |
| **Surface Road Distance** | OpenStreetMap Road Topology Network | Open Source Routing Machine (OSRM) / Valhalla Engine | Network graph traversal accounting for grade | **HIGH / ESTIMATED** |
| **Locality Population** | CAS National Survey of Household Living Conditions | UN-Habitat / UNHCR Inter-Agency Multi-Sector Needs | Statistical sampling; no current census available | **MEDIUM / ESTIMATED** |

## **Territorial Coverage and Dataset Enumeration Synthesis**

The substantial variance in settlement counts reported across Lebanese geographic surveys is directly attributable to the differing institutional definitions used by cadastral registries, municipal election authorities, and functional cartographers.  
A rigorous breakdown of the national spatial fabric reveals nine statutory Governorates and twenty-six administrative Districts. At the cadastral tier, exactly 1,623 Cadastral Zones are maintained by the Ministry of Finance and CAS. Decentralized local administration accounts for approximately 1,029 active Municipalities organized into fifty-seven chartered Municipal Unions.  
At the functional delivery tier, the national territory encompasses approximately 2,240 populated destinations, consisting of 18 primary cities, 114 large commercial towns, 1,320 traditional villages, and 788 rural hamlets, tourist resorts, and urban neighborhoods.

| Geographic & Administrative Unit Tier | Total Quantity Identified | Statutory or Cartographic Framework | Functional Operational Role |
| :---- | :---- | :---- | :---- |
| **Governorate (*Muhafaza*)** | 9 | Law 116/1959, Law 522/2003, Law 51/2017 | High-level regional routing and dispatch boundaries |
| **District (*Qadaa*)** | 26 | Decree 116/1959; Akkar single, Beirut unitary | Administrative grouping; merchant territory clustering |
| *Cadastral Zone (Mantaqah Iqariyya)* | 1,623 | GDLRC / Ministry of Finance / CAS | Fiscal parcel baseline; geometric boundary snapping |
| **Municipality (*Baladiyah*)** | 1,029 – 1,050 | Decree-Law 118/1977; MoIM 2016 Election Roll | Decentralized local authority; legal jurisdiction |
| **Union of Municipalities (*Ittihad*)** | 57 | Decrees by MoIM under Municipal Law 1977 | Inter-municipal service clusters; arterial road corridors |
| **Populated Destinations (Alo King Core)** | \~2,240 | Integrated Dataset: CAS, UN, OSM, Field Gazetteers | True commercial destinations, delivery drop-off nodes |
| • *Major Cities & Regional Capitals* | 18 | Administrative Capitals & Major Urban Agglomerations | Central fulfillment zones; high-density courier fleets |
| • *Commercial Towns & Market Hubs* | 114 | Regional Secondary Centers (e.g., Bakaata, Chhim, Douma) | Secondary dispatch nodes; multi-village merchant pools |
| • *Canonical Rural Villages* | 1,320 | Official CAS Locality Inventory (*Qura*) | Standard rural delivery drop points |
| • *Hamlets, Suburbs & Resort Clusters* | 788 | OSM Nodes, Tourist Clusters (e.g., Zaarour, Faqra, Dawha) | Micro-destinations; resort and suburban delivery pins |

The divergence between the 1,623 cadastral boundaries and the \~1,029 municipalities is explained by the fact that roughly 340 cadastral units represent uninhabited agricultural lands (*Mazraa*), private rural estates, state forests, or high mountain ridges that contain no permanent population and warrant no municipal council.  
Conversely, the divergence between the \~1,029 municipalities and the \~2,240 functional populated destinations is driven by two real-world factors: over two hundred municipal councils govern multiple distinct, named villages; and extensive modern suburbanization has created dense, unincorporated residential and commercial clusters (such as Bakaata in the Chouf or Dawha Aramoun in Aley) that function as major delivery destinations despite lacking independent municipal status.

## **Geospatial System Architecture and Dispatch Logistics for Alo King**

Operating an on-demand, chat-native delivery engine across Lebanon requires an architecture adapted to the realities of local addressing, extreme terrain variations, and cellular messaging workflows. Because standard alphanumeric postal codes are practically absent from everyday consumer use, addressing relies heavily on landmarks, building names, and conversational descriptions.  
\#\#\# Relational Entity Schema and Storage Architecture The core geospatial database should separate administrative boundaries from conversational search aliases and routing logic. Rather than relying on unstructured text strings, the platform's data layer should be organized around five primary entities:

> * **Administrative Jurisdictions**: Persistent polygon records for Governorates and Districts that capture official Arabic names, standardized English transliterations, and spatial boundary coordinates for high-level dispatch filtering.  
> * **Municipal Councils**: Administrative records representing formal local councils, storing official council registries, tax jurisdictions, and affiliations with Municipal Unions.  
> * **Settlements and Populated Places**: The central operational table. Every city, town, village, hamlet, and commercial center receives a unique Canonical Place ID (such as LB-CHF-BAKAATA or LB-BBD-HAMMANA). This record permanently maintains its official Arabic name, canonical English name, parent district, governorate, and municipality linkages, informal subregion tag, geodetic centroid coordinates (Latitude/Longitude in WGS84), center elevation (meters ASL), and confidence tier.  
> * **Toponym Aliases and Multilingual Lexicon**: A many-to-one dictionary linking alternative spellings, colloquial references, and Franco-Arabic (*Arabizi*) chat terms back to the Canonical Place ID (e.g., mapping Baakleen, Baaqlin, Baakline, and بعقلين directly to LB-CHF-BAAKLINE).  
> * **Address Landmarks**: A dynamic point-of-interest database storing localized visual markers (pharmacies, bakeries, roundabouts, municipal halls, and well-known commercial complexes) paired with geodetic coordinates, used to resolve informal text directions.

### **Field Persistence Versus Dynamic Runtime Computation**

To maintain low database latency, static geographic attributes must be stored persistently, while dynamic transit and environmental factors are calculated at runtime:

> * **Permanently Stored Attributes**: Canonical place identifiers, official Arabic toponyms, canonical English transliterations, administrative foreign keys, geodetic centroid coordinates, center elevations, cadastral boundary codes, spatial polygon boundaries, and the alias lexicon.  
> * **Dynamically Computed Metrics**:  
  * *Real-time travel duration and driving distance*: Calculated on demand using OpenStreetMap road network topologies, accounting for active traffic, mechanical climb penalties, and road curvature.  
  * *Seasonal road and pass closures*: High-altitude corridors (such as the Cedars–Ainata pass connecting Bcharre to Northern Beqaa, or the Faraya to Hadath Baalbek road) close regularly between November and May due to heavy snow; these seasonal restrictions must be evaluated via dynamic routing tables rather than static distance lookups.  
  * *Altitudinal terrain surcharges*: Evaluated dynamically during checkout by computing the vertical elevation climb (\\Delta h) between the merchant pickup location and the customer drop-off coordinates.  
  * *Real-time courier dispatch*: Calculated via spatial proximity indexes evaluated at the moment of order placement.

### **Conversational Location Capture Architecture**

Because text input in WhatsApp often contains spelling ambiguities, mixed dialects, or identical village names across different districts, the conversational ordering bot should not prompt the user for an open-ended text address. Instead, Alo King should implement a three-tiered location capture pipeline using the WhatsApp Business Cloud API.  
In the primary interaction tier, the bot sends an interactive location request message (type: "location\_request\_message") during checkout. This prompts the customer to share their exact live or current GPS pin with a single tap. When the coordinates arrive via webhook, the backend executes a point-in-polygon spatial lookup against cadastral and municipal boundary layers, instantly identifying the customer's governorate, district, settlement, and nearby landmarks.  
If the user denies GPS permissions or encounters weak satellite reception, the platform transitions to the secondary fallback tier: structured interactive list messages (type: "list"), capped at ten rows per section. The user sequentially selects their Governorate, District, and Village through clean menus, preventing the data-entry errors inherent in conversational text.  
Once the settlement is established via GPS or structured lists, the system enters the tertiary tier: last-mile landmark and vertical resolution. The bot prompts the customer for descriptive details: prominent nearby landmark, building name or color, floor number, and apartment intercom. This hybrid approach pairs precise geodetic coordinates with the local visual descriptions drivers need to complete delivery.

### **Delivery Zone Structuring and Altitudinal Fleet Economics**

Dispatching couriers across steep mountainous terrain requires zoning models that move beyond circular Euclidean buffers. A five-kilometer straight-line radius in the Shouf or Metn mountains often crosses deep river gorges and steep switchbacks, transforming a short linear distance into an extended 45-minute journey.  
To maintain fleet efficiency, Alo King should implement a three-tiered spatial zoning architecture:  
First, the national territory should be indexed using Uber H3 discrete hexagonal cells. High-density urban coastal areas (Beirut, Tripoli, Sidon) operate at Resolution 8 (average hexagon area \~0.74 km²), while rural mountain valleys operate at Resolution 7 (average hexagon area \~5.16 km²). Hexagonal indexing standardizes spatial lookups, smooths dispatch borders, and accelerates merchant discovery in conversational chat.  
Second, service coverage surrounding commercial hubs (such as Bakaata in the Chouf, Chtaura in the Beqaa, or Jounieh along the coast) should be defined by drive-time isochrones rather than circular radii. Delivery boundaries follow 10-minute, 20-minute, and 30-minute travel contours generated directly from OpenStreetMap road topologies, accounting for real road curvature and speed limits.  
Third, delivery pricing must incorporate an altitudinal tariff matrix. Deliveries operating entirely within coastal plains below 300 meters follow standard base rates. Deliveries climbing into middle mountain zones (300 to 900 meters) or high mountain zones (\>900 meters) incur programmatic elevation surcharges, compensating couriers for increased fuel consumption, mechanical wear, and the reduced travel speeds required by steep mountain gradients. This tiered approach ensures fair compensation and sustainable fleet economics across Lebanon's complex topography.

#### **Works cited**

1\. Administrative Divisions of Lebanon \- Lebanese Arabic Institute, https\://www\.lebanesearabicinstitute.com/administrative-divisions-lebanon/ 2\. Districts of Lebanon \- Wikipedia, https\://en.wikipedia.org/wiki/Districts\_of\_Lebanon 3\. Governorates of Lebanon \- Wikipedia, https\://en.wikipedia.org/wiki/Governorates\_of\_Lebanon 4\. NATIONAL URBAN POLICIES PROGRAMME IN LEBANON, https\://unhabitat.org/sites/default/files/documents/2019-07/nup-report\_design.pdf 5\. Land Resources, http\://studies.gov.lb/getattachment/Sectors/Environment/2010/ENV-10-2/6-Land-Resources.pdf 6\. Beqaa Governorate \- Wikipedia, https\://en.wikipedia.org/wiki/Beqaa\_Governorate 7\. Lebanon \- Settlements (villages, towns, cities) | Humanitarian Dataset, https\://data.humdata.org/dataset/lebanon-settlements-villages-towns-cities 8\. Strategic Spatial Planning in Lebanon: An International “Recipe, https\://www\.researchgate.net/publication/330688078\_Strategic\_Spatial\_Planning\_in\_Lebanon\_An\_International\_Recipe\_The\_Case\_of\_The\_Union\_of\_Municipalities 9\. Lebanon Address Format With Examples \- PostGrid™, https\://www\.postgrid.com/global-address-format/lebanon-address-format/ 10\. LEBANON THIS WEEK \- Issue 917 \- Byblos Bank, https\://byblos.byblosbank.com/files/Library/Assets/Gallery/Publications/LebanonThisWeek/Lebanon%20this%20Week%20917.pdf 11\. Political Economy of Education in Lebanon \- World Bank Documents, https\://documents1.worldbank.org/curated/en/652341583471772355/pdf/Political-Economy-of-Education-in-Lebanon-Research-for-Results-Program.pdf 12\. List of municipalities of Lebanon \- Wikipedia, https\://en.wikipedia.org/wiki/List\_of\_municipalities\_of\_Lebanon 13\. Keserwan-Jbeil \- Mount Lebanon \- Mapcarta, https\://mapcarta.com/N13321742666 14\. U F C Ultimate Fitness Center | Gym & Martial Arts | Bakaata, https\://onlifelebanon.com/listing/u-f-c-ultimate-fitness-center-gym-martial-arts-bakaata-center-farah-chouf-lebanon/ 15\. http \- Free, http\://abihabib.free.fr/emigre.htm 16\. Baaqline, Chouf, Lebanon — location, history & families, https\://chouf.app/area/baaqline/ 17\. Forgotten Akkar, https\://www\.socialsciences-centre.org/sites/default/files/resources/MADA\_Forgotten\_Akkar\_SocioEconomicReality\_Jan08.pdf 18\. Lebanon topographic maps, elevation, terrain, https\://en-ie.topographic-map.com/place-mgnh/Lebanon/ 19\. Cedars \- Tourism @ Lebanon.com, http\://www\.lebanon.com/tourism/cedars.htm 20\. Bekaa Kafra \- Wikipedia, https\://en.wikipedia.org/wiki/Bekaa\_Kafra 21\. Bekaa Kafra, https\://a.osmarks.net/content/wikipedia\_en\_all\_maxi\_2020-08/A/Bekaa\_Kafra 22\. PeakView \- Bcharre Breathtaking View \- Apartments for Rent in, https\://www\.airbnb.com/rooms/44876902 23\. Bekaa Kafra – Wikipédia, a enciclopédia livre, https\://pt.wikipedia.org/wiki/Bekaa\_Kafra 24\. Bqaa Kafra Highest Village Walk Trail | 2.2km, Difficulty: 2 out of 5, https\://friendhike.com/trails/lebanon/bqaa-kafra-highest-village-walk/ 25\. Keserwan-Jbeil Governorate topographic map, elevation, terrain, https\://en-ca.topographic-map.com/map-xjwg5k/Keserwan-Jbeil-Governorate/ 26\. Municipalities \- DGLAC, https\://www\.dglac.gov.lb/en/web/guest/municipalities 27\. Jbaa, Chouf, Lebanon — location, history & families, https\://chouf.app/area/jbaa/ 28\. Semkanieh \- Destination Shouf, https\://www\.destinationshouf.com/shouf\_on\_the\_map/village/semkanieh 29\. Download Lebanon Administrative Boundary Shapefiles \- iGISMAP, https\://www\.igismap.com/download-lebanon-shapefile-free-map-country-boundary-line-polgon-shapefile/ 30\. Governorates of Lebanon, https\://www\.cometolebanon.com/about-lebanon/governorates-of-lebanon 31\. WhatsApp chatbot for Lebanon — Arabic · ArabyBot, https\://arabybot.com/countries/lebanon?lang=en 32\. Lebanon Postal Codes, https\://postal-codes.net/lebanon\_postal\_codes/ 33\. WhatsApp Business API \- Netcore CPaaS User Guide, https\://emaildocs.netcore.ai/docs/whatsapp-business-api 34\. Lebanon: Coding Method | PDF \- Scribd, https\://www\.scribd.com/document/779545752/LBN 35\. Lebanon Postal Codes Overview | PDF | Zip Code | Postal System, https\://es.scribd.com/document/435634279/Baba-Ganoush 36\. Medical Network ش كة مزودي الخدمة, https\://scsl.org.lb/wp-content/uploads/2019/02/network-general.pdf 37\. Send WhatsApp Messages via API \- EnableX Developer Docs, https\://developer.enablex.io/messaging/whatsapp.html 38\. Whatsapp Business API documentation, https\://docs.1msg.io/ 39\. LINK Mobility WhatsApp Business API, https\://www\.linkmobility.com/resources/developer/WhatsApp-Message-API-ver1.4.19.pdf 40\. WhatsApp Interactive Messages: Types, Limits and Examples, https\://chatmitra.com/blog/whatsapp-interactive-messages/ 41\. WhatsApp Business API Documentation \- Montnets International, https\://www\.int-montnets.com/developers/docs/whatsapp 42\. Interactive list messages | Meta for Developers \- Facebook, https\://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages 43\. STATE OF THE LEBANESE CITIES \- UN-Habitat, https\://unhabitat.org/sites/default/files/2022/03/un-habitat\_escwa\_state\_of\_the\_lebanese\_cities\_2021\_1\_1.pdf 44\. Keserwan-Jbeil: Lebanon's Mountains, Coastline, and Heritage, https\://quixoticguide.com/keserwan-jbeil-lebanons-mountains-coastline-and-heritage/