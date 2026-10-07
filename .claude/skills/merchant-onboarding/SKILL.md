---
name: merchant-onboarding
description: Build or review how a business claims or registers on Alo King, confirms its pre-filled profile, builds its menu, sets delivery and payment terms, and goes live. Use for claim, registration, staff roles, go-live and merchant self-service work.
---

# Merchant onboarding

DECISIONS §15 (vendor data), §17 (categories), §18 (claims and self-service), §20 (money), §21 (delivery), §23 (order channels) decide. No field visits and no outreach messages: businesses start themselves from ads, customers or the site. This is product behaviour built in Phases 3 and 8; until then, use it to design and review that work.

## Starting point
2,087 seed vendors, all `claim_status = unclaimed`, `orderable = false`, `public_page = false`, seed fields marked `source = seed`. No ratings, no menus imported, phone seed internal only. Unclaimed vendors have no public page anywhere.

## Claim and registration cases (§18.1)
A mobile seed phone on WhatsApp: code by WhatsApp. B landline: automated voice call reads the code. C wrong or missing phone: commercial registration or municipal permit plus shop-sign photo, Rasheed approves in one tap. D on Google but not in our list: live lookup with `GOOGLE_PLACES_SERVER_KEY`, then A-C. E not on Google: register with documents (home kitchens need a registration document, else waitlist). F chains: one brand, each branch its own vendor. G two claimants: both frozen, documents, audit log. H staff roles: owner, manager, cashier, kitchen (only owner and manager edit prices and menu). I sale, J closed or moved, K removal (delete, keep `place_id` as do-not-re-import), L lost access, M customer requests (counted, never messaged).

## Profile and menu (§18.2, §18.3)
Every seed field shows "please confirm"; confirming replaces `source = seed`. The merchant adds kitchen WhatsApp, owner mobile, delivery radius (road distance, max 10 km), hours, prep time, cash currencies, menu and photos. Smart menu import from photos, PDF, a link or Instagram screenshots is a draft approved section by section; prices are never invented. Later edits by dashboard or by message to the Merchant number become proposals the merchant confirms with one tap.

## Go-live checklist (§1, §15)
Claimed and verified; profile confirmed; tested menu; delivery radius and fee within the bands ($2 / $3 / $4.50 up to 3 / 6 / 10 road-km, lower allowed); order channel chosen with a backup (§23) and acknowledged in one dry-run order; collection mandate accepted with one tap (version and timestamp stored, §20.1); settlement details for the 2-weekly settlement. Then `orderable = true` and a public page.

## Rules
Never ask owners for API keys, OTPs or card numbers in chat; never edit another vendor's data; prices, availability and hours change only with the merchant's tap; marketing only to opted-in customers through approved templates.
