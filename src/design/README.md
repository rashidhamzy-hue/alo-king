# Alo King design system (DECISIONS §5, §24.1, §37)

The public website's look, in one place. Built for session 6a; the merchant, driver and admin pages move onto it in 6b.

## Idea
"Alo" means hello, and the product is a conversation, so the site is one. Night is the hero mode: ink `#17131A` with Crown Gold
`#F4B63C` light, like a warm shop sign in a village at night. Cream `#FFF9F0` is for reading. Gold is a fill or a glow, never text
on cream (1.7:1). Measured contrast: gold on ink 10.1, ink on cream 17.5, text on night 16.4, muted on night 9.8, muted on cream 7.3.

## Files
- `design.css`: tokens (`--ink`, `--gold`, `--cream`, ...), the `tone-night` / `tone-cream` classes, type scale, buttons (`ak-btn-*`),
  cards, chips, the chat and phone components, the CSS-only motion, the FAQ accordion and prose styles. All motion stops under
  `prefers-reduced-motion` and shows its end state.
- `fonts.css`: Plus Jakarta Sans (Latin) and IBM Plex Sans Arabic, self-hosted, no third-party host. Faces use `font-display: optional`
  and are preloaded by the language layout, so text never reflows (layout shift). The Arabic faces are subsets
  (`fonts/plex-arabic-*.woff2`, rebuilt with `scripts/web/subset-fonts.sh`).
- `Crown.tsx` (the hand-drawn crown), `icons.tsx` (WhatsApp glyph), `Contours.tsx` (the Chouf contour lines as an inline SVG symbol).
- `contours.generated.ts` and `lebanon-dots.generated.ts` are generated: `scripts/web/build-contours.mjs` and
  `scripts/web/build-lebanon-dots.mjs`. The dots read `supabase/seed/places/places.csv` (read-only, §31). **Re-run
  `build-lebanon-dots.mjs` after the data finalisation session (D) replaces the places list.**

## Rules
- **Tone, not colour names.** A section picks `tone-night` or `tone-cream`; children use `bg-tone-surface`, `text-tone-mute`,
  `border-tone-line`. Never hard-code a colour in a page.
- **Right-to-left is first-class.** Use logical properties only (`ms-`, `ps-`, `start-0`, `text-start`, `rtl:`), never `left`/`right`.
  Numbers and prices go in `<bdi>`. Arabic gets its own font size, weight and line height (`html[lang="ar"]` rules).
- **No stock look, no stock photos.** Food imagery only from claimed merchants, or illustrated. No invented reviews, ratings or counts.
- **One action per page:** `OrderButton` ("Order on WhatsApp", a `wa.me` link with context in the text).
- **Budgets** (enforced in CI, `scripts/web/`): Lighthouse mobile 90+ for performance, accessibility and SEO; LCP under 2.5 s;
  public-page JavaScript under 150 KB gzipped; axe with no serious issues; no horizontal overflow; no console errors.

## Things that took measuring (keep them)
- A CSS `background-image` can be the page's LCP element; the contour texture is an inline SVG symbol for that reason.
- The root language provider must follow the URL language from the first render, or hydration flips the page to left-to-right for a
  moment (layout shift of 0.88 in Arabic).
- `src/server.ts` defers the framework script until after `load` for `/ar`, `/en`, `/fr` HTML (`lib/html-head.ts`): early script
  downloads delayed the first paint by about 0.7 s on a simulated 4G phone. Everything above the fold works without JavaScript.
- Data fetching (`react-query`), toasts and the full Sentry SDK are for private pages only. Public pages report errors with a 1 KB
  reporter (`lib/sentry.ts`).

## Checking a change
```
scripts/web/qa-serve.sh start live            # builds against the fixture mock (scripts/web/fixtures.mjs), serves on 4010 / 4011
node scripts/web/qa.mjs --base http://127.0.0.1:4011 --out qa-out     # screenshots + axe + overflow + JS budget + interactions
node scripts/web/lighthouse.mjs --base http://127.0.0.1:4011 --out qa-out
scripts/web/qa-serve.sh stop
```
The fixtures are made up (shops, dishes, orders). `qa-serve.sh start prelaunch` shows the state before anything is switched on.
