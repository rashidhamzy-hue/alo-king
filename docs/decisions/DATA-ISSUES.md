# Data issues for the finalisation session (DECISIONS §31)

One line per problem: date, table, record or pattern, example. Session D fixes them all at once.


2026-10-11 · places · `LB-BLB-ARSAL` name_ar is "عرسال ساحة" (a square, not the town name "عرسال").
2026-10-11 · places · `LB-MTN-BURJ-HAMMOUD` name_ar "برج حموﺪ" ends in an Arabic presentation-form letter (U+FEAA) instead of "د"; Arabic searches for برج حمود still match by trigram, but the stored name is wrong.
2026-10-11 · places · `LB-KSR-ZOUK-MOSBEH` has the alias "زرق مصبح" (typo of ذوق مصبح).
2026-10-11 · places · `LB-ZHL-ZAHLE` aliases include Cyrillic and Hebrew spellings (Захла, זחל) from OSM; harmless for search, noise in labels.
2026-10-11 · places · `LB-CHF-BEITEDDINE` name_ar "بيت الدين‎" carries a trailing left-to-right mark (U+200E).
2026-10-11 · places · `LB-BAT-TANNOURINE-EL-TAHTA` and `LB-CHF-MAZRAAT-ED-DOUAIR` have no name_ar.
2026-10-11 · places · `LB-JZN-MAZRAAT-EL-MATHANE` has three spellings in one alias string separated by commas, instead of separate aliases.
2026-10-11 · places · location eval misses (evals/location): "na3me" does not reach `LB-CHF-NAAMEH` (Naameh has no Arabizi alias); French "place" in "près de la place" matches Beirut squares.
2026-10-14 · vendors (Shouf) · `ChIJ99swKwAhHxURTrM_oUn0mp8` "Shawarma Albasha" and `ChIJM7QVRQAhHxURMvKEj1aW7W4` "Al Basha" are one shop listed twice (same number, a few metres apart); both kept, merge at claim.
2026-10-14 · menu_drafts (Shouf) · the Coop Baakleen and Baakline Supermarket catalogues are identical (45 SKUs, same prices): a template, not each shop's prices; the merchant confirms section by section.
2026-10-14 · vendor_links (Shouf) · one website is a raw IP (`https://185.76.176.87/`); stays `unchecked`, never shown.
2026-10-14 · vendors (Shouf) · `1.2.1 Coffee` has locality "Beit ed-Dine" with an address on "Barouk Rd"; it gets the pilot village nearest its pin at load.
2026-10-14 · vendors (Shouf) · Latin leftovers that are not names were dropped: "أبو فؤاد market", "mr فروج" (Mr Farrouj?) have only an Arabic name until the merchant confirms.
2026-10-14 · places (§39.2) · "Jeblai", named by Rasheed for the delivery area, matches no place or alias within 10 km of a Shouf merchant (closest spellings: Jabal Toura 21 km, Jabel Ain et Tine 22 km); needs the local spelling or the village it belongs to.
2026-10-14 · vendors (Shouf) · Nayeh w Meshwiyeh was listed twice (`ChIJX_XVOO0hHxURJO_Dq1Kl-Lo`, `ChIJR6VlRAAhHxURSemilwLScnE`, 3 m apart); merged in session E into the first (exclusion "duplicate of …"). Fixed.
2026-10-14 · places (§39.2) · the straight-line delivery area includes West Bekaa and Zahle places across the Barouk ridge (Aammiq, Saghbine, Kafrayya…); they are on, but by road most are beyond every merchant's radius, so customers there will mostly see "too far". Revisit with road distances once ORS routes are cached for the area.
2026-10-14 · landmarks (OSM, §39.2) · some OSM tags are wrong for our use: "CashUnited" is tagged as a government office (municipality), "Pet market & Vet hospital" in Semqanieh as a hospital, "Domaine des Mirs" as a municipality, a pharmacy named "unkown" in Daraiya. They stay unconfirmed (confidence 0.3) and are corrected by deliveries or an operator.
