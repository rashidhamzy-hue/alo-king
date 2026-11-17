// The cockpit shell (session D5): every page is valid HTML with a language, a direction and a title; every control is at least
// 44 px; Arabic mirrors and is honest about the pages that are still English; the bottom navigation and its badges follow the
// role; the app is installable; the service worker may store the shell and nothing else; the names page's keys do what they say.
import { beforeAll, describe, expect, it } from "vitest";
import { CSS, TAP_PX } from "../src/style";
import { UI_TOKENS } from "../src/ui.generated";
import { SHELL_ASSETS, SHELL_JS, swSource } from "../src/pwa";
import { rig, type Rig } from "./kit";

let r: Rig;
beforeAll(async () => { r = await rig(); }, 120_000);

// ---------- a small HTML checker: tags balance, one h1, the head is complete ----------
const VOID = new Set(["meta", "link", "input", "br", "hr", "img", "source", "col", "area", "base", "wbr"]);
function check(html: string, label: string, opts: { installable?: boolean } = {}) {
  expect(html.startsWith("<!doctype html>"), label).toBe(true);
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const [, close, tag, rest] = m; const name = tag!.toLowerCase();
    if (VOID.has(name) || rest!.endsWith("/")) continue;
    if (close) { expect(stack.pop(), `${label}: </${name}> closes ${stack.at(-1)}`).toBe(name); } else stack.push(name);
  }
  expect(stack, `${label}: unclosed ${stack.join(",")}`).toEqual([]);
  expect(/<html lang="(en|ar)" dir="(ltr|rtl)">/.test(html), `${label}: html lang and dir`).toBe(true);
  expect(/<title>[^<]+<\/title>/.test(html), `${label}: title`).toBe(true);
  expect(html.match(/<h1\b/g)?.length, `${label}: one h1`).toBe(1);
  expect(html, label).toContain('name="viewport"');
  if (opts.installable !== false) { expect(html, label).toContain('rel="manifest" href="/manifest.webmanifest"'); expect(html, label).toContain('rel="apple-touch-icon"'); }
  expect(html, `${label}: no inline script or style`).not.toMatch(/<script(?![^>]*\bsrc=)|<style|\sstyle="/);
}

const LEAD_PAGES = ["/", "/inbox", "/orders", "/approve", "/stock", "/more", "/install", "/names", "/payments", "/exceptions", "/catalog", "/riders", "/readiness", "/windows", "/zones", "/money", "/approvals", "/pictures", "/receiving", "/returns", "/refunds", "/cases", "/day-open", "/food-facts", "/search-words", "/auto-approvals", "/fx", "/intake"];

