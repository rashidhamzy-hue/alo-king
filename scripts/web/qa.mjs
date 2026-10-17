#!/usr/bin/env node
// Website quality pass (DECISIONS §37.5): screenshots of every public page in each language at mobile and desktop size,
// plus checks on the same visits: axe (no serious or critical issues), horizontal overflow, console errors, and the
// gzipped JavaScript each page loads (budget 150 KB).
//   node scripts/web/qa.mjs --base http://127.0.0.1:4010 --out qa-out [--only home,vendor] [--langs ar,en] [--no-shots]
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  CLAIM_VENDOR_ID,
  DEMO_SLUG,
  ITEM_IDS,
  TRACK_TOKENS,
  WEB_SLUG,
  WEB_TOKEN,
  WEB_TOKEN_EXPIRED,
} from "./fixtures.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://127.0.0.1:4010");
const out = arg("out", "qa-out");
const only = arg("only", "")?.split(",").filter(Boolean);
const langs = (arg("langs", "ar,en,fr") ?? "").split(",");
const shots = !process.argv.includes("--no-shots");
const JS_BUDGET_KB = 150;

const PAGES = [
  { id: "home", path: "/" },
  { id: "places", path: "/places" },
  // Session W (DECISIONS §39.11): the map with a village open from the address.
  { id: "map-village", path: "/places?v=chf-baakline" },
  { id: "place", path: "/places/chf-baakline" },
  { id: "cuisines", path: "/cuisine" },
  { id: "cuisine", path: "/cuisine/shawarma" },
  { id: "vendor", path: "/m/abou-ali-shawarma" },
  // DECISIONS §39.3: the noindex page of a shop that is not on Alo King yet.
  { id: "vendor-unclaimed", path: "/m/shawarma-el-midan" },
  // Session 5f (§39.15.7): a demo shop (labelled, noindex), item pages (the catalogue's links) and the photo credits.
  { id: "vendor-demo", path: `/m/${DEMO_SLUG}` },
  { id: "item", path: `/i/${ITEM_IDS.shawarma}` },
  { id: "item-demo", path: `/i/${ITEM_IDS.demo}` },
  // No photo and a very long name, at a shop without a page of its own (named, not linked; noindex).
  { id: "item-long", path: `/i/${ITEM_IDS.long}` },
  { id: "credits", path: "/credits" },
  // Session 5g: the web shop menu behind its signed link, an expired link.
  { id: "webmenu", path: `/m/${WEB_SLUG}?t=${WEB_TOKEN}` },
  { id: "webmenu-expired", path: `/m/${WEB_SLUG}?t=${WEB_TOKEN_EXPIRED}` },
  { id: "send-home", path: "/send-home" },
  { id: "help", path: "/help" },
  { id: "contact", path: "/contact" },
  { id: "terms", path: "/legal/terms" },
  { id: "privacy", path: "/legal/privacy" },
  { id: "refund", path: "/legal/refund" },
  { id: "cookies", path: "/legal/cookies" },
  { id: "merchant-terms", path: "/business/legal/merchant-terms" },
  { id: "mandate", path: "/business/legal/collection-mandate" },
  // Session 6b: merchants and drivers.
  // The business side (session W: its own section under /business).
  { id: "business", path: "/business" },
  { id: "business-help", path: "/business/help" },
  { id: "claim", path: "/business/claim" },
  { id: "claim-results", path: "/business/claim?q=abou" },
  { id: "claim-flow", path: `/business/claim?v=${CLAIM_VENDOR_ID}` },
  { id: "register", path: "/business/register" },
  { id: "drivers", path: "/business/drivers" },
  { id: "track-delivery", path: `/track/${TRACK_TOKENS.delivery}` },
  { id: "track-pickup", path: `/track/${TRACK_TOKENS.pickup}` },
  { id: "track-done", path: `/track/${TRACK_TOKENS.done}` },
  { id: "track-invalid", path: "/track/" + "Z".repeat(43) },
  // A real 404 (no language in the address): shown once per size, in all three languages at once.
  { id: "404", path: "/this-page-does-not-exist", bare: true, expect: 404 },
];
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

mkdirSync(out, { recursive: true });

// React has attached to the page once its elements carry its props: only then do the forms answer.
const hydrated = (page, selector) =>
  page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    },
    selector,
    { timeout: 15000 },
  );
// A tiny valid JPEG for the document uploads.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const rows = [];
let bad = 0;

