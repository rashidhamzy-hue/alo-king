# Research register (session S1, checked 14 November 2026)

Only questions that change a decision. Each has what the sources say (**fact**), what is still a guess (**assumption**), and the
decision it feeds. Eleven web searches were run, not the 25 allowed: the session's budget went to the audit. Session R4 (14 November) rewrote (a) from
the payment companies' own pages and answered what S1 had not checked, in the last section. Vendor pages and vendor benchmarks are marked as such.

## (a) Card payments for a Lebanese company; Whish and OMT merchant APIs (rewritten by R4, 14 November 2026)

**Rule for this section (founder, 14 Nov, answer 10):** a payment fact counts only if it comes from the company's own website,
its own developer documentation, or a published sales or contact page. Third-party connectors, other platforms' app stores,
agencies and forums do not count. S1's earlier lines that relied on them are listed at the end of this section as **unconfirmed**
and are no longer used. Where the company's own pages say nothing, the gap is a question for its sales contact (below).
"Checked" means read on 14 November 2026. areeba.com refused direct page fetches from the build environment (HTTP 403); its facts
below come from areeba's own pages as shown in search results, and are marked "via search".

### Facts, from the companies' own pages

**Stripe.** Its own availability page (stripe.com/global) lists about 50 countries; Lebanon is not among them. PayPal: not checked
on its own page; treat as unconfirmed (do not plan on it).

**Whish Pay** (whish.money)
- Its own Corporate Solutions page describes Whish Pay as "tailored for seamless online and in-store transactions" and offers one
  thing: a merchant interest form (name, phone, email, position, company, sector, website and domain, platform: Shopify, WordPress
  or custom). The FAQ says: "Our Whish Pay Service lets merchants accept payments online through their websites or apps."
- **Not published on Whish's own pages:** onboarding requirements, merchant fees, settlement currency or timing, refunds by API,
  sandbox, developer documentation, webhook signature. The Fees page lists only consumer fees (adding money by payment link or
  international card: 3%; cash out 1%); no merchant rate.
- The consumer Terms (whish.money/terms-conditions) are written for the app: payments through the app "must be for personal,
  non-commercial purposes" (card top-up terms); disputes within 7 days; a general line, +961 1 788 999. No merchant email is
  published; the only merchant route is the form.

**areeba** (via search; areeba.com refused direct fetches)
- areeba's acquiring page lists "Installation of POS & Integration with merchants website" and says to fill the form on the page.
  Its integration guide (areeba.com/documentations/integration.html) is a Hosted Checkout guide built on the Mastercard Gateway:
  a checkout session, a hosted page, then a retrieve call to confirm the result; credentials are issued "when you are
  successfully boarded onto the gateway"; test merchant ids carry a TEST prefix. So card data stays on the hosted page.
- Contact, from areeba's own contact page: Lebanon office M1 Building, Omar Daouk Street, Beirut; +961 1 954 333;
  lebanon@areeba.com. Its support portal lists support@areeba.com (support for existing clients).
- **Not published:** onboarding for a new company, fees, settlement currency, refunds by API in areeba's configuration, sandbox
  without a contract. The guide's API version is old (60); ask which version applies.

**MontyPay** (montypay.com; Monty Finance SAL)
- Its footer: Monty Finance SAL is registered in Beirut (commercial register no. 73215) and authorised by the Central Bank of
  Lebanon as a financial institution; the site cites 50+ countries. It sells "MontyPay Payment Gateway", payment links and POS.
- Contact: a form (/contact-us; product choice includes Payment Gateway); Lebanon phone 1691; WhatsApp +44 749 631 21 10;
  office: 3rd Floor, Bloc A, Gefinor Center, Beirut. **No email address is published.**
- Developer documentation is public (docs.montypay.com): a hosted checkout API; **refund** is `POST /api/v1/payment/refund` keyed by
  `payment_id`; the final result arrives in a callback with `type=refund`; a refund of a pending or debit payment becomes a
  reversal "for the full amount only". The page I read did not describe partial refunds of settled payments (confirm). The sandbox
  URL "is provided by your account manager"; the merchant key is in the admin panel and the password is used only for hashing.
- **Not published (the FAQ page lists these questions but its answers were not readable):** onboarding documents, fees, settlement
  currency and period, who may open an account.

