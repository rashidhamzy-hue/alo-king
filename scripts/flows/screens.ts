// Screenshots of the Alo King Flow app (DECISIONS §39.15.13) from Flowso's phone preview: HOME, SEARCH, SHOPS, SHOP, ITEM
// and BASKET, walked as a customer would (shops near you, the first shop, its first item, its first choices, Add).
// Usage: PREVIEW_URL=http://127.0.0.1:4331/?view=preview OUT_DIR=screens LANG_TAG=en pnpm exec tsx scripts/flows/screens.ts
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const url = process.env.PREVIEW_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url))
  throw new Error("set PREVIEW_URL to the local flowso preview");
const out = process.env.OUT_DIR ?? "flow-screens";
const tag = process.env.LANG_TAG ?? "en";
mkdirSync(out, { recursive: true });

const sheet = (p: Page) => p.locator(".wa-phone__sheet");
async function shot(p: Page, name: string) {
  await p.waitForTimeout(900);
  // The whole screen, not only what the phone shows: the body is laid out at its full height first.
  await p.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>(
      ".preview__phone, .wa-phone, .wa-phone__sheet, .wa-phone__body, .wa-screen, .wa-screen__body",
    )) {
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
      el.style.position = el.classList.contains("wa-phone__sheet") ? "relative" : el.style.position;
    }
  });
  await sheet(p).screenshot({ path: `${out}/${name}.${tag}.png` });
  console.log(`${out}/${name}.${tag}.png`);
}
async function screen(p: Page, title?: string) {
  await p.waitForSelector(".wa-screen");
  if (title)
    await p.waitForFunction(
      (t) => document.querySelector(".wa-phone__title")?.textContent === t,
      title,
    );
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await browser.newPage({ viewport: { width: 430, height: 2400 }, deviceScaleFactor: 2 });
await p.goto(url);
await p.waitForSelector(".wa-nav-item", { timeout: 30_000 });
await shot(p, "1-home");

// Search
await p.locator(".wa-nav-item", { hasText: /🔍/ }).first().click();
await screen(p);
await shot(p, "2-search");
await p.locator(".wa-phone__header button").first().click();
await p.waitForSelector(".wa-nav-item");

// Shops near you, the first shop, its first item
await p.locator(".wa-nav-item", { hasText: /🏪/ }).first().click();
await p.waitForTimeout(1500);
await shot(p, "3-shops");
await p.locator(".wa-nav-item").first().click();
await p.waitForTimeout(1500);
await shot(p, "4-shop");
const lists = p.locator(".wa-nav-list");
const items = (await lists.count()) > 1 ? lists.nth(1) : lists.first();
// An item with a photo when there is one.
const withPhoto = items.locator(".wa-nav-item:has(img)");
await (
  (await withPhoto.count()) ? withPhoto.first() : items.locator(".wa-nav-item").first()
).click();
await p.waitForSelector(".wa-footer__button");
await p.waitForTimeout(800);
await shot(p, "5-item");

// Its first option in every single-choice group, then Add
for (const field of await p.locator(".wa-field:has(input[type=radio])").all())
  await field.locator("input[type=radio]").first().check();
await p.locator(".wa-footer__button").click();
await p.waitForFunction(
  () => !!document.querySelector(".wa-text--body") && !document.querySelector(".wa-image"),
  null,
  {
    timeout: 20_000,
  },
);
await shot(p, "6-basket");
await browser.close();
