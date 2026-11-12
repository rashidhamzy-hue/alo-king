# Chouf business prospects (internal research only)

| File | What it is |
| --- | --- |
| `alo_king_vendors_original.csv` | The founder's file exactly as received, 816 rows. Never edited. |
| `alo_king_prospects_cleaned.csv` | The same 816 rows after deterministic cleaning by `scripts/clean_prospects.py`. Every change is named in the `changes` column; every doubt in `flags`. |
| `alo_king_launch_shortlist.csv` | 60 food businesses within 6 km (straight line) of Baakline that have a phone number and no blocking flag. A calling list to verify, not a ranking. |

Rules:
1. These are listings collected from Google Maps. Nothing here is verified. Nobody in this file has agreed to anything.
2. Never import a row as a merchant. A restaurant becomes orderable only through `approve_merchant()` after signed terms and an approved menu.
3. Never message these numbers from the system. A scraped phone number is not consent. First contact is a person: a visit or a phone call.
4. Ratings and review counts are for internal sorting only. They are never shown to a customer or used in ranking (project rule 14), and Google's terms do not allow republishing them.
5. To regenerate: `python3 scripts/clean_prospects.py data/prospects/alo_king_vendors_original.csv data/prospects`.
