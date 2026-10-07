# Agent instructions

Read `CLAUDE.md` and `docs/decisions/DECISIONS.md` before any change. `docs/decisions/DECISIONS.md` overrides every other file in this repository.

Rules carried over from the legacy code that still apply until Phase 0 and Phase 1 replace them:
- Never `select('*')` on `vendors` from the front end.
- The driver PWA uses a hand-written `public/manifest.webmanifest` and `public/sw.js` (vite-plugin-pwa does not fit the SSR build).
- Leaflet is imported only from `src/components/track/TrackMap.tsx`, lazy-loaded behind `<ClientOnly>`, because it touches `window` at import.
- Merchant dashboard pages are nested routes under `src/routes/merchant.*` sharing vendor and role state via `src/components/merchant/context.tsx`.

The Lovable notice and the "never rewrite history for Lovable sync" rule are removed: Lovable is no longer connected (DECISIONS §11).
