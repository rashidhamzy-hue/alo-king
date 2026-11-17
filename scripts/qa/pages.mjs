#!/usr/bin/env node
// QA1: every website page and every console page, as a phone opens it (390 px wide), in Arabic and in English.
// For each page it records: the HTTP status, any page or console error, sideways scroll (the page wider than the screen),
// and the first-visit weight (every byte the browser fetched for the page except pictures, uncompressed).
// Usage:
//   node scripts/qa/pages.mjs --web https://alo-king-web-staging.<account>.workers.dev \
//        --console https://alo-king-console-staging.<account>.workers.dev [--out docs/qa1-pages.md]
// The console part signs in only when QA_CONSOLE_EMAIL and QA_CONSOLE_PASSWORD are in the environment (never in a file or
// an argument); without them it checks the signed-out pages only. Read-only: GET requests and one sign-in, nothing posted.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
// Playwright is not a dependency of this repository: the machine that runs this has it (as the screenshot tests assume).
const { chromium } = createRequire(import.meta.url)("playwright");

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const WEB = arg("--web"); const CONSOLE = arg("--console"); const OUT = arg("--out");
const BUDGET = 102_400;                       // docs/WEBSITE.md: 100 KB on a first visit, fonts included, pictures not
const LANGS = ["ar", "en"];

// Website pages. Pages that need an id are found from the pages themselves (the first link of their kind).
const WEB_PAGES = ["/", "/search?q=labneh", "/cart", "/checkout", "/signin", "/orders", "/account", "/how", "/privacy", "/terms",
  "/food", "/join/rider", "/for-vendors", "/offline"];
// Console pages: every entry of the navigation (apps/console/src/nav.ts) and the signed-out ones.
const CONSOLE_PAGES = ["/", "/inbox", "/orders", "/pick", "/rider-jobs", "/stock", "/approve", "/capture", "/more", "/approvals",
  "/auto-approvals", "/cases", "/catalog", "/day-close", "/day-open", "/exceptions", "/food-facts", "/fx", "/intake", "/label-queue",
  "/listings", "/merchants", "/money", "/money/drops", "/names", "/payments", "/pictures", "/readiness", "/receiving", "/refunds",
  "/returns", "/rider-incidents", "/riders", "/riders?tab=applicants", "/search-words", "/settings", "/staff", "/templates", "/windows", "/zones", "/install"];

const isPicture = (u, type) => type === "image" || /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i.test(u);

async function check(context, base, path) {
  const page = await context.newPage();
  const errors = []; let bytes = 0;
  page.on("pageerror", (e) => errors.push(`page error: ${String(e.message).slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on("response", async (r) => {
    if (isPicture(r.url(), r.request().resourceType())) return;
    if (!r.url().startsWith(base)) return;     // the budget is this site's own bytes
    try { bytes += (await r.body()).length; } catch { /* redirects have no body */ }
  });
  let status = 0;
  try {
    const res = await page.goto(base + path, { waitUntil: "networkidle", timeout: 45_000 });
    status = res?.status() ?? 0;
  } catch (e) { errors.push(`load: ${String(e.message).slice(0, 160)}`); }
  const scroll = await page.evaluate(() => {
    const d = document.documentElement;
    return { sw: Math.max(d.scrollWidth, document.body?.scrollWidth ?? 0), cw: d.clientWidth };
  }).catch(() => ({ sw: 0, cw: 0 }));
  const finalPath = new URL(page.url()).pathname;
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
  await page.close();
  return { path, status, finalPath, errors, sideways: scroll.sw > scroll.cw + 1, sw: scroll.sw, bytes, links };
}

async function run(base, pages, opts) {
  const rows = [];
  const browser = await chromium.launch();
  const host = new URL(base).hostname;
  // A fresh context for every page: an empty cache, so each weight is a first visit's.
  const fresh = async (lang) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await context.addCookies([{ name: opts.langCookie, value: lang, domain: host, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
    if (opts.signIn) await context.addCookies(await opts.signIn(browser));
    return context;
  };
  for (const lang of LANGS) {
    const list = [...pages];
    if (opts.discover) { const c = await fresh(lang); list.push(...(await opts.discover(c))); await c.close(); }
    for (const p of list) { const c = await fresh(lang); rows.push({ lang, ...(await check(c, base, p)) }); await c.close(); }
  }
  await browser.close();
  return rows;
}

async function discoverWeb(context) {
  const found = [];
  const home = await check(context, WEB, "/");
  const cat = home.links.find((h) => /^\/c\/[a-z0-9_]+$/.test(h ?? "")); if (cat) found.push(cat);
  if (cat) { const c = await check(context, WEB, cat); const p = c.links.find((h) => /^\/p\/[A-Za-z0-9_-]+$/.test(h ?? "")); if (p) found.push(p); }
  const food = await check(context, WEB, "/food");
  const f = food.links.find((h) => /^\/food\/[^/?#]+$/.test(h ?? "")); if (f) found.push(f, f + "/remove");
  return found;
}

let consoleCookies = null;
/** Signs in once and returns the session cookies, which every fresh context then carries. */
async function signInConsole(browser) {
  if (consoleCookies) return consoleCookies;
  const email = process.env.QA_CONSOLE_EMAIL; const password = process.env.QA_CONSOLE_PASSWORD;
  if (!email || !password) return (consoleCookies = []);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(CONSOLE + "/sign-in");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForNavigation(), page.click('form[action="/sign-in"] button')]);
  if (new URL(page.url()).pathname === "/sign-in") throw new Error("console sign-in refused");
  consoleCookies = (await context.cookies()).filter((c) => c.name !== "ak_lang");
  await context.close();
  return consoleCookies;
}

const all = [];
if (WEB) for (const r of await run(WEB, WEB_PAGES, { langCookie: "lang", discover: discoverWeb })) all.push({ site: "web", ...r });
if (CONSOLE) for (const r of await run(CONSOLE, CONSOLE_PAGES, { langCookie: "ak_lang", signIn: signInConsole })) all.push({ site: "console", ...r });

const verdict = (r) => {
  const bad = [];
  if (r.status >= 400 || r.status === 0) bad.push(`HTTP ${r.status}`);
  if (r.errors.length) bad.push(r.errors.join("; "));
  if (r.sideways) bad.push(`sideways scroll (${r.sw} px)`);
  if (r.site === "web" && r.bytes > BUDGET) bad.push(`weight ${r.bytes} > ${BUDGET}`);
  if (r.site === "console" && r.finalPath === "/sign-in" && r.path !== "/sign-in") bad.push("signed out (redirected to sign-in)");
  return bad;
};
const lines = ["| Site | Page | Lang | HTTP | Weight (bytes, no pictures) | Result |", "| --- | --- | --- | --- | --- | --- |"];
let fails = 0;
for (const r of all) {
  const bad = verdict(r); if (bad.length) fails++;
  lines.push(`| ${r.site} | \`${r.path}\` | ${r.lang} | ${r.status} | ${r.bytes} | ${bad.length ? "FAIL: " + bad.join("; ").replace(/\|/g, "/") : "pass"} |`);
}
lines.push("", `${all.length} page loads, ${fails} failing.`);
const text = lines.join("\n") + "\n";
if (OUT) writeFileSync(OUT, text); else process.stdout.write(text);
process.exitCode = fails ? 1 : 0;
