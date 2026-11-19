// Session MENU2: a menu web page fetched by the menu-read workflow (scripts/menus/crawl.mjs). docs/DECISIONS.md, "MENU2, 19 November 2026".
//   1 robots.txt   read once and obeyed for every page; unreadable means nothing is fetched
//   2 sections     same site, under the start page's path; never a sign-in, an account, a cart or another site
//   3 the loop     the start page once, its tabs pressed (Drinks), each section page opened once, at most 40 pages, a sign-in page not read
//   4 the record   each page's text without the site's repeated header, a screenshot; a page with no figure kept but not read
//   5 a browser    the saved JavaScript menu page (test/fixtures/menus/js-site/, invented) served on 127.0.0.1 and fetched by Chromium, when
//                  Chromium can start here. The menu-read workflow installs it and sets MENU_BROWSER_REQUIRED=1, so there it must run.
// No live site is fetched. USD 0.
import { describe, expect, it } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs
import { robotsRules, robotsAllows, sectionLinks, chromeLines, crawlMenu, playwrightDriver, tabLike, signInPage, MAX_PAGES } from "../../scripts/menus/crawl.mjs";

const START = "https://menus.example/ar/p/example-grill";
describe("1 robots.txt", () => {
  const txt = "User-agent: *\nAllow: /\nDisallow: /terms\nDisallow: /ar/p/example-grill/private\n\nUser-agent: OtherBot\nDisallow: /\n";
  it("the group for everyone applies; the longest rule wins; Allow wins a tie; an empty Disallow allows all", () => {
    const r = robotsRules(txt);
    expect(robotsAllows(r, START)).toBe(true);
    expect(robotsAllows(r, "https://menus.example/terms")).toBe(false);
    expect(robotsAllows(r, `${START}/private`)).toBe(false);
    expect(robotsAllows(r, `${START}/s1`)).toBe(true);
    expect(robotsAllows(robotsRules("User-agent: *\nDisallow: /ar/\nAllow: /ar/p/\n"), `${START}/s1`)).toBe(true);
    expect(robotsAllows(robotsRules("User-agent: *\nDisallow:\n"), START)).toBe(true);
    expect(robotsAllows(robotsRules("User-agent: *\nDisallow: /*.php$\n"), "https://menus.example/a.php")).toBe(false);
    expect(robotsAllows(robotsRules("User-agent: AloKingMenuReader\nDisallow: /\n\nUser-agent: *\nAllow: /\n"), START)).toBe(false);
    expect(robotsAllows(robotsRules(""), START)).toBe(true);
  });
});

describe("2 which links are sections", () => {
  it("same host, under the start page, no repeat, nothing to avoid", () => {
    const links = sectionLinks(START, [
      { href: `${START}/s1`, text: "SANDWICHES / سندويشات" }, { href: `${START}/s1#top`, text: "again" }, { href: "/ar/p/example-grill/s2", text: "GRILLS" },
      { href: "https://www.menus.example/ar/p/example-grill/s3", text: "DRINKS" }, { href: START, text: "home" }, { href: "https://menus.example/ar/", text: "site" },
      { href: "https://social.example/example-grill", text: "Instagram" }, { href: `${START}/login`, text: "Sign in" }, { href: `${START}/cart`, text: "Basket" },
      { href: `${START}/s4`, text: "تسجيل الدخول" }, { href: `${START}/menu.pdf`, text: "PDF" }, { href: "mailto:x@menus.example", text: "mail" }]);
    expect(links.map((l: any) => l.url)).toEqual([`${START}/s1`, `${START}/s2`, "https://www.menus.example/ar/p/example-grill/s3"]);
    expect(links[0].title).toBe("SANDWICHES / سندويشات");
    expect(tabLike("Drinks")).toBe(true); expect(tabLike("")).toBe(false); expect(tabLike("Log in")).toBe(false); expect(tabLike("Order now")).toBe(false);
    expect(signInPage("https://menus.example/login?next=/x")).toBe(true); expect(signInPage(`${START}/s1`)).toBe(false);
  });
  it("the site's header is dropped from section pages, never a price, a currency mark or a dish", () => {
    const start = "Example Grill\nExample village\nFood\nDrinks\nSANDWICHES\nmenus.example";
    const pages = ["Example Grill\nExample village\nFood\nDrinks\nSANDWICHES\nTaouk\n3\n$\nmenus.example", "Example Grill\nExample village\nFood\nDrinks\nGRILLS\nKafta\n7\n$\nmenus.example",
      "Example Grill\nExample village\nFood\nDrinks\nDIPS\nGarlic\n1\n$\nmenus.example"];
    expect([...chromeLines(start, pages)].sort()).toEqual(["Drinks", "Example Grill", "Example village", "Food", "menus.example"].sort());
  });
});

