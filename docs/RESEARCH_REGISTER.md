# Research register (session S1, checked 14 November 2026)

Only questions that change a decision. Each has what the sources say (**fact**), what is still a guess (**assumption**), and the
decision it feeds. Eleven web searches were run, not the 25 allowed: the session's budget went to the audit. What was not
checked is listed at the end as work for session `R4`. Vendor pages and vendor benchmarks are marked as such.

## (a) Card payments for a Lebanese company; Whish and OMT merchant APIs

**Facts**
- Stripe and PayPal do not open merchant accounts for Lebanon (forum answers from platform staff; Stripe's own list has about 46
  countries and Lebanon is not on it). Source: discourse.webflow.com/t/country-not-found-in-country-list-for-business-address/118410;
  redstagfulfillment.com/how-many-countries-does-stripe-operate-in.
- **Whish has a merchant payment API.** "Whish Pay" is a hosted, redirect checkout with a sandbox and USD and LBP; WHISH SAL
  published its own Shopify app on 27 March 2025. A third-party Odoo connector states that refunds, tokenisation and manual
  capture are not available through the API it uses. Sources: apps.shopify.com/whishpay; apps.odoo.com/apps/modules/19.0/payment_whish.
- **OMT: no public merchant checkout API was found.** OMT Pay is a consumer wallet with QR payment in shops and "payment links"
  for adding money. Source: omt.com.lb/en/omt-pay.
- Lebanese card acquirers with an online gateway: **areeba** (publishes integration documentation), **MontyPay** (gateway, payment
  links, invoice links), Bank of Beirut and Bank Audi gateways. Sources: paymentproviders.io/providers/areeba.md;
  en.annahar.com/en/business-tech/280953; bankofbeirut.com/en/NewsRoom/482.
- **Tap Payments** (Kuwait) is reported to serve Lebanon, at roughly 2.5 to 2.9% on international cards, and to require a
  registered company. These come from a Lebanese web agency's guide and a merchant forum, not from Tap. Sources:
  voxire.pages.dev/blog/payment-gateways-lebanon-ecommerce-2026; community.shopify.com/t/payment-gateways-for-lebanon/373716.
- The same forum reports NetCommerce as not functional and its bank as denying the service: treat it as dead until proven.
- Banque du Liban issued a licensing framework for electronic payment providers in January 2026 (secondary source:
  pulse.bot fintech summary of The Fintech Times, 9 May 2026).

**Assumptions** (to be replaced by the providers' written answers): areeba, MontyPay and Tap will onboard a new SARL with no
trading history; they settle in fresh dollars to a Lebanese account; fees are 2.5 to 3.5%; a hosted page exists so we never
see card data; refunds work through the API.

**Decision fed:** payments are an adapter behind one `payment_intents` table (SYSTEM_PLAN section 9). Order: Whish Pay first
(the customers already use it, and it removes the screenshot step), then one card gateway for buyers abroad. The founder applies
to areeba, MontyPay and Tap in parallel; whichever answers in writing first is integrated. Nothing is built for OMT until OMT
confirms an API in writing; OMT stays "screenshot, confirmed by a person".

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

## Not checked in this session (for R4, Sonnet, about 14 searches)
1. Whish Pay's own merchant documentation: refunds, settlement time, fees, webhook signature.
2. areeba, MontyPay, Tap: onboarding requirements for a new Lebanese SARL, settlement currency, fees (ask each in writing).
3. Meta's current Business Messaging and Commerce policy text: AI chatbot rule, opt-in, human escalation, catalog restrictions.
4. Kapso: terms, rate limits, webhook signature scheme, retention setting, the scope options of API keys.
5. Supabase plan limits and point-in-time recovery price; Cloudflare Workers Paid limits (CPU, queues); Sentry quota; GitHub
   Actions minutes on a private repository; Anthropic usage policy and spending caps.
6. Open Food Facts: ODbL duties for stored facts and the picture licences.
7. Map tiles and routing: OSM coverage of the Shouf, a tile provider's free tier, Mapbox prices.
8. Lebanese rules: consumer price display, Law 81 of 2018 (lawyer's questions are in SYSTEM_PLAN, founder list).
