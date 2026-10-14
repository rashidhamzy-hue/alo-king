# Alo King design system (DECISIONS §5, §24.1, §37, §39.11)

One system for the public site, the business side and the staff apps. Session 6a built it; session W (§39.11) refreshed it
and split the site in two.

## Idea: lights in the Chouf
"Alo" means hello, and the product is a conversation, so the site is one. **Customers live at night:** ink `#17131A` with
Crown Gold `#F4B63C` light, like the view from a balcony in Baakline after dark, every village a light. **Businesses work by
day:** cream `#FFF9F0` and paper `#FFFDF8`, ink type, gold only as a fill (a stamp on a receipt). The two sides share the
type, the crown, the components and the tokens, and never share pages, navigation or FAQs (§39.11).

Gold is a fill or a glow, never text on cream (1.7:1); where a component asks for gold text in a cream tone it becomes
`--gold-text` (#855400, 6:1). Measured contrast: gold on ink 10.1, ink on cream 17.5, text on night 16.4, muted on night 9.8,
muted on cream 7.3.

## Tokens (`design.css` `:root` and the tones)
- Colour: `--ink`, `--ink-0` (deepest night), `--ink-2/3` (raised), `--gold`, `--gold-hi`, `--cream`, `--cream-2/3`, `--paper`,
  `--sand` (lines by day).
- Radius hierarchy: `--r-xl` 2rem (panels, maps, phones), `--r-lg` 1.25rem (cards), `--r-md` 0.8rem (fields, rows), pills
  for buttons and chips.
- **Tones, not colour names.** A section picks `tone-night` or `tone-cream`; everything inside reads variables the tone sets
  (`--tone-*`, `--card-bg`, `--card-line`, `--on-bg/--on-fg`, `--field-bg`, `--gold-text`, and the shadcn variables in
  `src/styles.css`). Custom properties inherit, so the nearest tone always wins: a night panel inside the cream business
  shell (the kitchen terminal, "the counter") and a cream section inside the night site both get their own surfaces. Never
  write `.tone-night .x` / `.tone-cream .x` pairs: with both tones in the ancestry the later rule wins regardless of nesting.
- Unlayered CSS beats Tailwind's layered utilities, and layered `!important` beats unlayered `!important`: hide or colour
  `ak-*` components with their own classes (`ak-head-signin`) or variables, not `max-md:hidden` / `!text-gold`.

## Type
Plus Jakarta Sans (Latin) and IBM Plex Sans Arabic, self-hosted (`fonts.css`, `font-display: optional`, preloaded by the
language layout). Display sizes are set tight (800, −0.045em, 0.98 line height) and large; Arabic gets its own weight (700),
line height and size. Labels before headings (`ak-eyebrow`) are sentence case with a lantern dot, never tracked capitals.
Numbers and prices are tabular (`ak-num`) and set in `<bdi>`; amounts inside running text go through `iso()` (Unicode
isolates) so "$2.00 to $6.00" reads right in Arabic.

## Signature pieces
- **The lantern** (`ak-lantern`, `zm-key-shops`): a lit gold dot means "on": a village we deliver to with shops on Alo King,
  a shop that is open. A gold ring means shops that are not on Alo King yet.
- **"ألو" behind the home headline** (`ak-hero-word`): the brand's own word as a sign lit from inside, in every language.
- **The delivery map** (`components/site/map/`): the §39.2 zone from the places seed. `scripts/web/build-chouf-map.mjs` writes
  `chouf-map.generated.ts` (names, search words, positions: about 5 KB gzipped in the page) and two static files,
  `public/chouf-map.svg` (the polygons, fetched after first paint and painted by CSS from live data) and
  `public/chouf-zone.svg` (a painted still for the home page and place pages, an `<img>`, no JavaScript). Re-run it when
  the boundary file or the places list changes. Search (`lib/zone-search.ts`) matches Arabic, English, French and Arabizi.
- **The receipt** (`ak-receipt`): the business calculator on paper with a perforated edge.
- **The counter** (`ak-counter`): the ink panel on the business side, where the work happens.
- Contour lines of the Chouf (`Contours.tsx`, static SVG symbol), the hand-drawn crown, chat bubbles and the phone frame.

## Motion
One orchestrated moment per page: the chat hero plays an order; the map eases to a village when you pick it. Everything
stops under `prefers-reduced-motion` and shows its end state.

## Rules
- Right-to-left is first-class: logical properties only (`ms-`, `ps-`, `start-0`, `text-start`, `rtl:`); the map is geography,
  so its pin positions are physical (`left`), on purpose.
- No stock look and no stock photos: food imagery only from claimed merchants, or illustrated. No invented reviews, ratings
  or counts: every number on a page comes from the database (counts, fees, shops listed).
- One action per page: `OrderButton` on the customer side, "Claim your shop" on the business side.
- Budgets (CI, `scripts/web/`): Lighthouse mobile 90+ for performance, accessibility and SEO; LCP under 2.5 s; public-page
  JavaScript under 150 KB gzipped; axe with no serious issues; no horizontal overflow; no console errors.

## Things that took measuring (keep them)
- A CSS `background-image` can be the page's LCP element; the contour texture is an inline SVG symbol for that reason.
- The root language provider must follow the URL language from the first render, or hydration flips the page to
  left-to-right for a moment (layout shift of 0.88 in Arabic).
- `src/server.ts` defers the framework script until after `load` for `/ar`, `/en`, `/fr` HTML (`lib/html-head.ts`).
- Data fetching (`react-query`), toasts and the full Sentry SDK are for private pages only; public pages use `lib/rest.ts`.
- Changing the address with `history.replaceState` from a component made the router reload the page's data and the copy
  (44 KB): the map keeps its selection in state and reads `?v=` only on arrival.
- A grid with one implicit column sizes it from its widest child: give it `minmax(0, 1fr)`.

## Checking a change
```
scripts/web/qa-serve.sh start live            # builds against the fixture mock (scripts/web/fixtures.mjs), serves on 4010 / 4011
node scripts/web/qa.mjs --base http://127.0.0.1:4011 --out qa-out              # public pages
node scripts/web/qa-private.mjs --base http://127.0.0.1:4011 --out qa-out-p    # staff pages
node scripts/web/lighthouse.mjs --base http://127.0.0.1:4011 --out qa-out
scripts/web/qa-serve.sh stop
```
The fixtures are made up (shops, dishes, orders); the zone's villages are the real §39.2 list. `qa-serve.sh start prelaunch`
shows the state before anything is switched on.
