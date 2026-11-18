# packages/ui: Alo King's design system

One look for the console and the website (session DS1; decisions in `docs/strategy/05-console-website-design-handoff.md`, section C).
The look itself is the founder's design reference, applied by session DS2 (`docs/DECISIONS.md`, "Design reference, 17 November 2026"):
ink `#0E0F12`, gold `#C9A227`, gold-deep `#8A6A12` for gold text on paper, paper `#FAF8F3`, green only for "available" and "done",
WhatsApp green only on a WhatsApp action. The reference is a pattern: none of its code is here.

| Path | What it is |
|---|---|
| `tokens.css` | **The one file** with every colour, font, size, radius, shadow and the logo reference, light and dark. Change the brand here |
| `styles/theme.ref.css` | WEB4a: the founder's reference's Tailwind theme (its class names: `bg-ink`, `text-muted-foreground`, `rounded-3xl`, `shadow-card`) mapped onto the tokens, for the website's reference components (`apps/web/src/components/ref`). No value in it; the console does not load it |
| `styles/` | `base.css` (page defaults), `components.css` (shared by every page), `components.more.css` (tabs, toast, loading, error, timeline, dialog, stepper, cart bar: loaded only by a page that shows one), `components.ops.css` (console), `components.shop.css` (website), `gallery.css`, `theme.css` (Tailwind's theme, pointing at the tokens), `console.css` (the console's entry) |
| `src/components.ts` | The components as HTML functions: button, field, input, select, chip, badge, status pill, card, KPI tile, timer chip, limit bar, data table, drawer, dialog, toast (with Undo), tabs, command bar, bell, empty, loading, error, the "not confirmed yet" fact row, price with unit price, stepper, preview notice, product card, cart bar, order timeline, case row |
| `src/status.ts` | The one label table for order statuses: the database's ids, staff words and customer words, Arabic and English; `statusPill()` |
| `astro/` | Astro components that wrap the same functions, for the website |
| `src/crown.ts`, `crown.svg` | The crown mark (waits for the founder's approval) |
| `src/icons.ts` | Generated: the Lucide icons in use (ISC licence) |
| `src/gallery.ts` | The gallery both apps show on staging at `/gallery` |
| `fonts/` | IBM Plex Sans and IBM Plex Sans Arabic, subset, WOFF2 (SIL Open Font License, `OFL.txt`) |
| `scripts/build.mjs` | Writes the generated files (the console's sheet, fonts as base64, icons, tokens as data, the crown files) |
| `scripts/make-icons.mjs` | Redraws the app icons of both apps from the crown (needs Playwright's Chromium; run by hand) |
| `scripts/subset-fonts.py` | Remakes the font files (needs `fonttools` and `brotli`; run by hand) |

## Rules
- No React in packages/ui or the console, no runtime styling: Tailwind v4 compiles at build time. (WEB4a: the website renders the reference's React components on the server only, from `apps/web/src/components/ref`; no React reaches a browser.) The console's sheet is committed as `apps/console/src/ui.generated.ts`; the website's is built by Astro.
- After a change to `tokens.css`, `styles/*`, the icon list, or a class name used in `apps/console/src`, run `node packages/ui/scripts/build.mjs` and commit what it writes. `test/ui/design-system.test.ts` fails when a generated file is stale.
- Tailwind utilities carry the prefix `tw:` (`tw:flex`), so no ordinary word in a page becomes a class.
- No inline style and no inline script, ever: both apps' content policy forbids them. Sizes that depend on data are SVG attributes.
- Logical properties only (`inline`, `block`, `start`, `end`): Arabic mirrors with no second sheet.
- The rules for staff screens (from the reference; `test/ui/ds2.test.ts`): no tap target under 44 px (`--ak-tap`; a button or input is 48, `--ak-control`); nothing is decided by a swipe; a reversible action shows a toast with Undo instead of asking "are you sure"; a timer or a status always carries words and an icon, never colour alone.
- Gold text (`--ak-accent`, gold-deep) sits on paper, on a card or on `--ak-accent-soft`. It is 4.29:1 on `--ak-surface-2` and 4.32:1 on `--ak-tint`, so no text is gold there.
- A shop page's first-visit weight is reported per page in each pull request (the 100 KB budget was lifted on 18 November 2026, `docs/DECISIONS.md`); free savings stay: a component only some pages show goes in `components.more.css`, imported by those pages. The website's tests (WEB4a) report each page's weight and check that the site's own pictures are WebP and lazy below the fold.
- Every colour pair a page uses is in `CONTRAST_PAIRS` (`src/gallery.ts`) and must pass AA in both themes; add a pair when you use a new one.
- A component takes words and numbers already decided. It never reads data, formats money for a business rule, or knows a village, fee or hub.
- Screenshots for a pull request: `SCREENS=<folder> npx vitest run test/screens` (390 and 1440 px, Arabic and English, light and dark). DS2's set (390 and 1280 px, beside the reference): `test/screens/ds2.test.ts`.