/** A fake site: pages by address, tabs that show more links, and a record of every page opened. */
function fakeSite(o: { pages: Record<string, { text: string; anchors?: { href: string; text: string }[]; tabs?: { key: string; text: string }[]; url?: string }>; tabs?: Record<string, { anchors: { href: string; text: string }[]; text?: string; url?: string }> }) {
  const opened: string[] = []; let current = "";
  const driver = {
    open: async (url: string) => { opened.push(url); current = url; const p = o.pages[url]; if (!p) throw new Error("404"); return { url: p.url ?? url, text: p.text, anchors: p.anchors ?? [], tabs: p.tabs ?? [] }; },
    clickTab: async (key: string) => { const t = o.tabs?.[key]; if (!t) throw new Error("no tab"); return { url: t.url ?? current, text: t.text ?? o.pages[current]!.text, anchors: t.anchors }; },
    screenshot: async () => new Uint8Array([1, 2, 3]), close: async () => {},
  };
  return { driver, opened };
}
const HEADER = "Example Grill\nExample village\nFood\nDrinks";

describe("3 the loop", () => {
  it("the start page once, its tabs pressed, each section page once, robots obeyed, a sign-in page not read", async () => {
    const site = fakeSite({
      pages: {
        [START]: { text: `${HEADER}\nSANDWICHES\nGRILLS\nOFFERS`, anchors: [{ href: `${START}/s1`, text: "SANDWICHES" }, { href: `${START}/s2`, text: "GRILLS" }, { href: `${START}/s0`, text: "OFFERS" },
          { href: `${START}/private`, text: "STAFF" }, { href: `${START}/s9`, text: "Members" }], tabs: [{ key: "0", text: "Food" }, { key: "1", text: "Drinks" }, { key: "2", text: "" }, { key: "3", text: "Log in" }] },
        [`${START}/s1`]: { text: `${HEADER}\nSANDWICHES\nTaouk sandwich\n3\n$` }, [`${START}/s2`]: { text: `${HEADER}\nGRILLS\nKafta\n7.5\n$` },
        [`${START}/s0`]: { text: `${HEADER}\nOFFERS` }, [`${START}/s3`]: { text: `${HEADER}\nCOLD BEVERAGES\nCola\n1.5\n$` },
        [`${START}/s9`]: { text: "Sign in to continue", url: "https://menus.example/login?next=s9" } },
      tabs: { "0": { anchors: [{ href: `${START}/s1`, text: "SANDWICHES" }] }, "1": { anchors: [{ href: `${START}/s3`, text: "COLD BEVERAGES" }] } },
    });
    const out = await crawlMenu({ startUrl: START, driver: site.driver, robotsTxt: "User-agent: *\nDisallow: /ar/p/example-grill/private\n", sleep: async () => {} });
    expect(site.opened).toEqual([START, `${START}/s1`, `${START}/s2`, `${START}/s0`, `${START}/s9`, `${START}/s3`]);
    expect(new Set(site.opened).size).toBe(site.opened.length);                                     // one fetch per page
    expect(out.refused).toEqual([{ url: `${START}/private`, reason: "robots" }, { url: `${START}/s9`, reason: "sign_in" }]);
    expect(out.pages.map((p: any) => [p.title, p.skip_reason === null])).toEqual([["Start page", false], ["SANDWICHES", true], ["GRILLS", true], ["OFFERS", false], ["COLD BEVERAGES", true]]);
    expect(out.pages[1].body).toBe("# SANDWICHES\nTaouk sandwich\n3\n$");
    expect(out.pages[3].skip_reason).toBe("the page shows no item or price");
    expect(out.pages.every((p: any) => p.shot.byteLength > 0)).toBe(true);
  });

  it("stops before it starts when robots.txt cannot be read or disallows the page, or the page asks for a sign-in; at most 40 pages", async () => {
    const one = fakeSite({ pages: { [START]: { text: "x" } } });
    await expect(crawlMenu({ startUrl: START, driver: one.driver, robotsTxt: null })).rejects.toThrow(/robots_unreadable/);
    await expect(crawlMenu({ startUrl: START, driver: one.driver, robotsTxt: "User-agent: *\nDisallow: /ar/\n" })).rejects.toThrow(/robots_disallow/);
    expect(one.opened).toEqual([]);
    const login = fakeSite({ pages: { [START]: { text: "Sign in", url: "https://menus.example/login" } } });
    await expect(crawlMenu({ startUrl: START, driver: login.driver, robotsTxt: "" })).rejects.toThrow(/sign_in/);
    const many: Record<string, { text: string; anchors?: any[] }> = { [START]: { text: "list", anchors: Array.from({ length: 60 }, (_, i) => ({ href: `${START}/s${i}`, text: `S${i}` })) } };
    for (let i = 0; i < 60; i++) many[`${START}/s${i}`] = { text: `S${i}\nDish\n${i}\n$` };
    const big = fakeSite({ pages: many });
    const out = await crawlMenu({ startUrl: START, driver: big.driver, robotsTxt: "", sleep: async () => {} });
    expect(big.opened.length).toBe(MAX_PAGES);
    expect(out.refused.filter((r: any) => r.reason === "page_limit").length).toBe(60 - (MAX_PAGES - 1));
  });
});

