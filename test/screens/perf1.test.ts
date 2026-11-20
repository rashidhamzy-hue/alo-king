// PERF1: what a first visit to the website costs on a phone, measured by the browser against a running site (staging by default).
//   * 390 px wide, Arabic, a first visit (nothing cached), the network as Lighthouse's "slow 4G" (150 ms, 1.6 Mbps down, 750 kbps up)
//     and the CPU four times slower, through Chromium's DevTools protocol;
//   * every byte the page fetched before the network went quiet, from every origin (the catalogue's product pictures included), as
//     the network counted it (compressed), and the largest contentful paint as the page reported it;
//   * fails when a page is over 600 KB or its largest paint is 2.5 s or later (PERF1's targets), and writes perf1-weights.txt.
// It reads a live site, so it is skipped unless PERF_URL names one or SCREENS names a folder (the `screens` workflow, action shoot,
// test perf1.test.ts, which then measures staging):
//   PERF_URL=https://alo-king-web-staging.rashid-hamzy.workers.dev SCREENS=/tmp/perf npx vitest run test/screens/perf1.test.ts
// PERF_ONLY_REPORT=1 writes the table without failing (used once for the "before" column of docs/log/perf1.md).
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCREENS;
const BASE = (process.env.PERF_URL ?? (OUT ? "https://alo-king-web-staging.rashid-hamzy.workers.dev" : "")).replace(/\/+$/, "");
const REPORT_ONLY = process.env.PERF_ONLY_REPORT === "1";
export const PAGES = ["/", "/aisles", process.env.PERF_AISLE ?? "/c/dairy_eggs"];
export const MAX_BYTES = 600 * 1024;
export const MAX_LCP_MS = 2500;
/** Lighthouse's "slow 4G" (its mobile default): 150 ms round trip, 1.6 Mbps down, 750 kbps up; the CPU four times slower. */
export const SLOW_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

interface Measure { path: string; bytes: number; requests: number; pictures: number; pictureBytes: number; lcpMs: number }

async function measure(browser: any, path: string): Promise<Measure> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ar-LB",
    timezoneId: "Asia/Beirut", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (alo-king perf1)" });
  await ctx.addCookies([{ name: "lang", value: "ar", url: BASE }]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const urls = new Map<string, string>();
  let bytes = 0; let requests = 0; let pictures = 0; let pictureBytes = 0;
  cdp.on("Network.responseReceived", (e: any) => urls.set(e.requestId, e.response.url));
  cdp.on("Network.loadingFinished", (e: any) => {
    requests++; bytes += e.encodedDataLength;
    if (/\/storage\/v1\/(object|render)\//.test(urls.get(e.requestId) ?? "")) { pictures++; pictureBytes += e.encodedDataLength; }
  });
  await page.addInitScript(() => {
    (window as any).__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__lcp = Math.max((window as any).__lcp, e.startTime); })
      .observe({ type: "largest-contentful-paint", buffered: true });
  });
  const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 120_000 });
  expect(res?.status(), path).toBe(200);
  await page.waitForTimeout(500);
  const lcpMs = Math.round(await page.evaluate("window.__lcp") as number);
  await ctx.close();
  return { path, bytes, requests, pictures, pictureBytes, lcpMs };
}

describe.skipIf(!BASE)("PERF1: a first visit on a slow phone network", () => {
  it(`home, the aisles and one aisle: under ${MAX_BYTES / 1024} KB and a largest paint under ${MAX_LCP_MS / 1000} s, Arabic, 390 px, slow 4G`, async () => {
    const { chromium } = createRequire(import.meta.url)("playwright");
    const browser = await chromium.launch();
    const rows: Measure[] = [];
    try { for (const p of PAGES) rows.push(await measure(browser, p)); } finally { await browser.close(); }
    const kb = (b: number) => (b / 1024).toFixed(1);
    const lines = [`PERF1 first visit, ${BASE}, Arabic, 390 px (DPR 2), slow 4G (150 ms, 1.6 Mbps), CPU x4, ${new Date().toISOString()}`,
      ...rows.map((r) => `${r.path}: ${kb(r.bytes)} KB in ${r.requests} requests (product pictures ${r.pictures}, ${kb(r.pictureBytes)} KB); LCP ${(r.lcpMs / 1000).toFixed(2)} s`)];
    console.log(lines.join("\n"));
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, "perf1-weights.txt"), lines.join("\n") + "\n"); }
    if (REPORT_ONLY) return;
    for (const r of rows) {
      expect(r.bytes, `${r.path}: ${kb(r.bytes)} KB on a first visit`).toBeLessThan(MAX_BYTES);
      expect(r.lcpMs, `${r.path}: largest contentful paint ${r.lcpMs} ms`).toBeLessThan(MAX_LCP_MS);
    }
  }, 600_000);
});
