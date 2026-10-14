# Vendor seed (DECISIONS §15, §38)

Session D (14 October 2026, §38.1) deleted the 2,044 nationwide seed vendors and removed their file from `source/`:
the Shouf pilot file (`supabase/seed/shouf/`) is the vendor list until Rasheed's national dataset arrives. A file put
back in `source/` is loaded the same way as before (below), in a `Data:` pull request.

Put the vendor file `alo_king_master_lebanon_vendors_cleaned.csv` in `source/` (owner issue: upload it
through GitHub). `scripts/load-seed.sh` then normalises it with `scripts/vendors/build-seed.ts` (names,
categories, exclusions, phones, links, brands; ratings and review counts dropped) and loads it into
staging after the next deploy. CI runs the same load on a throwaway database and checks it
(`supabase/tests/seed/vendors_quality.sql`).

Every imported vendor is unclaimed, not orderable and has no public page. Seed phones and addresses are
internal (`vendor_private`): a phone is used only to send a claim code, never shown and never messaged
for outreach.
