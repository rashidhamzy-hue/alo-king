#!/usr/bin/env node
// Quality pass for the staff pages (merchant dashboard, admin console, driver app; DECISIONS §37.4, §37.5): screenshots in
// each language at mobile and desktop size, axe (no serious or critical issues), horizontal overflow and console errors.
// A signed-in person is simulated with a planted session (the mock Supabase tells the personas apart by the token's `sub`),
// and every row comes from scripts/web/fixtures.mjs. Not a test of the data layer: the pages are being looked at.
//   node scripts/web/qa-private.mjs --base http://127.0.0.1:4010 --out qa-out-private [--only merchant-home,admin]
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PERSONAS } from "./fixtures.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://127.0.0.1:4010");
const out = arg("out", "qa-out-private");
const only = arg("only", "")?.split(",").filter(Boolean);
const langs = (arg("langs", "ar,en,fr") ?? "").split(",");
const MOCK_HOST = arg("mock-host", "127");

const PAGES = [
  { id: "merchant-signin", path: "/merchant" },
  { id: "admin-signin", path: "/admin" },
  { id: "merchant-home", path: "/merchant", as: "merchant", panel: true },
  { id: "merchant-orders", path: "/merchant/orders", as: "merchant" },
  { id: "merchant-menu", path: "/merchant/menu", as: "merchant" },
  { id: "merchant-profile", path: "/merchant/profile", as: "merchant" },
  { id: "merchant-onboarding", path: "/merchant/onboarding", as: "merchant" },
  { id: "merchant-assistant", path: "/merchant/assistant", as: "merchant" },
  { id: "admin-claims", path: "/admin", as: "admin" },
  { id: "admin-drivers", path: "/admin", as: "admin", click: "drivers" },
  { id: "no-access", path: "/admin", as: "merchant" },
  { id: "driver", path: "/driver", as: "admin" },
];
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const session = (who) => {
  const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
  const p = PERSONAS[who];
  return {
    access_token: `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: p.sub, role: "authenticated", exp })}.x`,
    refresh_token: "x",
    token_type: "bearer",
    expires_in: 365 * 86400,
    expires_at: exp,
    user: {
      id: p.sub,
      aud: "authenticated",
      role: "authenticated",
      email: p.email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const rows = [];
let bad = 0;

for (const lang of langs) {
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const pg of PAGES) {
      if (only?.length && !only.some((o) => pg.id.startsWith(o))) continue;
      const ctx = await browser.newContext({
        viewport,
        reducedMotion: "reduce",
        locale: lang === "ar" ? "ar-LB" : lang === "fr" ? "fr-FR" : "en-GB",
      });
      await ctx.addInitScript(
        ([l, key, sess]) => {
          localStorage.setItem("ak_lang", l);
          if (sess) localStorage.setItem(key, JSON.stringify(sess));
        },
        [lang, `sb-${MOCK_HOST}-auth-token`, pg.as ? session(pg.as) : null],
      );
      const page = await ctx.newPage();
      // The kitchen page listens for live changes over a websocket the mock does not serve: let it connect and stay quiet.
      await page.routeWebSocket(/realtime/, () => {});
      // Map tiles come from a third party: a blank tile keeps the run quiet and the same everywhere.
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
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      await page.goto(`${base}${pg.path}`, { waitUntil: "networkidle" });
      // Staff pages render after the session and the first queries: wait for the page itself, not for a fixed time.
      await page
        .waitForSelector("h1, h2, form, article", { timeout: 15000 })
        .catch(() => errors.push("page did not render"));
      await page.waitForTimeout(700);
      if (pg.click === "drivers") {
        await page.locator("header nav button").nth(1).click();
        await page
          .waitForSelector("article", { timeout: 8000 })
          .catch(() => errors.push("driver applications missing"));
      }
      const snap = async (name) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${out}/${name}-${lang}-${sizeName}.png`, fullPage: true });
      };
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      const checkAxe = async (label) => {
        const a = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        return a.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `axe ${v.id} x${v.nodes.length}${label}`);
      };
      const notes = [];
      await snap(pg.id);
      notes.push(...(await checkAxe("")));
      if (pg.panel && sizeName === "mobile") {
        await page
          .getByRole("button", { name: /Setup assistant|مساعد الإعداد|Assistant de configuration/ })
          .first()
          .click();
        await page
          .waitForSelector('[role="dialog"]', { timeout: 5000 })
          .catch(() => errors.push("panel did not open"));
        await page.waitForTimeout(500);
        await snap(`${pg.id}-panel`);
        notes.push(...(await checkAxe(" (panel)")));
      }
      if (overflow > 1) notes.push(`overflow +${overflow}px`);
      if (errors.length) notes.push(`console: ${errors[0]}`);
      if (notes.length) bad++;
      rows.push({ lang, size: sizeName, page: pg.id, notes });
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(rows, null, 2));
console.log(`${rows.length} visits, ${bad} with problems`);
for (const r of rows.filter((x) => x.notes.length))
  console.log(`  ${r.lang}/${r.size}/${r.page}: ${r.notes.join("; ")}`);
process.exit(bad ? 1 : 0);
