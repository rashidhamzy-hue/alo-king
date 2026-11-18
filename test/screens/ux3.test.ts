// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow
// (action shoot, this test file, the session's name) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// UX3: screenshots of the two join pages and of the Riders page's Applicants tab at 390 px, in Arabic and English (the screens bucket, ux3/), and the weight of each
// website page on a first visit (page, stylesheet, script and font files, uncompressed, nothing cached), which must be under 100 KB. Skipped unless SCREENS names a
// folder, because it needs a browser (Playwright's Chromium) that CI does not install:
//   SCREENS=/tmp/shots/ux3 npx vitest run test/screens/ux3.test.ts
// The website runs built, in the Worker runtime, over the real migrations; the console runs its real pages (as test/screens/ux2b.test.ts). Invented people only.
// The number confirmation is run as it runs for real: the page issues a code, and the customer-line function (claim_link_code) reads it as the turn would.
import { afterAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openTestDb } from "../db/harness";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest } from "../web/postgrest-fake";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
const root = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && !e.closest(".ak-table-wrap, .ak-tabs"); }).slice(0, 5).map((e) => e.tagName + "." + e.className)`;
const SMALL = `[...document.querySelectorAll("main a.ak-btn, main button, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main select, main .checks label")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).slice(0, 5).map((e) => e.tagName + " " + (e.textContent || "").trim().slice(0, 30))`;

describe.skipIf(!OUT)("UX3 screenshots: the join pages and the Applicants tab", () => {
  const closers: (() => unknown)[] = [];
  afterAll(async () => { for (const c of closers.reverse()) await c(); if (existsSync(root + ".dev.vars")) rmSync(root + ".dev.vars"); });

  it("photographs /join/rider and /for-vendors at 390 px, weighs each on a first visit, and checks nothing scrolls sideways and every control is 44 px", async () => {
    const db = await openTestDb();
    await db.pg.exec(`update settings set value = '{"open":"09:00","close":"21:00","tz":"Asia/Beirut"}' where key = 'hours';
                      update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    const fake = await startFakePostgrest(db); closers.push(() => fake.close());
    await build({ root, logLevel: "error" });
    const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, PAGE_CACHE: "off", ENVIRONMENT: "staging" }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    writeFileSync(root + ".dev.vars", body); writeFileSync(root + "dist/server/.dev.vars", body);
    const port = await freePort();
    const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
    closers.push(() => server.stop());
    const base = `http://127.0.0.1:${port}`;
    const place = await db.one(`select listing_id from listings where kind = 'bakery' and hidden_at is null and village is not null order by km_from_hub limit 1`);

    const cookieOf = (r: Response) => /(?:^|,\s*)(ak_session=[0-9a-f]{64})/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
    let seq = 0;
    /** A visitor in one state: "start" (nothing), "code" (a code is showing), "confirmed" (the number is confirmed), "applied" (an application is open). */
    async function visitor(path: string, purpose: "rider" | "vendor", state: "start" | "code" | "confirmed" | "applied") {
      if (state === "start") return null;
      const first = await fetch(base + path.split("?")[0]!, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: new URLSearchParams({ step: "code" }) });
      const cookie = cookieOf(first)!;
      if (state === "code") return cookie;
      const html = await (await fetch(base + path, { headers: { cookie } })).text();
      const code = /ALO-[23456789A-HJ-NP-Z]{6}/.exec(html)![0];
      seq++;
      const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`UX3 shot ${seq}`])).id;
      await db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-ux3s-${seq}', '+96170000${String(500 + seq)}')`);
      await db.pg.exec(`insert into conversations(line, party_id, last_inbound_at) values ('customer', '${party}', now())`);
      await db.rpc("claim_link_code", { p_party: party, p_code: code, p_wamid: `wamid-ux3s-${seq}` });
      if (state === "applied") {
        const token = /ak_session=([0-9a-f]{64})/.exec(cookie)![1]!;
        if (purpose === "rider") await db.rpc("web_apply_rider", { p_token: token, p_name: "Example rider", p_village: "Baakline", p_vehicle: "motorbike", p_licence: true, p_days: ["mon", "sat"], p_shifts: ["morning"] });
        else await db.rpc("web_apply_vendor", { p_token: token, p_name: "Example Oven", p_kind: "bakery", p_village: "Baakline", p_listing: null });
      }
      return cookie;
    }
    const plan: [string, string, "rider" | "vendor", "start" | "code" | "confirmed" | "applied"][] = [
      ["rider", "/join/rider", "rider", "start"], ["rider-code", "/join/rider", "rider", "code"], ["rider-form", "/join/rider", "rider", "confirmed"], ["rider-applied", "/join/rider?applied=1", "rider", "applied"],
      ["vendor", "/for-vendors", "vendor", "start"], ["vendor-place", `/for-vendors?place=${encodeURIComponent(place.listing_id)}`, "vendor", "confirmed"], ["vendor-applied", "/for-vendors?applied=1", "vendor", "applied"],
    ];
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    mkdirSync(OUT!, { recursive: true });
    const weights: string[] = [];
    for (const lang of ["en", "ar"]) for (const [name, path, purpose, state] of plan) {
      const cookie = await visitor(path, purpose, state);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", locale: lang === "ar" ? "ar-LB" : "en-GB", timezoneId: "Asia/Beirut" });
      await ctx.addCookies([{ name: "lang", value: lang, url: base }, ...(cookie ? [{ name: "ak_session", value: cookie.split("=")[1]!, url: base }] : [])]);
      const page = await ctx.newPage();
      const sizes: Promise<number>[] = [];
      page.on("response", (res: any) => { const u = new URL(res.url()); if (u.origin === base && !/\.(png|svg|webmanifest)$/.test(u.pathname)) sizes.push(res.body().then((b: Buffer) => b.length, () => 0)); });
      const res = await page.goto(base + path, { waitUntil: "networkidle" });
      expect(res?.status(), path).toBe(200);
      await page.evaluate("document.fonts.ready");
      const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
      expect(await page.evaluate(WIDE), `${path} (${lang}) at 390 px scrolls sideways`).toEqual([]);
      expect(await page.evaluate(SMALL), `${path} (${lang}) has a control under 44 px`).toEqual([]);
      expect(bytes, `${path} (${lang}) weighs ${bytes} bytes with its fonts`).toBeLessThan(100 * 1024);
      weights.push(`${name} ${lang}: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
      const h = await page.evaluate("document.documentElement.scrollHeight") as number;
      await page.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 4200) });
      await page.screenshot({ path: join(OUT!, `ux3-${name}-390-${lang}.png`) });
      await ctx.close();
    }
    await browser.close();
    writeFileSync(join(OUT!, "web-weights.txt"), weights.join("\n") + "\n");
  }, 900_000);

  it("photographs the Riders page's Applicants tab at 390 px, with an applicant waiting, one accepted and one declined", async () => {
    const r = await rig(); const db = r.db;
    const lead = await r.staff("ops_lead", "Example lead");
    let seq = 0;
    async function applicant(name: string, village: string, licence: boolean, days: string[], shifts: string[]) {
      seq++;
      const s = await db.rpc<{ token: string }>("web_session_start", { p_device: "shot" });
      const code = await db.rpc<any>("web_join_code", { p_token: s.token, p_purpose: "rider" });
      const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`UX3 shot applicant ${seq}`])).id;
      await db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-ux3a-${seq}', '+96170000${String(600 + seq)}')`);
      await db.pg.exec(`insert into conversations(line, party_id, last_inbound_at) values ('customer', '${party}', now())`);
      await db.rpc("claim_link_code", { p_party: party, p_code: code.code, p_wamid: `wamid-ux3a-${seq}` });
      return (await db.rpc<any>("web_apply_rider", { p_token: s.token, p_name: name, p_village: village, p_vehicle: seq % 2 ? "motorbike" : "car", p_licence: licence, p_days: days, p_shifts: shifts })).id as string;
    }
    await applicant("Example applicant one", "Baakline", true, ["mon", "tue", "sat"], ["morning"]);
    await applicant("Example applicant two", "Somewhere else", false, ["fri", "sat", "sun"], ["morning", "evening"]);
    const acc = await applicant("Example applicant three", "Baqaata", true, ["wed"], ["evening"]);
    const dec = await applicant("Example applicant four", "Baakline", false, ["thu"], ["morning"]);
    await db.rpc("accept_rider_application", { p_application: acc, p_by: lead.partyId });
    await db.rpc("decline_rider_application", { p_application: dec, p_by: lead.partyId, p_reason: "No vehicle for the roads we cover" });

    const server = httpServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const ch of req) chunks.push(ch as Buffer);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const out = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), r.deps, registry);
      const h: Record<string, string | string[]> = {}; out.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
      const cookies = out.headers.getSetCookie().map((ck) => ck.replace(/;\s*Secure/gi, "")); if (cookies.length) h["set-cookie"] = cookies;
      res.writeHead(out.status, h); res.end(Buffer.from(await out.arrayBuffer()));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port; closers.push(() => server.close());
    const base = `http://localhost:${port}`;
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    mkdirSync(OUT!, { recursive: true });
    for (const lang of ["en", "ar"]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", locale: "en-GB", timezoneId: "Asia/Beirut" });
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", lead.email); await page.fill("input[name=password]", lead.password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [name, path] of [["applicants", "/riders?tab=applicants"], ["roster", "/riders"]] as const) {
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        await page.evaluate("document.fonts.ready");
        expect(await page.evaluate(WIDE), `${path} (${lang}) at 390 px scrolls sideways`).toEqual([]);
        expect(await page.evaluate(SMALL), `${path} (${lang}) has a control under 44 px`).toEqual([]);
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 4200) });
        await page.screenshot({ path: join(OUT!, `ux3-riders-${name}-390-${lang}.png`) });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await ctx.close();
    }
    await browser.close();
  }, 600_000);
});
