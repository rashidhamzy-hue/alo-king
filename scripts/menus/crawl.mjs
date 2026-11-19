// MENU2 (19 November 2026): a menu web page, fetched by the menu-read workflow with a headless browser. docs/DECISIONS.md, "MENU2".
// Menu sites (oddmenu.com and the like) draw the menu with JavaScript and put each section on its own page, so a plain download sees nothing.
// The rules, all kept here:
//   * robots.txt is read first (one request) and obeyed for every page: a page it disallows is not opened. A robots.txt that cannot be read
//     (a server error or no answer) stops the fetch; a missing one (404) allows it (RFC 9309).
//   * Same site only: the start page, the section pages it links to on the same host under the same path, and its tabs (buttons such as
//     "Drinks" that show more section links without leaving the page). Never a link to another site, a sign-in, an account, a cart or an
//     order page; never a form filled, never a password. A page that sends us to a sign-in page is not read.
//   * One fetch per page: every address is opened once, one after the other, with a pause between them; at most MAX_PAGES pages.
//   * Each page is kept as the source record: its visible text (the lines every page repeats, such as the site's header, are taken off the
//     section pages) and a screenshot. A page with no figure in its text shows no price and is kept but not read.
// The browser is injected (driver), so test/db/menu2-crawl.test.ts runs the same loop on a fake site and on a saved JavaScript menu page.
export const MAX_PAGES = 40;
export const USER_AGENT = "AloKingMenuReader/1.0 (reads a restaurant's public menu once, for the place's own listing; no sign-in)";
const AVOID = /(^|\b|\/)(log ?in|log ?out|sign ?in|sign ?up|signin|signup|register|account|profile|cart|basket|checkout|order|password|auth|admin|terms|privacy|cookies?)(\b|\/|$)|تسجيل|دخول|حساب|سلة|كلمة السر/i;

