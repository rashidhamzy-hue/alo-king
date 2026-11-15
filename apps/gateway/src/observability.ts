// Error tracking scrubbing (build plan 0.8) now lives in packages/core/src/scrub.ts so the console and the website scrub the same way
// (OPS1). This file keeps the gateway's import path. Tested in apps/gateway/test/observability.test.ts.
export * from "@ak/core/scrub";