for (const lang of langs) {
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
      locale: lang === "ar" ? "ar-LB" : lang === "fr" ? "fr-FR" : "en-GB",
    });
    for (const pg of PAGES) {
      if (only?.length && !only.some((o) => pg.id.startsWith(o))) continue;
      const page = await ctx.newPage();
      const errors = [];
      let jsBytes = 0;
      page.on(
        "console",
        (m) =>
          m.type() === "error" &&
          !(pg.expect === 404 && /404/.test(m.text())) &&
          errors.push(m.text().slice(0, 160)),
      );
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      page.on("response", async (r) => {
        if (
          /\.js(\?|$)/.test(r.url()) ||
          (r.headers()["content-type"] ?? "").includes("javascript")
        ) {
          try {
            jsBytes += gzipSync(await r.body()).length;
          } catch {
            /* redirects and aborted requests have no body */
          }
        }
      });
      // Map tiles (the registration's pin map) come from a third party: a blank tile keeps the run quiet and the same everywhere.
      await page.route(/tile\.openstreetmap\.org/, (r) =>
        r.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "base64",
          ),
        }),
      );
      if (pg.bare && lang !== langs[0]) {
        await page.close();
        continue;
      }
      const res = await page.goto(
        `${base}${pg.bare ? "" : `/${lang}`}${pg.path === "/" ? "" : pg.path}`,
        {
          waitUntil: "networkidle",
        },
      );
      const status = res?.status() ?? 0;
      if (pg.id.startsWith("track") && pg.id !== "track-invalid") {
        const cc = res?.headers()["cache-control"] ?? "";
        if (!cc.includes("no-store")) errors.push(`tracking page is cacheable: ${cc}`);
        if ((res?.headers()["referrer-policy"] ?? "") !== "no-referrer")
          errors.push("tracking page has no no-referrer policy");
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = axe.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      if (shots)
        await page.screenshot({ path: `${out}/${pg.id}-${lang}-${sizeName}.png`, fullPage: true });
      // Interactions: the pieces that need JavaScript work after the page has loaded.
      if (pg.id === "home") {
        await page.waitForTimeout(600);
        await page
          .click("button[aria-label]:has(svg.lucide-rotate-ccw)")
          .catch(() => errors.push("replay button missing"));
        // The calculator lives on the business side now (§39.11): the customer home has none.
        if (await page.locator('input[inputmode="numeric"]').count())
          errors.push("the customer home shows the merchant calculator");
        if (!(await page.locator('a[href$="/business"]').count()))
          errors.push("the For businesses link is missing on the home page");
        await page.click(".ak-faq summary").catch(() => errors.push("FAQ summary missing"));
        if (!(await page.locator(".ak-faq details[open]").count())) errors.push("FAQ did not open");
      }
      if (pg.id === "vendor") {
        await page.waitForTimeout(600);
        const first = page.locator("button[aria-label]:has(svg.lucide-plus)").first();
        await first.click().catch(() => errors.push("add button missing"));
        const href = await page.locator('[role="region"] a[data-wa="order"]').getAttribute("href");
        if (!href?.includes("wa.me") || !/1%C3%97|1×/.test(decodeURIComponent(href) ? href : ""))
          errors.push(`WhatsApp link did not carry the basket: ${href}`);
      }
      // A demo shop's pages (§39.12): labelled Demo, never indexed, no structured data.
      const demoChecks = async (what) => {
        const robots = await page.getAttribute('meta[name="robots"]', "content");
        if (!/noindex/.test(robots ?? "")) errors.push(`${what} is indexable: ${robots}`);
        const chips = await page
          .locator("main .ak-chip")
          .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
        if (!chips.some((c) => /^(Demo|Démo|تجريبي)$/.test(c)))
          errors.push(`${what} has no Demo chip: ${chips.join(" | ")}`);
        const ld = await page.locator('script[type="application/ld+json"]').count();
        if (ld) errors.push(`${what} carries ${ld} JSON-LD block(s)`);
      };
      if (pg.id.startsWith("item")) {
        // Add in WhatsApp carries the item's code verbatim; the bot adds the item from it (§39.15.2).
        const id = {
          item: ITEM_IDS.shawarma,
          "item-demo": ITEM_IDS.demo,
          "item-long": ITEM_IDS.long,
        }[pg.id];
        const hrefs = await page
          .locator('main a[data-wa="order"]')
          .evaluateAll((as) => as.map((a) => decodeURIComponent(a.getAttribute("href") ?? "")));
        if (!hrefs.some((h) => h.includes("wa.me") && h.includes(`i-${id}`)))
          errors.push(`Add in WhatsApp does not carry i-${id}: ${hrefs.join(" ")}`);
        // Only an item of a shop with a public page is indexed (a demo shop's, or one without a page, is not).
        const robots = await page.getAttribute('meta[name="robots"]', "content");
        if ((pg.id !== "item") !== /noindex/.test(robots ?? ""))
          errors.push(`robots on ${pg.id}: ${robots}`);
        if (pg.id === "item-demo") await demoChecks("the demo shop's item page");
        const img = await page.evaluate(() => {
          const el = document.querySelector("main figure img");
          return el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0;
        });
        if (pg.id === "item-long") {
          if (await page.locator("main figure img").count())
            errors.push("an item without a photo shows an image");
          // The shop has no page of its own: named, never linked (no 404 link).
          const shopLinks = await page.locator('main a[href*="/m/"]').count();
          if (shopLinks) errors.push(`a shop without a page is linked ${shopLinks} time(s)`);
        } else if (!img) errors.push("the item photo did not load");
        // The visible breadcrumbs and the BreadcrumbList are one trail (Home › village › shop › item).
        if (pg.id === "item") {
          const seen = await page
            .locator('nav[aria-label="Breadcrumb"] li')
            .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
          const ld = await page
            .locator('script[type="application/ld+json"]')
            .evaluateAll((els) => els.map((e) => JSON.parse(e.textContent ?? "{}")));
          const list = ld.find((o) => o["@type"] === "BreadcrumbList");
          const names = (list?.itemListElement ?? []).map((x) => x.name);
          if (seen.length !== 4 || JSON.stringify(seen) !== JSON.stringify(names))
            errors.push(`breadcrumbs ${seen.join(" > ")} differ from JSON-LD ${names.join(" > ")}`);
        }
      }
      if (pg.id === "vendor-demo") await demoChecks("the demo shop's page");
      // Session 6b: the forms are walked through, and each state is looked at like a page (screenshot, axe, console).
      const state = async (name) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        if (shots)
          await page.screenshot({
            path: `${out}/${pg.id}-${name}-${lang}-${sizeName}.png`,
            fullPage: true,
          });
        const a = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        for (const v of a.violations.filter(
          (x) => x.impact === "serious" || x.impact === "critical",
        ))
          serious.push({ id: `${v.id} (${name})`, nodes: v.nodes });
      };
      const stepFail = (what) => errors.push(`${what}`);
      if (pg.id === "places") {
        // The map: search in Arabizi, pick the village, see its panel with the shops (§39.11).
        await hydrated(page, ".zm-search input").catch(() => {});
        await page.fill(".zm-search input", "ba3e2lin").catch(() => stepFail("map search missing"));
        await page
          .waitForSelector('.zm-result[id$="chf-baakline"]', { timeout: 5000 })
          .catch(() => stepFail("Arabizi search did not find Baakline"));
        await page.press(".zm-search input", "Enter").catch(() => {});
        await page
          .waitForSelector(".zm-card", { timeout: 8000 })
          .catch(() => stepFail("village panel did not open"));
        // Live, Baakline has shops and the panel lists them; before launch it says the village opens soon.
        if (await page.locator(".zm-pt-shops").count())
          await page
            .waitForSelector(".zm-card .zm-shop", { timeout: 8000 })
            .catch(() => stepFail("village panel did not list its shops"));
        await state("village");
        await page.fill(".zm-search input", "Damour").catch(() => {});
        const msg = await page.textContent(".zm-noresult").catch(() => "");
        if (!msg?.trim()) stepFail("a place outside the zone gets no answer");
      }
      if (pg.id === "business" && sizeName === "desktop") {
        // Old merchant addresses answer 301 to the business side, keeping the claim link's query (§39.11).
        const r = await fetch(`${base}/${lang}/claim?v=${CLAIM_VENDOR_ID}`, { redirect: "manual" });
        const to = r.headers.get("location") ?? "";
        if (r.status !== 301 || !to.endsWith(`/${lang}/business/claim?v=${CLAIM_VENDOR_ID}`))
          stepFail(`old claim link: ${r.status} -> ${to}`);
      }
      if (pg.id === "business") {
        await hydrated(page, ".ak-faq").catch(() => {});
        await page
          .fill('input[inputmode="numeric"]', "1000")
          .catch(() => stepFail("calculator input missing"));
        const dd = await page.textContent('[aria-live="polite"]').catch(() => "");
        if (!/1,000|\$1,000/.test(dd ?? "")) stepFail("calculator did not update");
        await page.fill("#hero-q", "abou").catch(() => stepFail("search box missing"));
        await Promise.all([
          page.waitForURL(/\/business\/claim\?q=abou/, { timeout: 10000 }),
          page.press("#hero-q", "Enter"),
        ]).catch(() => stepFail("merchant search did not reach the claim page"));
      }
      if (pg.id === "claim-results") {
        await page.waitForSelector('a[href*="claim?v="]', { timeout: 10000 }).catch(() => {});
        const links = await page.locator('a[href*="claim?v="]').count();
        if (links !== 2) stepFail(`expected 2 results, found ${links}`);
      }
      if (pg.id === "claim-flow") {
        await hydrated(page, "form");
        await page.fill('input[autocomplete="name"]', "Samir");
        await page.fill('input[type="tel"]', "76 555 001");
        for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
        await page.click('button[type="submit"]');
        await page
          .waitForSelector('input[autocomplete="one-time-code"]', { timeout: 8000 })
          .catch(() => stepFail("no code step"));
        await state("code");
        await page.fill('input[autocomplete="one-time-code"]', "000000");
        await page.click('button[type="submit"]');
        await page
          .waitForSelector(".ak-alert-error", { timeout: 8000 })
          .catch(() => stepFail("wrong code was not reported"));
        await page.fill('input[autocomplete="one-time-code"]', "123456");
        await page.click('button[type="submit"]');
        await page
          .waitForSelector("h2.ak-h2", { timeout: 8000 })
          .catch(() => stepFail("claim did not finish"));
        await state("done");
      }
      if (pg.id === "register") {
        await hydrated(page, "form");
        await page.fill('input[dir="ltr"][maxlength="80"]', "Cedar Bakery");
        await page
          .selectOption('select:has(option[value="bakery_manakish"])', "bakery_manakish")
          .catch(() => stepFail("type list empty"));
        await page.fill('input[type="tel"]', "03 123 456");
        await page.locator('input[type="checkbox"]').last().check();
        await page.click('button[type="submit"]');
        await page
          .waitForSelector("fieldset input[inputmode='decimal']", { timeout: 8000 })
          .catch(() => stepFail("no location step"));
        await page.fill("fieldset input[inputmode='decimal'] >> nth=0", "33.6774");
        await page.fill("fieldset input[inputmode='decimal'] >> nth=1", "35.5635");
        await state("location");
        await page.click('button[type="submit"]');
        await page
          .waitForSelector('input[type="file"]', { state: "attached", timeout: 8000 })
          .catch(() => stepFail("no documents step"));
        await state("docs");
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: JPEG });
        await page
          .waitForSelector("text=/✓|Uploaded|تم الرفع|Envoyé/", { timeout: 8000 })
          .catch(() => stepFail("upload not confirmed"));
        await page
          .locator('input[type="file"]')
          .last()
          .setInputFiles({ name: "s.jpg", mimeType: "image/jpeg", buffer: JPEG });
        await page
          .waitForSelector("h2.ak-h2", { timeout: 8000 })
          .catch(() => stepFail("registration did not finish"));
        await state("done");
      }
      if (pg.id === "drivers") {
        await hydrated(page, "form");
        await page.fill('input[autocomplete="name"]', "Karim Haddad");
        await page.fill('input[type="tel"]', "71 555 123");
        await page.fill('input[maxlength="80"]:not([autocomplete])', "Baakline");
        await page.locator('input[name="vehicle"]').first().check({ force: true });
        await page
          .locator('input[type="checkbox"][aria-invalid]')
          .last()
          .check()
          .catch(() => {});
        await page.click('button[type="submit"]');
        await state("errors-or-done");
      }
      const kb = Math.round(jsBytes / 1024);
      const notes = [];
      if (status !== (pg.expect ?? 200) && pg.id !== "track-invalid") notes.push(`HTTP ${status}`);
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
for (const r of rows.filter((x) => x.notes.length))
  console.log(`  ${r.lang}/${r.size}/${r.page}: ${r.notes.join("; ")}`);
process.exit(bad ? 1 : 0);
