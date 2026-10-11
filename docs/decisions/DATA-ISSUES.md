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
