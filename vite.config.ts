// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vercel's Supabase integration sets SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or the NEXT_PUBLIC_
// and legacy anon names). Map the public ones to the VITE_ names the app reads. Never the service key.
const pick = (...names: string[]) => names.map((n) => process.env[n]).find(Boolean);
process.env.VITE_SUPABASE_URL ||= pick("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") ?? "";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||=
  pick(
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ) ?? "";
// Sentry environment and release from Vercel's system variables.
process.env.VITE_VERCEL_ENV ||= process.env.VERCEL_ENV ?? "";
process.env.VITE_VERCEL_GIT_COMMIT_SHA ||= process.env.VERCEL_GIT_COMMIT_SHA ?? "";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