// ---------- 5 a real browser on the saved JavaScript menu page ----------
const required = process.env.MENU_BROWSER_REQUIRED === "1";
let chromium: any = null;
try { chromium = (await import("playwright")).chromium; const b = await chromium.launch(); await b.close(); } catch (e) {
  if (required) throw new Error(`MENU_BROWSER_REQUIRED=1 but Chromium could not start: ${String((e as Error).message).slice(0, 200)}`);
  chromium = null;
}
describe.skipIf(!chromium)("5 Chromium on the saved JavaScript menu page (sections on their own pages, a Drinks tab)", () => {
  it("finds every section and the Drinks tab's, opens each once, obeys robots.txt, never opens the sign-in link, keeps text and screenshots", async () => {
    const dir = new URL("../fixtures/menus/js-site/", import.meta.url);
    const hits: string[] = [];
    const srv = http.createServer((q, s) => {
      hits.push(q.url ?? "");
      if (q.url === "/robots.txt") { s.setHeader("content-type", "text/plain"); s.end(readFileSync(new URL("robots.txt", dir))); return; }
      s.setHeader("content-type", "text/html; charset=utf-8"); s.end(readFileSync(new URL("index.html", dir)));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(srv.address() as any).port}`;
    const robotsTxt = await (await fetch(`${base}/robots.txt`)).text();
    const driver = await playwrightDriver(chromium);
    try {
      const out = await crawlMenu({ startUrl: `${base}/p/example-grill`, driver, robotsTxt, delayMs: 50 });
      expect(out.pages.map((p: any) => p.title)).toEqual(["Start page", "OFFERS / عروضات", "SANDWICHES / سندويشات", "GRILLS / مشاوي", "COLD BEVERAGES"]);
      expect(out.pages.map((p: any) => p.skip_reason === null)).toEqual([false, false, true, true, true]);
      expect(out.pages[2].body).toContain("ساندويش طاووق كبير");
      expect(out.pages[3].body).toContain("Taouk, kafta and lamb with fries");
      expect(out.pages[3].body).toContain("12 - 20");
      expect(out.pages[4].body).toMatch(/Water\nSmall\n0\.5\s*\$/);
      for (const p of out.pages.slice(1)) expect(p.body).not.toContain("Example Grill House");       // the site's header, taken off
      for (const p of out.pages) expect(p.shot[0]).toBe(0xff);                                          // a JPEG screenshot
      expect(out.refused).toEqual([{ url: `${base}/p/example-grill/private-sec`, reason: "robots" }]);
      const pages = hits.filter((h) => h !== "/robots.txt");
      expect(pages).toEqual(["/p/example-grill", "/p/example-grill/s-offers", "/p/example-grill/s-sandwiches", "/p/example-grill/s-grills", "/p/example-grill/s-cold"]);
      expect(hits).not.toContain("/login");
    } finally { await driver.close(); srv.close(); }
  }, 120_000);
});