// ---------- robots.txt (RFC 9309: the group for our agent, else *; the longest matching rule wins; Allow wins a tie) ----------
export function robotsRules(txt, agent = "AloKingMenuReader") {
  const groups = []; let cur = null; let lastWasAgent = false;
  for (const raw of (txt ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const a = agent.toLowerCase();
  return (groups.find((g) => g.agents.some((x) => x !== "*" && a.includes(x))) ?? groups.find((g) => g.agents.includes("*")))?.rules ?? [];
}
const ruleRe = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
export function robotsAllows(rules, url) {
  const u = new URL(url); const path = decodeURIComponent(u.pathname) + u.search;
  let best = null;
  for (const r of rules) {
    if (r.path === "") continue;                                     // "Disallow:" with nothing allows everything
    if (!ruleRe(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ---------- which links are sections ----------
const host = (u) => new URL(u).hostname.replace(/^www\./, "");
const clean = (u) => { const x = new URL(u); x.hash = ""; return x.toString(); };
/** The section pages a start page links to: same host, under the start page's path, not the start page, nothing to avoid. */
export function sectionLinks(startUrl, anchors) {
  const start = new URL(startUrl); const base = start.pathname.replace(/\/+$/, "");
  const seen = new Set(); const out = [];
  for (const a of anchors) {
    let u; try { u = new URL(a.href, startUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || host(u.toString()) !== host(startUrl)) continue;
    const path = u.pathname.replace(/\/+$/, "");
    if (path === base || !path.startsWith(base + "/")) continue;
    if (AVOID.test(path) || AVOID.test(a.text ?? "")) continue;
    if (/\.(pdf|jpe?g|png|webp|gif|zip|docx?|xlsx?)$/i.test(path)) continue;
    const k = clean(u.toString());
    if (seen.has(k)) continue;
    seen.add(k); out.push({ url: k, title: (a.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null });
  }
  return out;
}
/** Buttons worth pressing as tabs: short visible text, nothing to avoid. */
export const tabLike = (t) => { const s = (t ?? "").replace(/\s+/g, " ").trim(); return s.length >= 2 && s.length <= 30 && !AVOID.test(s); };
export const signInPage = (url) => /\/(log ?in|sign ?in|signin|auth|account)(\/|$|\?)/i.test(new URL(url).pathname + new URL(url).search);

/** The site's header and footer: lines on the start page that at least 80% of the section pages repeat, with a letter in them and not a
 *  currency mark ("$", "L.L." are on every priced page and are part of the menu). Dropped from each section page, so the reader sees the menu. */
const CURRENCY_LINE = /^(\$|usd|us\$|l\.?\s?l\.?|lbp|ل\.?\s?ل\.?|ليرة|دولار)$/i;
export function chromeLines(startText, texts) {
  if (texts.length < 3) return new Set();
  const onStart = new Set((startText ?? "").split("\n").map((x) => x.trim()).filter(Boolean));
  const n = new Map();
  for (const t of texts) for (const l of new Set(t.split("\n").map((x) => x.trim()).filter(Boolean))) n.set(l, (n.get(l) ?? 0) + 1);
  return new Set([...n].filter(([l, k]) => k >= Math.ceil(texts.length * 0.8) && onStart.has(l) && /\p{L}/u.test(l) && !CURRENCY_LINE.test(l)).map(([l]) => l));
}
const hasFigure = (t) => /[0-9٠-٩]/.test(t);

/**
 * crawlMenu({ startUrl, driver, robotsTxt, maxPages, delayMs, sleep, log }) -> { pages: [{position, url, title, body, shot, skip_reason}], opened: [urls], refused: [{url, reason}] }
 * driver: { open(url) -> { url, text, anchors: [{href, text}], tabs: [{key, text}] }, clickTab(key) -> { url, text, anchors }, screenshot() -> Uint8Array, close() }
 * robotsTxt: the text of robots.txt, "" when there is none (404), or null when it could not be read (then nothing is fetched).
 */
export async function crawlMenu(o) {
  const log = o.log ?? (() => {}); const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const max = Math.min(o.maxPages ?? MAX_PAGES, MAX_PAGES); const delay = o.delayMs ?? 1500;
  if (o.robotsTxt === null || o.robotsTxt === undefined) throw new Error("robots_unreadable: the site's robots.txt could not be read, so nothing is fetched");
  const rules = robotsRules(o.robotsTxt);
  const start = clean(o.startUrl);
  if (!robotsAllows(rules, start)) throw new Error("robots_disallow: the site's robots.txt does not allow this page");
  const opened = []; const refused = []; const raw = [];
  // 1 the start page, once
  const first = await o.driver.open(start); opened.push(start);
  if (signInPage(first.url ?? start)) throw new Error("sign_in: the page asks for a sign-in; nothing is read");
  raw.push({ url: start, title: null, text: first.text, shot: await o.driver.screenshot() });
  const queue = sectionLinks(start, first.anchors);
  // 2 its tabs: press each (the site's own script shows them; no page is fetched by us), keep the links each shows, and its text if new
  for (const t of (first.tabs ?? []).filter((x) => tabLike(x.text)).slice(0, 8)) {
    const r = await o.driver.clickTab(t.key).catch(() => null);
    if (!r) continue;
    if (r.url && clean(r.url) !== start) {                           // a tab that is really a link: open it later like any other page
      if (!signInPage(r.url) && host(r.url) === host(start)) queue.push({ url: clean(r.url), title: t.text.trim() });
      continue;
    }
    for (const l of sectionLinks(start, r.anchors ?? [])) if (!queue.some((q) => q.url === l.url)) queue.push({ ...l, tab: t.text.trim() });
    if (r.text && r.text !== first.text && hasFigure(r.text) && !raw.some((x) => x.text === r.text)) raw.push({ url: start, title: t.text.trim(), text: r.text, shot: await o.driver.screenshot() });
  }
  // 3 each section page, once, one after the other
  for (const q of queue) {
    if (opened.length >= max) { refused.push({ url: q.url, reason: "page_limit" }); continue; }
    if (opened.includes(q.url)) continue;
    if (!robotsAllows(rules, q.url)) { refused.push({ url: q.url, reason: "robots" }); continue; }
    await sleep(delay);
    let r;
    try { r = await o.driver.open(q.url); } catch (e) { refused.push({ url: q.url, reason: `failed: ${String(e.message).slice(0, 80)}` }); continue; }
    opened.push(q.url);
    if (r.url && signInPage(r.url)) { refused.push({ url: q.url, reason: "sign_in" }); continue; }
    raw.push({ url: q.url, title: q.title, tab: q.tab ?? null, text: r.text, shot: await o.driver.screenshot() });
    log(`[menu-fetch] ${q.title ?? q.url}`);
  }
  // 4 the record of each page: text without the repeated lines, kept; read only if it shows a figure
  const chrome = chromeLines(raw[0].text, raw.slice(1).map((x) => x.text));
  const pages = raw.map((x, i) => {
    const keep = x.text.split("\n").map((l) => l.trim()).filter((l) => l && !chrome.has(l) && l !== (x.title ?? "").trim());
    const body = [x.title ? `# ${x.title}` : null, ...keep].filter(Boolean).join("\n").slice(0, 60000);
    return { position: i, url: x.url, title: x.title ?? (i === 0 ? "Start page" : null), body, shot: x.shot,
             skip_reason: hasFigure(keep.join("\n")) ? null : (i === 0 && raw.length > 1 ? "the start page lists the sections; each is read on its own page" : "the page shows no item or price") };
  });
  return { pages, opened, refused };
}

/** The real browser, for the workflow: Playwright's Chromium, a phone-sized window, no sign-in, no download. */
export async function playwrightDriver(chromium, o = {}) {
  const browser = await chromium.launch(o.launch ?? {});
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 420, height: 900 }, locale: "ar", acceptDownloads: false, javaScriptEnabled: true });
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  const MAX_SHOT_H = 12000;
  // mark: number the visible buttons once, when a page opens, so a tab pressed later is the one listed (the marks stay on the elements)
  const read = async (mark) => page.evaluate((mark) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    let tabs = [];
    if (mark) {
      tabs = [...new Set([...document.querySelectorAll('[role="tab"], button')].filter(vis))].slice(0, 20);
      tabs.forEach((e, i) => e.setAttribute("data-ak-tab", String(i)));
    }
    return { url: location.href, text: document.body.innerText,
             anchors: [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: a.innerText })),
             tabs: tabs.map((e, i) => ({ key: String(i), text: e.innerText })) };
  }, mark);
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // lazy lists: scroll to the end once, then back to the top
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight && y < 30000; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(400);
  };
  return {
    async open(url) { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); await settle(); return read(true); },
    async clickTab(key) { await page.click(`[data-ak-tab="${key}"]`, { timeout: 5000 }); await settle(); return read(false); },
    async screenshot() {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      return new Uint8Array(await page.screenshot({ type: "jpeg", quality: 70, fullPage: true, clip: { x: 0, y: 0, width: 420, height: Math.min(h, MAX_SHOT_H) } }));
    },
    async close() { await browser.close(); },
  };
}

/** robots.txt for a start page: its text, "" for none (404, 410), null when it could not be read. One request. */
export async function fetchRobots(startUrl, f = fetch) {
  try {
    const r = await f(new URL("/robots.txt", startUrl).toString(), { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (r.status === 404 || r.status === 410) return "";
    if (!r.ok) return r.status >= 400 && r.status < 500 ? "" : null;
    return (await r.text()).slice(0, 500_000);
  } catch { return null; }
}