describe("the shell", () => {
  it("renders every page as valid HTML with a language, a direction, a title, one heading, and no inline script or style", async () => {
    const lead = await r.staff("admin", "Rasheed"); const b = r.browser(); await b.signIn(lead);
    for (const p of LEAD_PAGES) { const res = await b.get(p); expect(res.status, p).toBe(200); check(res.text, p); }
    check((await r.browser().get("/sign-in")).text, "/sign-in");
    check((await r.browser().get("/offline")).text, "/offline", { installable: false });
  }, 120_000);

  it("has no control smaller than 44 px: one token, and every interactive rule uses it", () => {
    expect(TAP_PX).toBe(44);
    expect(CSS).toContain("--tap:44px");
    const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const must = ["button", "input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file])", "select", "textarea", ".btn", ".chips a", ".hub a", ".sidebar a", ".bottom-nav a"];
    for (const sel of must) {
      const rule = rules.find((x) => x.sel.split(",").map((s) => s.trim()).includes(sel) && /min-block-size/.test(x.body));
      expect(rule, `a min-block-size rule for ${sel}`).toBeTruthy();
      const v = /min-block-size:([^;]+)/.exec(rule!.body)![1]!.trim();
      // DS2: a height may be any token (--tap, --nav-h, --ak-control ...): read its value from the sheet itself
      const token = /^var\((--[a-z-]+)\)$/.exec(v)?.[1];
      const px = token ? Number(new RegExp(`${token}:(\\d+)px`).exec(CSS)?.[1]) : Number.parseFloat(v);
      expect(px, `${sel} is ${v}`).toBeGreaterThanOrEqual(44);
    }
    expect(CSS).toMatch(/input\[type=checkbox\],input\[type=radio\]\{inline-size:var\(--tap\);block-size:var\(--tap\)/);
    expect(CSS).not.toMatch(/(?:^|[;{\s])(?:margin|padding|border|text-align|float)-(?:left|right)\s*:/);            // logical properties only: Arabic mirrors
  });

  it("follows the language cookie: Arabic is right to left, and a page still in English says so inside it", async () => {
    const lead = await r.staff("admin", "Rasheed"); const b = r.browser(); await b.signIn(lead);
    const sw = await b.get("/lang?to=ar&next=/more");
    expect(sw.status).toBe(303); expect(sw.location).toBe("/more");
    const more = (await b.get("/more")).text;
    expect(more).toContain('<html lang="ar" dir="rtl">'); expect(more).toContain("<main id=\"main\">");
    const names = (await b.get("/names")).text;                                           // built before D5: English inside the Arabic shell
    expect(names).toContain('<html lang="ar" dir="rtl">'); expect(names).toContain('<main id="main" lang="en" dir="ltr">');
    check(more, "ar /more"); check(names, "ar /names");
    expect((await b.get("/")).text).toContain("اليوم");
    // an open redirect is not a language switch; an unknown language changes nothing
    expect((await b.get("/lang?to=ar&next=//evil.example")).location).toBe("/");
    expect((await b.get("/lang?to=ar&next=/\\evil.example")).location).toBe("/");
    await b.get("/lang?to=xx&next=/");
    expect((await b.get("/more")).text).toContain('<html lang="ar"');
    await b.get("/lang?to=en&next=/");
    expect((await b.get("/more")).text).toContain('<html lang="en" dir="ltr">');
  });

  it("shows the phone bar of the role, with a badge on the places that have something waiting", async () => {
    // DS2 (the design reference): admin Today, Orders, Inbox, Approve; lead Today, Orders, Inbox, Dispatch; picker Pick, Stock, Intake; More for all
    const bar = (page: string) => /<nav class="bottom-nav"[\s\S]*?<\/nav>/.exec(page)![0];
    const places = (page: string) => [...bar(page).matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    const admin = await r.staff("admin", "Rasheed"); const a = r.browser(); await a.signIn(admin);
    const bottom = bar((await a.get("/")).text);
    expect(places(bottom)).toEqual(["/", "/orders", "/inbox", "/approve", "/more"]);
    expect(bottom).toMatch(/href="\/approve"[^>]*>[\s\S]*?<span class="badge">99\+<\/span>/);           // 282 names wait: capped at 99+
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/")).text;
    expect(places(page)).toEqual(["/", "/orders", "/inbox", "/rider-jobs", "/more"]);
    expect(bar(page)).toMatch(/href="\/more"[^>]*>[\s\S]*?<span class="badge">99\+<\/span>/);              // a lead's approvals wait under More
    expect(bar((await b.get("/rider-jobs")).text)).toMatch(/<a href="\/rider-jobs" aria-current="page">/);
    expect(bar((await b.get("/rider-jobs")).text)).not.toMatch(/<a href="\/more" aria-current="page">/);       // one place is current, never two
    expect(page).toContain('<aside class="sidebar"');                                                       // the wide-screen list is in the same page
    const picker = await r.staff("picker", "Pia"); const p = r.browser(); await p.signIn(picker);
    const pp = (await p.get("/")).text;
    expect(places(pp)).toEqual(["/pick", "/stock", "/capture", "/more"]);       // D4b: the pick queue is a picker's main place; DS2: then Stock and Intake
    expect(pp).toContain('<a class="side-brand" href="/">');                                             // Today stays one tap away: the crown
    expect(bar((await p.get("/capture")).text)).toMatch(/<a href="\/capture" aria-current="page">/);
    expect(bar((await p.get("/pick")).text)).toMatch(/<a href="\/pick" aria-current="page">/);
    expect(pp).not.toContain('href="/orders"'); expect(pp).not.toContain('href="/names"'); expect(pp).not.toContain('href="/inbox"');
    expect((await p.get("/orders")).status).toBe(403);
    const hub = (await b.get("/approve")).text;
    expect(hub).toContain('<a href="/names">'); expect(hub).toMatch(/href="\/names"><span>Names<\/span> <span class="badge">99\+/);
  });
});

describe("installable", () => {
  it("serves a manifest, icons and the page script without signing in", async () => {
    const anon = r.browser();
    const m = await anon.get("/manifest.webmanifest");
    expect(m.status).toBe(200); expect(m.headers.get("content-type")).toContain("manifest+json");
    const man = JSON.parse(m.text);
    expect(man).toMatchObject({ display: "standalone", scope: "/", start_url: "/?source=pwa", theme_color: UI_TOKENS.ink, background_color: UI_TOKENS.paper });   // DS1: the brand's ink and paper, from tokens.css
    expect(man.icons.map((i: any) => `${i.sizes}:${i.purpose}`).sort()).toEqual(["192x192:any", "192x192:maskable", "512x512:any", "512x512:maskable"]);
    for (const i of man.icons) { const res = await anon.get(i.src); expect(res.status, i.src).toBe(200); expect(res.headers.get("content-type")).toBe("image/png"); }
    const apple = await (await import("../src/app")).handle(new Request("https://console.test/icons/apple-touch-icon.png"), r.deps, []);
    expect([...new Uint8Array(await apple.arrayBuffer()).slice(0, 4)]).toEqual([137, 80, 78, 71]);
    expect((await anon.get("/shell.js")).status).toBe(200);
    expect((await anon.get("/icons/nope.png")).status).toBe(303);                                                         // not a shell file: signed-out, like any other path
  });

  it("tells an iPhone user how to add it to the Home Screen, and says push works only after that", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/install")).text;
    expect(page).toContain("Add to Home Screen"); expect(page).toContain("Safari"); expect(page).toContain("Alerts can only be switched on from that icon");
    expect((await b.get("/more")).text).toContain('href="/install"');
  });

  it("allows the page script, the worker, the manifest and fetches to this site and nothing else", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const csp = (await b.get("/")).headers.get("content-security-policy")!;
    for (const d of ["script-src 'self'", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "style-src 'self'", "default-src 'none'", "frame-ancestors 'none'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });
});

// ---------- the service worker, run against a fake browser ----------
function runWorker() {
  const listeners: Record<string, (e: any) => void> = {};
  const store = new Map<string, Response>(); const puts: string[] = []; const shown: any[] = []; let online = true; const fetched: string[] = [];
  const key = (req: any) => new URL(typeof req === "string" ? `https://console.test${req}` : req.url).pathname;
  const cache = { addAll: async (reqs: any[]) => { for (const q of reqs) store.set(key(q), new Response("shell " + key(q))); }, match: async (req: any) => store.get(key(req)), put: async (req: any, res: Response) => { puts.push(key(req)); store.set(key(req), res); } };
  const self = { addEventListener: (t: string, f: any) => { listeners[t] = f; }, location: { origin: "https://console.test" }, skipWaiting: async () => undefined, clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (u: string) => { shown.push({ open: u }); } },
    registration: { showNotification: async (title: string, o: any) => { shown.push({ title, ...o }); } } };
  const caches = { open: async () => cache, match: async (p: string) => store.get(key(p)) };
  const fetchFn = async (req: any) => { fetched.push(key(req)); if (!online) throw new TypeError("offline"); return new Response("page " + key(req), { status: 200 }); };
  // A browser resolves a relative address against the worker's own; Node's Request wants it absolute.
  class Req extends Request { constructor(u: any, i?: RequestInit) { super(typeof u === "string" && u.startsWith("/") ? `https://console.test${u}` : u, i); } }
  new Function("self", "caches", "fetch", "URL", "Request", swSource())(self, caches, fetchFn, URL, Req);
  const dispatch = async (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => {
    const req = { url: (init.origin ?? "https://console.test") + path, method: init.method ?? "GET", mode: init.mode ?? "navigate" };
    let answer: Promise<Response> | undefined;
    listeners.fetch!({ request: req, respondWith: (p: Promise<Response>) => { answer = p; } });
    const res = answer ? await answer : undefined;
    return { intercepted: !!answer, text: res ? await res.clone().text() : null };
  };
  const waited = async (t: string, e: any = {}) => { let p: Promise<unknown> | undefined; listeners[t]!({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  return { store, puts, shown, fetched, offline: () => { online = false; }, online: () => { online = true; }, dispatch, waited };
}

describe("the service worker", () => {
  it("may store exactly this list, and the worker's own text names no other address", () => {
    expect([...SHELL_ASSETS]).toEqual(["/console.css", "/shell.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/offline"]);
    const src = swSource();
    const named = [...src.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]!);
    for (const p of named.filter((x) => x !== "//")) expect([...SHELL_ASSETS, "/"], `the worker names ${p}`).toContain(p);      // "//" is the check that refuses a protocol-relative address
    expect(src.match(/\.put\(/g)).toHaveLength(1);
    expect(src.indexOf(".put(")).toBeGreaterThan(src.indexOf("SHELL.includes("));
    for (const page of ["/orders", "/payments", "/names", "/exceptions", "/money", "/riders", "/catalog", "/chats"]) expect(src).not.toContain(page);
  });

  it("serves every shell file the same to everyone: nothing personal in what it keeps", async () => {
    const lead = await r.staff("admin", "Rasheed"); const signed = r.browser(); await signed.signIn(lead);
    const anon = r.browser();
    for (const p of SHELL_ASSETS) {
      const a = await anon.get(p), s = await signed.get(p);
      expect(a.status, p).toBe(200); expect(s.text, p).toBe(a.text);
      expect(a.text, p).not.toMatch(/Rasheed|ak_console|value="[A-Za-z0-9_-]{30,}"/);
    }
    const sw = await anon.get("/sw.js");
    expect(sw.headers.get("service-worker-allowed")).toBe("/"); expect(sw.headers.get("cache-control")).toBe("no-cache");
  });

  it("caches the shell on install, answers it from the phone, and stores no page, form or data", async () => {
    const w = runWorker();
    await w.waited("install");
    expect([...w.store.keys()].sort()).toEqual([...SHELL_ASSETS].sort());
    // a page: from the network, never stored
    const page = await w.dispatch("/orders/AK-1001");
    expect(page).toEqual({ intercepted: true, text: "page /orders/AK-1001" });
    expect(w.puts).toEqual([]);
    // the shell: from the phone, refreshed in the background
    const css = await w.dispatch("/console.css", { mode: "no-cors" });
    expect(css.text).toBe("shell /console.css");
    await new Promise((res) => setTimeout(res, 5));
    expect(w.puts).toEqual(["/console.css"]);
    // a form post, another site, a fetch for data: not touched at all
    expect((await w.dispatch("/names/batch/approve", { method: "POST" })).intercepted).toBe(false);
    expect((await w.dispatch("/x.js", { origin: "https://other.example" })).intercepted).toBe(false);
    expect((await w.dispatch("/push/subscribe", { mode: "cors" })).intercepted).toBe(false);
    expect(w.puts).toEqual(["/console.css"]);
  });

  it("shows the offline page instead of an error when a page cannot be reached, and never a stale one", async () => {
    const w = runWorker(); await w.waited("install"); w.offline();
    const res = await w.dispatch("/orders");
    expect(res).toEqual({ intercepted: true, text: "shell /offline" });
    expect(w.puts).toEqual([]);
  });

  it("shows an alert and opens only a path on this site when it is tapped", async () => {
    const w = runWorker();
    const data = (o: object) => ({ data: { json: () => o } });
    await w.waited("push", data({ title: "Alo King · needs you", body: "Allergen complaint · AK-4821", url: "/cases", tag: "exception-1" }));
    await w.waited("push", data({ title: "x", url: "https://evil.example/phish" }));
    expect(w.shown[0]).toMatchObject({ title: "Alo King · needs you", body: "Allergen complaint · AK-4821", tag: "exception-1", data: { url: "/cases" } });
    expect(w.shown[1]).toMatchObject({ data: { url: "/" } });
    let closed = false;
    await w.waited("notificationclick", { notification: { close: () => { closed = true; }, data: { url: "/cases" } } });
    expect(closed).toBe(true); expect(w.shown.at(-1)).toEqual({ open: "/cases" });
  });
});

// ---------- the names page's keys, run against a fake page ----------
function runKeys() {
  const mk = (sku: string) => {
    const cls = new Set<string>(); const clicks: string[] = []; const focused: string[] = [];
    const btn = (v: string) => ({ click: () => clicks.push(`${sku}:${v}`) });
    const input = { focus: () => focused.push(sku), select: () => undefined };
    return { sku, cls, clicks, focused, classList: { toggle: (c: string, on: boolean) => { if (on) cls.add(c); else cls.delete(c); } }, scrollIntoView: () => undefined, addEventListener: () => undefined,
      querySelector: (q: string) => { const m = /value=(\w+)\]$/.exec(q); if (m) return btn(m[1]!); if (q.includes("name_en")) return input; return null; } };
  };
  const blocks = ["AK-1", "AK-2", "AK-3"].map(mk);
  const handlers: Record<string, (e: any) => void> = {};
  const root = { querySelectorAll: () => blocks };
  const document = { querySelector: (q: string) => (q === "[data-names]" ? root : null), addEventListener: (t: string, f: any) => { handlers[t] = f; } };
  new Function("document", "navigator", "window", "Notification", SHELL_JS)(document, {}, {}, undefined);
  const key = (k: string, target: any = { tagName: "BODY" }, mods: object = {}) => { let prevented = false; handlers.keydown!({ key: k, target, preventDefault: () => { prevented = true; }, ...mods }); return prevented; };
  return { blocks, key, clicks: () => blocks.flatMap((b) => b.clicks), current: () => blocks.findIndex((b) => b.cls.has("names-current")) };
}

describe("the names page's keys", () => {
  it("arrows move between items; a approves, r rejects and c starts a correction on the one in front; typing is never a shortcut", () => {
    const k = runKeys();
    expect(k.current()).toBe(0);
    expect(k.key("ArrowDown")).toBe(true); expect(k.current()).toBe(1);
    k.key("ArrowDown"); k.key("ArrowDown"); expect(k.current()).toBe(2);        // stops at the last
    k.key("ArrowUp"); expect(k.current()).toBe(1);
    k.key("a"); k.key("r");
    expect(k.clicks()).toEqual(["AK-2:approve", "AK-2:reject"]);
    k.key("c"); expect(k.blocks[1]!.focused).toEqual(["AK-2"]);
    // typing in a field: nothing is taken, except Enter, which saves the correction
    const field = { tagName: "INPUT", form: { querySelector: (q: string) => (q.includes("value=correct") ? { click: () => k.blocks[1]!.clicks.push("AK-2:correct") } : null) }, closest: () => ({}) };
    expect(k.key("a", field)).toBe(false); expect(k.key("r", field)).toBe(false);
    k.key("Enter", field);
    expect(k.clicks()).toEqual(["AK-2:approve", "AK-2:reject", "AK-2:correct"]);
    // a held modifier is the browser's, not ours
    k.key("a", { tagName: "BODY" }, { ctrlKey: true }); k.key("r", { tagName: "BODY" }, { metaKey: true });
    expect(k.clicks()).toHaveLength(3);
    // a focused button keeps its own Enter
    k.key("Enter", { tagName: "BUTTON" }); expect(k.clicks()).toHaveLength(3);
  });
});
