# packages/ui: Alo King's design system

One look for the console and the website (session DS1; decisions in `docs/strategy/05-console-website-design-handoff.md`, section C).

| Path | What it is |
|---|---|
| `tokens.css` | **The one file** with every colour, font, size, radius, shadow and the logo reference, light and dark. Change the brand here |
| `styles/` | `base.css` (page defaults), `components.css` (shared), `components.ops.css` (console), `components.shop.css` (website), `gallery.css`, `theme.css` (Tailwind's theme, pointing at the tokens), `console.css` (the console's entry) |
| `src/components.ts` | The components as HTML functions: button, input, select, chip, badge, card, KPI tile, timer chip, limit bar, data table, drawer, dialog, toast, tabs, command bar, bell, empty, loading, error, product card, cart bar, order timeline, case row |
| `astro/` | Astro components that wrap the same functions, for the website |
| `src/crown.ts`, `crown.svg` | The crown mark (waits for the founder's approval) |
| `src/icons.ts` | Generated: the Lucide icons in use (ISC licence) |
| `src/gallery.ts` | The gallery both apps show on staging at `/gallery` |
| `fonts/` | IBM Plex Sans and IBM Plex Sans Arabic, subset, WOFF2 (SIL Open Font License, `OFL.txt`) |
| `scripts/build.mjs` | Writes the generated files (the console's sheet, fonts as base64, icons, tokens as data, the crown files) |
| `scripts/make-icons.mjs` | Redraws the app icons of both apps from the crown (needs Playwright's Chromium; run by hand) |
| `scripts/subset-fonts.py` | Remakes the font files (needs `fonttools` and `brotli`; run by hand) |

## Rules
- No React, no runtime styling: Tailwind v4 compiles at build time. The console's sheet is committed as `apps/console/src/ui.generated.ts`; the website's is built by Astro.
- After a change to `tokens.css`, `styles/*`, the icon list, or a class name used in `apps/console/src`, run `node packages/ui/scripts/build.mjs` and commit what it writes. `test/ui/design-system.test.ts` fails when a generated file is stale.
- Tailwind utilities carry the prefix `tw:` (`tw:flex`), so no ordinary word in a page becomes a class.
- No inline style and no inline script, ever: both apps' content policy forbids them. Sizes that depend on data are SVG attributes.
- Logical properties only (`inline`, `block`, `start`, `end`): Arabic mirrors with no second sheet. No control smaller than 44 px.
- Every colour pair a page uses is in `CONTRAST_PAIRS` (`src/gallery.ts`) and must pass AA in both themes; add a pair when you use a new one.
- A component takes words and numbers already decided. It never reads data, formats money for a business rule, or knows a village, fee or hub.
- Screenshots for a pull request: `SCREENS=<folder> npx vitest run test/screens` (390 and 1440 px, Arabic and English, light and dark).
