#!/usr/bin/env node
// Lighthouse, mobile (simulated 4G, the default), on the pages that matter (DECISIONS §37.5):
// performance, accessibility and SEO at 90 or more, LCP under 2.5 s. Fails when any page misses.
// Each page is run three times and the run with the median LCP is reported: one slow run on a shared CI machine says
// little, and Lighthouse itself recommends the median of several runs. The budgets do not change.
//   node scripts/web/lighthouse.mjs --base http://127.0.0.1:4010 --out qa-out [--runs 3]
import { mkdirSync, writeFileSync } from "node:fs";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";
import { TRACK_TOKENS } from "./fixtures.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://127.0.0.1:4010");
const out = arg("out", "qa-out");
const PAGES = [
  ["home-ar", "/ar"],
  ["home-en", "/en"],
  ["home-fr", "/fr"],
  ["place-en", "/en/places/chf-baakline"],
  ["vendor-ar", "/ar/m/abou-ali-shawarma"],
  ["send-home-fr", "/fr/send-home"],
  ["help-en", "/en/help"],
  ["privacy-en", "/en/legal/privacy"],
  // A tracking link is private on purpose (noindex), so it is held to performance and accessibility only.
  ["track-en", `/en/track/${TRACK_TOKENS.delivery}`, { private: true }],
];
const RUNS = Math.max(1, Number(arg("runs", "3")) || 3);
const MIN = 0.9,
  LCP_MS = 2500;
mkdirSync(out, { recursive: true });

const port = 9222;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [`--remote-debugging-port=${port}`],
});
let failed = 0;
const rows = [];
for (const [id, path, opts] of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await lighthouse(`${base}${path}`, {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "seo"],
    });
    if (r?.lhr) runs.push(r.lhr);
  }
  runs.sort(
    (a, b) =>
      (a.audits["largest-contentful-paint"]?.numericValue ?? 0) -
      (b.audits["largest-contentful-paint"]?.numericValue ?? 0),
  );
  const lhr = runs[Math.floor((runs.length - 1) / 2)];
  if (!lhr) {
    failed++;
    rows.push({ id, error: "no result" });
    continue;
  }
  const s = (c) => Math.round((lhr.categories[c]?.score ?? 0) * 100);
  const lcp = Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 0);
  const row = {
    id,
    performance: s("performance"),
    accessibility: s("accessibility"),
    seo: s("seo"),
    lcpMs: lcp,
  };
  const bad = [];
  for (const c of ["performance", "accessibility", "seo"])
    if (row[c] < MIN * 100 && !(opts?.private && c === "seo")) bad.push(`${c} ${row[c]}`);
  if (lcp > LCP_MS) bad.push(`LCP ${lcp} ms`);
  if (bad.length) failed++;
  rows.push({ ...row, bad });
  writeFileSync(
    `${out}/lighthouse-${id}.json`,
    JSON.stringify(
      {
        ...row,
        audits: Object.fromEntries(
          Object.entries(lhr.audits)
            .filter(([, a]) => a.score !== null && a.score < 0.9)
            .map(([k, a]) => [k, a.title]),
        ),
      },
      null,
      2,
    ),
  );
}
await browser.close();
writeFileSync(`${out}/lighthouse.json`, JSON.stringify(rows, null, 2));
console.log("page            perf  a11y  seo   LCP");
for (const r of rows)
  console.log(
    `${r.id.padEnd(15)} ${String(r.performance).padEnd(5)} ${String(r.accessibility).padEnd(5)} ${String(r.seo).padEnd(5)} ${r.lcpMs} ms ${r.bad?.length ? "  <-- " + r.bad.join(", ") : ""}`,
  );
process.exit(failed ? 1 : 0);
