#!/usr/bin/env node
// Website quality pass (DECISIONS §37.5): screenshots of every public page in each language at mobile and desktop size,
// plus checks on the same visits: axe (no serious or critical issues), horizontal overflow, console errors, and the
// gzipped JavaScript each page loads (budget 150 KB).
//   node scripts/web/qa.mjs --base http://127.0.0.1:4010 --out qa-out [--only home,vendor] [--langs ar,en] [--no-shots]
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { TRACK_TOKENS } from "./fixtures.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "http://127.0.0.1:4010");
const out = arg("out", "qa-out");
const only = arg("only", "")?.split(",").filter(Boolean);
const langs = (arg("langs", "ar,en,fr") ?? "").split(",");
const shots = !process.argv.includes("--no-shots");
const JS_BUDGET_KB = 150;

const PAGES = [
  { id: "home", path: "/" },
  { id: "places", path: "/places" },
  { id: "place", path: "/places/chf-baakline" },
  { id: "cuisines", path: "/cuisine" },
  { id: "cuisine", path: "/cuisine/shawarma" },
  { id: "vendor", path: "/m/abou-ali-shawarma" },
  { id: "send-home", path: "/send-home" },
  { id: "help", path: "/help" },
  { id: "contact", path: "/contact" },
  { id: "terms", path: "/legal/terms" },
  { id: "privacy", path: "/legal/privacy" },
  { id: "refund", path: "/legal/refund" },
  { id: "cookies", path: "/legal/cookies" },
  { id: "track-delivery", path: `/track/${TRACK_TOKENS.delivery}` },
  { id: "track-pickup", path: `/track/${TRACK_TOKENS.pickup}` },
  { id: "track-done", path: `/track/${TRACK_TOKENS.done}` },
  { id: "track-invalid", path: "/track/" + "Z".repeat(43) },
];
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const rows = [];
let bad = 0;

for (const lang of langs) {
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", locale: lang === "ar" ? "ar-LB" : lang === "fr" ? "fr-FR" : "en-GB" });
    for (const pg of PAGES) {
      if (only?.length && !only.some((o) => pg.id.startsWith(o))) continue;
      const page = await ctx.newPage();
      const errors = [];
      let jsBytes = 0;
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      page.on("response", async (r) => {
        if (/\.js(\?|$)/.test(r.url()) || (r.headers()["content-type"] ?? "").includes("javascript")) {
          try { jsBytes += gzipSync(await r.body()).length; } catch { /* redirects and aborted requests have no body */ }
        }
      });
      const res = await page.goto(`${base}/${lang}${pg.path === "/" ? "" : pg.path}`, { waitUntil: "networkidle" });
      const status = res?.status() ?? 0;
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      if (shots) await page.screenshot({ path: `${out}/${pg.id}-${lang}-${sizeName}.png`, fullPage: true });
      const kb = Math.round(jsBytes / 1024);
      const notes = [];
      if (status >= 400 && pg.id !== "track-invalid") notes.push(`HTTP ${status}`);
      if (overflow > 1) notes.push(`overflow +${overflow}px`);
      if (serious.length) notes.push(...serious.map((v) => `axe ${v.id} x${v.nodes.length}`));
      if (errors.length) notes.push(`console: ${errors[0]}`);
      if (kb > JS_BUDGET_KB) notes.push(`JS ${kb} KB > ${JS_BUDGET_KB}`);
      if (notes.length) bad++;
      rows.push({ lang, size: sizeName, page: pg.id, status, jsKb: kb, notes });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(rows, null, 2));
const maxJs = Math.max(0, ...rows.map((r) => r.jsKb));
console.log(`${rows.length} visits, max JS ${maxJs} KB gz, ${bad} with problems`);
for (const r of rows.filter((x) => x.notes.length)) console.log(`  ${r.lang}/${r.size}/${r.page}: ${r.notes.join("; ")}`);
process.exit(bad ? 1 : 0);