**Tap Payments** (tap.company; developers.tap.company)
- **Its own support article, "What countries are supported by Tap payments?" (modified 28 April 2025), says: "We currently do not
  accept any new merchants from Egypt, Jordan, or Lebanon."** Tap's Lebanon landing page still says "Accept online payments in
  Lebanon" and "payouts to local banks in Lebanon" but is older. The two own pages disagree; the support article is the newer one.
  Tap's own payout article lists payouts only to businesses in six Gulf states.
- Developer documentation is public: refunds by API (`create-a-refund`, `download-refunds`), test keys (`sk_test_...`), test
  cards, webhooks signed with a `hashstring` header (HMAC-SHA256 of selected fields with the secret key).
- Contact: "Talk to Sales" form at tap.company/en-lb/company/contact (monthly sales, customers, team size, channel). No email or phone is published.
- **Not published:** fees; settlement currency; whether a Lebanese company can be onboarded now.

**OMT.** No public merchant checkout API found on omt.com.lb (OMT Pay is a consumer wallet; QR in shops; payment links for adding
money). Unchanged: OMT stays "screenshot, confirmed by a person" until OMT confirms an API in writing. (S1 read OMT's own page; R4 did not re-read it.)

### Questions to send (the founder sends them, one message to each company)
Use the same numbered list for every company, so the answers compare:
1. Will you onboard a new Lebanese SARL (Alo King, grocery and food delivery, newly formed, no trading history)? Which documents,
   and how long does approval take?
2. In which currency, to which kind of account, and how often do you settle? Can the settlement be in US dollars to a Lebanese
   "fresh dollar" account, or abroad? Are there rolling reserves or holdbacks?
3. What are all the fees: percentage and fixed fee per transaction for local cards and for international cards (buyers abroad),
   setup, monthly, chargeback, refund and payout fees, minimums?
4. Can we refund by API, in full and in part, after settlement? How long does it take; who bears the fee?
5. Do you give sandbox credentials and API documentation before a contract? How are webhooks signed, and are they retried?
6. Do you offer a hosted payment page so we never see card data, in US dollars (and Lebanese pounds if offered)? What is our PCI scope?
7. Please send the merchant agreement and fee schedule in writing.

Extra for **Whish**: Can a newly formed SARL open a Whish Pay merchant account? Is Whish Pay a wallet-balance payment only, or may a
customer top up by card inside the flow? Is there a merchant API (not only the Shopify, WordPress and custom-site forms), a sandbox,
a signed webhook, and a settlement report we can reconcile to our ledger?
Extra for **Tap**: Do you accept a new Lebanese company at all today, given the support article of 28 April 2025? If not, would a
company registered elsewhere (and which place) be accepted for buyers abroad?
Extra for **areeba**: Do you contract directly with merchants, or only through a bank as acquirer (your page says you work with banks and acquirers)? Which Mastercard Gateway API version is current?

**Where to send each (from each company's own site):**
| Company | Route | Address or number |
| --- | --- | --- |
| Whish | Merchant interest form: whish.money/corporate-solutions; general line (consumer) | +961 1 788 999. No email published |
| areeba | Lebanon office; acquiring-page form | lebanon@areeba.com; +961 1 954 333 |
| MontyPay | Contact form montypay.com/contact-us (choose "MontyPay Payment Gateway"); Lebanon phone; WhatsApp | 1691; +44 749 631 21 10. No email published |
| Tap | "Talk to Sales" form: tap.company/en-lb/company/contact | No email or phone published |

### Assumptions (all unproven; each is a question above)
That any of the four will onboard a new SARL with no trading history; that they settle in fresh dollars to a Lebanese account; that
fees are in the low single digits of a percent; that refunds work through the API (shown only for MontyPay and Tap, not for Whish or areeba).

### Earlier lines now unconfirmed (they relied on sources that do not count)
- "Whish has a sandbox, USD and LBP, a Shopify app on 27 March 2025" (another platform's app store), and "refunds, tokenisation and
  manual capture are not available through the API" (a third-party Odoo connector): **unconfirmed**; use the questions above.
- "Tap serves Lebanon at 2.5 to 2.9% on international cards" (a Lebanese web agency and a merchant forum): **unconfirmed and
  contradicted by Tap's own support article.**
- "NetCommerce not functional" (the same forum), "Banque du Liban licensing framework, January 2026" (a fintech news summary):
  **unconfirmed**. Bank of Beirut and Bank Audi gateways (a news item, bankofbeirut.com/en/NewsRoom/482): not re-read; ask the banks if areeba or MontyPay fail.
- Stripe and PayPal "do not open merchant accounts for Lebanon" came from forum answers; **Stripe is now confirmed from its own page; PayPal remains unconfirmed.**

**Decision fed:** payments stay an adapter behind one `payment_intents` table (SYSTEM_PLAN 9). Changes from R4: (1) the founder sends
the seven questions to Whish, areeba and MontyPay now, in parallel; Tap goes last and only to ask whether it accepts Lebanese
companies, since its own support page says it does not; (2) **refunds through the API are assumed unavailable until a company
confirms them in writing**: PAY1 builds refunds as customer credit first and the API refund only when the provider's own
documentation allows it (MontyPay and Tap document one; Whish and areeba do not); (3) the Whish-first order stays, but only if
Whish answers question 1 (a new SARL) and an API question; PAY1's gate (a merchant account and sandbox credentials) is unchanged;
(4) OMT unchanged.

## (b) Website framework on Cloudflare

**Facts**
- Cloudflare bought the Astro company on 16 January 2026; Astro stays open source. Astro 6 (stable March 2026) rebuilt its
  Cloudflare adapter so development, prerendering and production all run the real Workers runtime; it needs Node 22 or later.
  Sources: cloudflare.com/press/press-releases/2026/cloudflare-acquires-astro...; Cloudflare Workers framework guide for Astro.
- Astro renders on the server and ships little JavaScript by default; interactive parts are opt-in "islands".

**Assumption:** our CI can move to Node 22 without touching the gateway (it runs on workerd, not Node).

**Decision fed:** the website is a third Worker (`apps/web/`), **Astro 6 with the Cloudflare adapter, server-rendered**, plain HTML
forms first, islands only for the cart counter and the tracking page. The console is **not** moved to a framework: it stays the
tested plain-HTML Worker and gains a design layer (docs/CONSOLE.md). Reason: 21 page modules and 67 tests exist; a rewrite buys nothing.

## (c) Maps, routing, geocoding

**Facts**
- Google Maps Platform: each SKU has its own free monthly allowance (10,000 calls for Essentials SKUs); Compute Routes Essentials
  and Route Matrix Essentials cost $5.00 per 1,000 after that; the universal $200 credit ended in March 2025.
  Source: developers.google.com/maps/billing-and-pricing/pricing.
- Our own design needs no geocoding: the pin is the coordinate (DECISIONS, "Route provider").

**Assumptions:** OpenStreetMap road coverage in the Shouf is good enough for travel-time estimates (unmeasured; the 20-journey
ride test in BUILD_PLAN 5.6 decides); a map tile provider's free tier covers the tracking page.

**Decision fed:** no change. Travel times stay a table (OSM-derived, then our own measured deliveries). Google Routes is used
only if the ride test shows it better by three minutes, and then inside the 10,000 free calls. The tracking page shows status
first; a map is added later with MapLibre and OSM tiles from a provider chosen in R4.

## (d) Speech providers for V1 to score on the 51 Shouf notes

**Facts**
- ElevenLabs Scribe (what Kapso uses) lists Levantine Arabic, including Lebanese, among its accents and publishes Arabic word
  error rates on FLEURS and Common Voice (vendor page: elevenlabs.io/speech-to-text/arabic).
- Cohere released an open-source Arabic model on 7 July 2026; in its own table Levantine is its weakest dialect (word error
  rate 39.78, against 19.16 for Egyptian). Source: huggingface.co/blog/CohereLabs/cohere-transcribe-arabic-07-2026-release.
- Soniox claims lower Arabic error than Scribe v2 Realtime and about $0.10 to $0.12 an hour (vendor comparison page).
- An independent code-switching benchmark (18 May 2026) ranked Scribe v2 first overall among five commercial systems on
  Arabic-English and other pairs (benchmarklist.com/benchmarks/asr_code_switch_benchmark).

**Assumption:** none of these numbers predicts Shouf voice notes; published Levantine results are poor and vendor-run.

**Decision fed:** V1 scores four systems on the 51 notes: Kapso's transcript (Scribe), ElevenLabs Scribe v2 called directly,
Soniox, and Cohere Transcribe Arabic (open source, run in the workflow). Score by item and quantity accuracy of the order read
from the transcript, not by word error rate. The founder then decides the provider and the retention wording.

## (e) Meta and Kapso: rules and prices

**Facts**
- Lebanon is billed in Meta's "Rest of Middle East" market. Service (free-form) messages are billed at the utility rate since
  1 October 2026, after 1,000 free per number per month; utility templates are billed from the first one; an account with no
  payment method stops delivering once the free messages are used. Sources: developers.facebook.com/docs/whatsapp/pricing;
  help.manychat.com article 14281380243740 (market list); agentdeals.dev/whatsapp-business-api-pricing-2026.
- **The published per-message rate differs by source:** utility $0.0091 and marketing $0.0392 (agentdeals, sleekflow), or
  utility $0.0105 and marketing $0.0451 (gallabox rate card "effective October 1, 2026"). The first bill decides (BUILD_PLAN 4.4).
  The cost model uses **$0.0105** (the higher one).
- Kapso: Pro is $25 a month with 100,000 messages (inbound and outbound both count), $0.002 per extra message, three connected
  numbers, $10 for each extra. Sources: kapso.ai/blog/whatsapp-api-pricing-2026 (reviewed 7 June 2026); docs.kapso.ai pricing FAQ.

**Not re-checked today (taken from BUILD_PLAN and HANDOFF, checked 12 to 14 November):** the 15 January 2026 bar on
general-purpose AI chatbots; the 24-hour window; template categories; product-list limits; Kapso's retention default
(indefinite) and its ElevenLabs transcription.

**Decision fed:** the cost model (section 5 of COST_MODEL.md); M1 keeps every code-started message a utility template; the
Concierge stays on ordering and delivery (task 1.18).

## (f) Web push and installable apps

**Facts**
- iPhone and iPad: web push works only after the person adds the site to the Home Screen from Safari, and the permission prompt
  must follow a tap. Safari has no install prompt (no `beforeinstallprompt`); web notifications there carry no images or action
  buttons. Android Chrome can prompt to install and can push from the browser or the installed app.
  Sources: pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications; developers.moengage.com article 13906923326100;
  mobiloud.com/blog/progressive-web-apps-ios.

**Decision fed:** the console is installable on both; push is an extra, never the only alarm. Every alert that matters also goes
to the founder on the ops WhatsApp line (as today) and shows in the console's exception list. The console shows a one-screen
"Add to Home Screen" guide on iPhone. Customers get no web push at launch: WhatsApp is the notification channel.

## (g) Just Eat on WhatsApp

**Facts**
- Announced 21 May 2026 as Europe's first food and retail ordering journey on WhatsApp, piloted in the Netherlands and Spain in
  the second quarter; search, selection and basket happen in the chat and payment is completed in the Just Eat app. It launched
  in the UK on 1 October 2026 for its 100,000 partners, on its own AI assistant. Sources:
  newsroom.justeattakeaway.com/en-WW/265881-...; thegrocer.co.uk/news/just-eat-launches-whatsapp-ordering-in-uk/724280.article.

**What is relevant:** a large platform runs an ordering assistant on WhatsApp with Meta's blessing, which supports the reading
that an assistant limited to ordering is within the rules; and it hands payment to its own surface, which is our "pay by link"
shape. **Not confirmed anywhere:** conversion, basket size, error rate, or how it handles substitutions. Nothing to copy beyond the shape.

## Answers to "Not checked in this session" (session R4, checked 14 November 2026)
About 18 searches and 22 page fetches (three refused with HTTP 403: areeba.com twice, the Ministry of Economy). Official pages first.
Where a Meta, Supabase or similar page was seen only in a search summary and not opened in full, it says so.

### 1. Whish Pay's own merchant documentation
Answered in (a). **Facts:** none of refunds, settlement time, merchant fees, webhook signature or a sandbox is published on
whish.money; the only merchant route is a form. **Assumption:** Whish Pay is a redirect checkout like its Shopify and WordPress
plugins suggest; unproven. **Decision it changes:** PAY1 builds the customer-credit refund first; Whish questions (a) go out before PAY1 starts.

### 2. areeba, MontyPay, Tap: onboarding, settlement, fees
Answered in (a), with the exact questions and contact routes. **Facts:** MontyPay (Beirut, BDL-authorised) and areeba (Beirut
office) are present in Lebanon and both document a hosted checkout; Tap's own support page says it takes no new Lebanese
merchants (28 April 2025). No company publishes fees or the settlement currency. **Decision it changes:** the order of approach
and the refund default, as stated in (a).

### 3. Meta's Business Messaging and Commerce policy (read through search summaries of Meta's own pages; not the full text)
**Facts**
- Meta's Terms for the WhatsApp Business Platform (section 4.7): providers of AI or machine learning technologies may not use the
  platform to offer those technologies when they are the primary function; the pricing page says this applies from 15 January 2026
  and that general-purpose assistants are allowed only where Meta is legally required to allow them. Meta charges AI providers for
  non-template messages in those regions from 16 February 2026.
- Opt-in: required before messaging people; it must name the business and say the person agrees to receive its messages; it can be
  general rather than WhatsApp-specific if local law is followed.
- Human escalation: automation is allowed inside the 24-hour window, but the business must offer a prompt, clear, direct escalation path
  (in-chat transfer to a person, phone, email or web support).
- Catalog: automatically reviewed; listings in restricted categories are flagged (prescription products, recalled or stolen goods,
  tobacco; the messaging policy also lists alcohol, firearms and drugs). A multi-product message shows up to 30 products; a carousel up to 10 cards.
**Assumption:** an ordering assistant for our own shop is not an "AI provider whose primary function is a general-purpose assistant".
The Just Eat launch (g) supports this reading; Meta has not said so for us.
**Decision it changes:** none now. Keep the Concierge on ordering and delivery (1.18); keep the product-list builder at 30 items or
fewer (check the code); make sure "talk to a person" always works on the customer line (the handoff exists; add it to T1's script).
A3 should read section 4.7 and the opt-in page in full before the paid pilot.

### 4. Kapso (docs.kapso.ai; the first 100,000 of about 992,000 characters of its full docs file read)
**Facts**
- Webhooks: header `X-Webhook-Signature`, a hex HMAC-SHA256 of the raw body with your secret key, no `sha256=` prefix, **no
  timestamp** (so a replay cannot be told from a first delivery by the signature). Retries after 10 and 40 seconds when no 200 comes back.
- API keys: "a single project API key authenticates all of them" (header `X-API-Key`). **No scopes or permission levels are described.**
- Rate limits, per API key: Free 100 a minute, Pro 2,000, Platform 4,000; phone health checks 5 a second.
- Erase contact: a documented call permanently erases a contact and its conversations, messages and media. **No retention period is
  stated.** No terms, SLA or transcription provider named in the part read.
**Assumption:** retention is indefinite (as HANDOFF says), the transcription provider is ElevenLabs (as HANDOFF says); neither is in the docs text read.
**Decisions it changes:** (1) G1-14's "narrow production key" cannot be made by scope: use **a separate Kapso project, and so a
separate key, for production**, and rotate on a schedule; (2) replay safety comes from our own dedupe on the WhatsApp message id (already
built), not from the signature; (3) the retention and transcription questions go to Kapso support in writing with the lawyer's answer (A3).

### 5. Platform limits and prices
- **Supabase** (pricing and backup pages, via search): Pro is $25 a month including $10 of compute credit (one Micro instance),
  8 GB of disk and 250 GB of uncached egress per project (then $0.125 a GB and $0.09 a GB); **7 days of daily backups on Pro**;
  point-in-time recovery is an add-on at about **$100 a month per 7 days of retention** ($200 for 14, $400 for 28). Decision:
  confirms the founder's answer 9: Pro with daily backups, one tried restore before real money, recovery later (cost model input now 0). A5's weekly check at 70% should use 8 GB of disk and 250 GB of egress.
- **Cloudflare Workers Paid** (developers.cloudflare.com, via search): $5 minimum; 10 million requests then $0.30 a million; 30 million CPU
  milliseconds then $0.02 a million; CPU 30 seconds by default, up to 5 minutes; 10,000 subrequests by default (raised from 1,000 on
  paid plans in February 2026); Queues 1 million operations included then $0.40 a million (about three operations per message). Queues are now also on the free plan (changelog, 4 February 2026).
  Our traffic is orders of magnitude below any of these. Decision: none. (A cron or queue consumer's maximum duration is stated two ways in the docs; check before relying on 15 minutes.)
- **Sentry**: the free Developer plan is limited to one user; Team is about $26 a month billed annually ($29 monthly) with 50,000 errors a month,
  then pay-as-you-go; data is dropped when the budget runs out. The Developer plan's error quota is shown as 5,000 on the pricing
  page but not confirmed in the docs. Decision for the founder: with two people (Rashid and Hussein) on Sentry, Team at about $29 a month is needed; it is not in the cost model.
- **GitHub Actions** (docs.github.com, via search): private repositories now get an included **dollar amount**, not a fixed number of minutes;
  a 2-core Linux runner costs $0.006 a minute; sources disagree on the Free plan's allowance (about $12 a month, roughly 2,000
  minutes). **Assumption (mine):** `intake.yml` every 30 minutes at one to two minutes a run is about 1,500 to 3,000 minutes a month on its own, which could use the whole Free
  allowance. Decision: H1 and I1 read this month's real usage from the billing page before I1 sets the schedule; check which plan the account is on.
- **Anthropic** (platform.claude.com rate-limits page, via search): monthly API spend caps by tier, $500 (Start), $1,000 (Build), $200,000 (Scale);
  a new organisation may start on a lower Evaluation tier; when the cap is reached API use pauses until 00:00 UTC on the first of the next month; an organisation can set
  its own lower limit. The Usage Policy text was **not checked**. The pricing page was only partly readable; the Claude plan names and prices
  (including what "the 100 USD plan" includes) are **unconfirmed** here. Decision: set the console limit below the tier cap (founder list 6); nightly evals about $46 a month fit well inside $500.

### 6. Open Food Facts (world.openfoodfacts.org terms of use and FAQ, via search)
**Facts:** the database is under the **ODbL** (attribution and share-alike); individual contents under the Database Contents
License; product **photos under CC BY-SA** (the licence covers the photo and the photographer's rights, not product design,
logos or people on the pack: "the responsibility of individuals and entities who wish to re-use ... to verify by themselves the
rights that may apply"). Attribution: name the licence and credit Open Food Facts with a link to openfoodfacts.org (or the product page).
Share-alike: publicly using an adapted database, or works made from one, means offering the adapted database under the ODbL; the FAQ
says combining with other databases obliges the result to be open. **Assumption:** a customer-facing website that shows OFF facts
beside our own prices is a "produced work" needing credit, and our internal tables are not "public use"; this is a legal
reading, not Open Food Facts' statement. **Decision it changes:** none in code (source, status and credit are already stored; pages credit OFF as
WEB1 requires). **New lawyer question (added to SYSTEM_PLAN, lawyer 8):** does storing OFF facts next to our price and cost data, and showing them on the site, trigger the ODbL share-alike duty; keep OFF-sourced fields identifiable by source until answered.

### 7. Map tiles and routing
- **OpenStreetMap's own tile servers** (operations.osmfoundation.org/policies/tiles): donation-funded; need an identifying User-Agent, visible
  attribution and caching (7 days at least); no bulk or offline use; access may be withdrawn without notice, and commercial services are warned. **Do not use them for the tracking page.**
- **MapTiler Cloud** (maptiler.com): free plan 100,000 API requests and 5,000 sessions a month, **but its terms limit the free plan to non-commercial use and R&D** (the pricing
  page contradicts itself); the Flex plan is $30 a month. **Mapbox** (mapbox.com/pricing): web map loads free up to 50,000 a month, then $5 per 1,000 up to 100,000.
- **OSM coverage of the Shouf:** not answerable from the web; the 20-journey ride test (BUILD_PLAN 5.6) stays the only measure.
**Decision it changes:** the tracking-page map (later, MapLibre per (c)) takes tiles from **Mapbox's free 50,000 loads** (about 900 tracking views a month at 30 orders a day) or from MapTiler Flex at $30; never from OSM's servers. Choose when the page is built (WEB2/D5); add $0 or $30 to the cost model then.

### 8. Lebanese rules (secondary sources; none replaces the lawyer)
- **Law 81 of 2018** (electronic transactions and personal data): passed October 2018, in force from March 2019 per summaries;
  legal summaries call it a limited framework with no independent regulator and little enforcement; compliance vendors overstate it.
  Decision: no change; the privacy notice and the retention questions stay with the lawyer (SYSTEM_PLAN, lawyer 1).
- **Consumer Protection Law 659 of 2005** (amended 2014): article 5 is the price-display provision. A Ministry of Economy circular of 24 May 2019 (4/1/E.T) required
  prices in Lebanese pounds on goods or shelves (the Ministry's page refused a direct fetch, so this is from a news summary and the page title). In 2025 the Tourism
  Ministry allowed dollar prices if the final invoice shows pounds and dollars. **Whether the 2019 circular still binds shops is unconfirmed.**
  **Decision it changes:** our rule "prices in dollars, the pound amount at the approved rate when asked" (SYSTEM_PLAN 14) may fall short of the circular if it still binds. Until the
  lawyer answers (lawyer 4): make the pound total on the order card and receipt **a setting** (on or off), not hard-coded either way. Nothing is built by R4.
