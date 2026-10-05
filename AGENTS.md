<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Backend is the user's existing external Supabase project via `src/lib/supabase.ts` (publishable key only); never create tables or enable Lovable Cloud — schema and RLS are owned externally.
- Never `select('*')` on `vendors`; use `VENDOR_COLUMNS` from `src/lib/config.ts` — anon may only read those columns.
- Shared business constants (LBP rate, COD cap, WhatsApp number) live only in `src/lib/config.ts` so they change in one place.
- Driver PWA uses a hand-written `public/manifest.webmanifest` + `public/sw.js` instead of vite-plugin-pwa, because the plugin doesn't fit the SSR build.
- Leaflet is only imported from `src/components/track/TrackMap.tsx`, lazy-loaded behind `<ClientOnly>`, since it touches `window` at import.
