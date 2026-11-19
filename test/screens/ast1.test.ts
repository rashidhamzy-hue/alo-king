// AST1, the console assistant, in a real browser (Playwright's Chromium; skipped unless SCREENS names a folder: CI installs no browser;
// apps/console/test/ast1.test.ts checks the same through handle() on every pull request). Dispatch the `screens` workflow (action shoot, this
// test file, session ast1) on the branch: it runs here and uploads the images to the private screens bucket.
//   1. the panel beside Today at 1440 px: a starter question is tapped and the answer appears in the panel (the page script's background post);
//   2. the /assistant page on a phone (390 px) and a laptop (1440 px) after a question, light and dark, Arabic and English;
//   3. no sideways scroll on a phone and every control at least 44 px; a picker sees no assistant.
//   SCREENS=/tmp/shots npx vitest run test/screens/ast1.test.ts
// The invented day of evals/assistant/world.ts, and a scripted model (nothing is sent anywhere, no model is called).
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { rig } from "../../apps/console/test/kit";
import { NOW, seedWorld } from "../../evals/assistant/world";
import { scriptedModel, switchOn } from "../../evals/assistant/eval";
import type { ModelFn } from "../../apps/console/src/assistant/run";

const OUT = process.env.SCREENS;
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-tabs, .ak-board, .chips"); }).slice(0, 6).map((e) => e.tagName + "." + e.className)`;
const SMALL = `[...document.querySelectorAll("main button, main textarea, .ak-chip, .ak-assistant button, .ak-assistant-btn")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).slice(0, 5).map((e) => e.outerHTML.slice(0, 80))`;
const view = (width: number) => ({ width, height: width === 390 ? 844 : 900 });
const EN = "One order is late right now: **AK-2006** to Ain Sample, 30 minutes past its promise (14:30), on the road.\n- AK-2002 was 22 minutes late: picking took 35 minutes.\n- Test Grill answers the call ahead in 22 minutes on average.\n[Orders](/orders) · [Food calls](/food)";
const AR = "طلب واحد متأخر الآن: **AK-2006** إلى Ain Sample، تجاوز موعده (14:30) بـ 30 دقيقة، وهو في الطريق.\n- تأخر AK-2002 بـ 22 دقيقة: استغرق التجهيز 35 دقيقة.\n- يردّ Test Grill على الاتصال المسبق في 22 دقيقة في المتوسط.\n[الطلبات](/orders) · [مكالمات الطعام](/food)";
/** The scripted model reads the orders, then answers in the question's language. */
const model: ModelFn = async (p) => {
  const q = JSON.stringify(p.messages[p.messages.length - 1]);
  const ar = /[؀-ۿ]/.test(JSON.stringify(p.messages));
  return scriptedModel({ tools: [{ name: "orders", input: {} }, { name: "food_places", input: {} }], answer: ar ? AR : EN })({ ...p, messages: p.messages }).then((r) => (q ? r : r));
};

describe.skipIf(!OUT)("AST1 in Chromium: the assistant's panel and page", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("answers in the panel and on its page, phone and laptop, light and dark, Arabic and English", async () => {
    const r = await rig();
    await seedWorld(r.db); await switchOn(r.db);
    r.deps.now = () => NOW;
    r.deps.assistantModel = model;
    const people: Record<string, { email: string; password: string }> = { picker: await r.staff("picker", "Example picker") };
    let n = 0;
    const freshAdmin = async () => { const k = `admin${n++}`; people[k] = await r.staff("admin", "Example admin"); return k; };   // a fresh conversation per screen
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const ch of req) chunks.push(ch as Buffer);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const out = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), r.deps, registry);
      const h: Record<string, string | string[]> = {}; out.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
      const cookies = out.headers.getSetCookie().map((ck) => ck.replace(/;\s*Secure/gi, "")); if (cookies.length) h["set-cookie"] = cookies;
      res.writeHead(out.status, h); res.end(Buffer.from(await out.arrayBuffer()));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    close = () => server.close();
    const base = `http://localhost:${port}`;
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    const signIn = async (who: string, ctxOpts: object = {}) => {
      const ctx = await browser.newContext({ locale: "en-GB", timezoneId: "Asia/Beirut", ...ctxOpts });
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", people[who]!.email); await page.fill("input[name=password]", people[who]!.password);
      await Promise.all([page.waitForLoadState("load"), page.click("button")]);
      return { ctx, page };
    };
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    // a picker sees no assistant
    {
      const { ctx, page } = await signIn("picker", { viewport: view(1440) });
      expect(await page.locator(".ak-assistant, .ak-assistant-btn").count()).toBe(0);
      await ctx.close();
    }
    for (const scheme of ["light", "dark"] as const) for (const lang of ["en", "ar"]) {
      // 1. the panel beside Today at 1440 px: tap the first starter question; the answer appears in the panel
      {
        const { ctx, page } = await signIn(await freshAdmin(), { viewport: view(1440), colorScheme: scheme });
        await page.goto(`${base}/lang?to=${lang}&next=/`);
        expect(await page.locator("aside.ak-assistant").isVisible()).toBe(true);
        await page.locator("aside.ak-assistant .ak-chip").first().click();
        await page.locator("aside.ak-assistant .ak-turn .ak-answer").first().waitFor({ timeout: 15_000 });
        expect(await page.locator("aside.ak-assistant .ak-answer").first().textContent()).toContain("AK-2006");
        expect(new URL(page.url()).pathname).toBe("/");                                  // the page stayed; the answer came into the panel
        await page.evaluate("document.fonts.ready");
        await page.screenshot({ path: join(OUT!, `ast1-panel-1440-${scheme}-${lang}.png`) });
        shots++;
        await ctx.close();
      }
      // 2. the page, on a phone and a laptop
      for (const width of [390, 1440]) {
        const { ctx, page } = await signIn(await freshAdmin(), { viewport: view(width), deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: scheme });
        await page.goto(`${base}/lang?to=${lang}&next=/assistant`);
        if (width === 390) expect(await page.locator(".ak-assistant-btn").count()).toBe(0);   // not on its own page
        await page.locator("main .ak-chip").nth(2).click();
        await page.locator("main .ak-turn").last().waitFor({ timeout: 15_000 });
        await page.evaluate("document.fonts.ready");
        if (width === 390) {
          expect(await page.evaluate(WIDE), `/assistant (${lang}, ${scheme}) at 390 px scrolls sideways`).toEqual([]);
          expect(await page.evaluate(SMALL), `/assistant (${lang}) has a control under 44 px`).toEqual([]);
        }
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.min(Math.max(h, view(width).height), 3200) });
        await page.screenshot({ path: join(OUT!, `ast1-page-${width}-${scheme}-${lang}.png`) });
        shots++;
        await ctx.close();
      }
    }
    await browser.close();
    expect(shots).toBe(12);
  }, 1_500_000);
});
