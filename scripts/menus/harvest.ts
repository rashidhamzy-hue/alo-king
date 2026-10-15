// Menu harvest (DECISIONS §39.4 source 2), run by .github/workflows/menu-harvest.yml (build sessions cannot reach
// these hosts). Two steps:
//   capture <raw dir>   opens every source link in headless Chromium and keeps what the page loads: its JSON
//                       responses (the platforms' menu APIs), the final HTML, the visible text, and the text of a
//                       linked PDF (pdftotext). One "menu" link on the same site is followed, one level down.
//   parse <raw dir> <out dir>
//                       reads the captures with scripts/menus/adapters.ts and writes
//                       <out>/05_harvested_menus.json (the drafts build-shouf.ts loads), <out>/harvest-report.md
//                       (per village and merchant: adapter, method, items, priced items, or why nothing was read)
//                       and <out>/harvest-shapes.md (what each page loaded, as URLs and JSON key skeletons).
// Instagram, Facebook and other login-walled pages are never opened (scripts/menus/sources.ts).
// Usage: node --experimental-strip-types scripts/menus/harvest.ts capture <raw> | parse <raw> <out>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  allItems,
  bestDraft,
  driveDownloadUrl,
  fromJson,
  fromJsonLd,
  fromOmega,
  fromProductCards,
  fromText,
  htmlText,
  jsonFromSite,
  menuLinks,
  pricedItems,
} from "./adapters.ts";
import { menuSources, type MenuSource } from "./sources.ts";

const MERCHANTS = "supabase/seed/shouf/source/01_shouf_merchants_315.csv";
const EXTRA = "supabase/seed/shouf/menu_sources_extra.csv";
const MAX_JSON_BYTES = 2_000_000;
const MAX_PDF_BYTES = 15_000_000;

export function sources(): MenuSource[] {
  const all = menuSources(
    readFileSync(MERCHANTS, "utf8"),
    existsSync(EXTRA) ? readFileSync(EXTRA, "utf8") : null,
  );
  // ONLY=<place id>,<place id>: harvest just these merchants (the parse step then merges into the committed drafts).
  const only = onlyIds();
  return only.size ? all.filter((s) => only.has(s.place_id)) : all;
}

export function onlyIds(): Set<string> {
  return new Set(
    (process.env.ONLY ?? "")
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

/**
 * Runs inside the menu page (page.evaluate): every element whose own text is one price, grown to the largest block
 * that still holds only that price (the item's card), with the card's text, its picture (an <img> or a CSS
 * background) and the nearest heading before it (the section). Works on plain sites and on platforms whose menu is
 * rendered HTML; the parser reads the cards with fromCards().
 */
export function extractCards() {
  const PRICE =
    /^[\s(]*(?:(?:\$|usd|us\$|lbp|l\.?l\.?|ل\.?ل\.?)\s*)?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s*(?:\$|usd|lbp|l\.?l\.?|ل\.?ل\.?|ليرة|k)?[\s)]*$/i;
  const ownText = (e: Element) =>
    Array.from(e.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  const isPrice = (e: Element) => {
    const t =
      (e.children.length ? ownText(e) : (e.textContent || "").replace(/\s+/g, " ").trim()) || "";
    return t.length > 0 && t.length <= 24 && /\d/.test(t) && PRICE.test(t);
  };
  const all = Array.from(document.querySelectorAll("body *")).filter(
    (e) => !/^(SCRIPT|STYLE|NOSCRIPT|SVG|OPTION|SELECT|INPUT|TEXTAREA)$/.test(e.tagName),
  );
  const prices = all.filter((e) => isPrice(e) && e.getClientRects().length);
  const count = (root: Element) => {
    let n = 0;
    for (const p of prices) if (root.contains(p)) n++;
    return n;
  };
  const picture = (root: Element) => {
    for (const img of Array.from(root.querySelectorAll("img"))) {
      const src =
        img.currentSrc ||
        img.getAttribute("src") ||
        img.getAttribute("data-src") ||
        (img.getAttribute("srcset") || "").split(/\s+/)[0];
      if (!src || src.startsWith("data:")) continue;
      if (img.naturalWidth && img.naturalWidth < 80) continue;
      return new URL(src, location.href).toString();
    }
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))].slice(0, 60)) {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m && !m[1].startsWith("data:")) return new URL(m[1], location.href).toString();
    }
    return null;
  };
  const headings = all.filter(
    (e) => /^H[1-6]$/.test(e.tagName) || e.getAttribute("role") === "heading",
  );
  const sectionOf = (el: Element) => {
    let best: Element | null = null;
    for (const h of headings) {
      if (h.contains(el)) continue;
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      else break;
    }
    return best ? (best.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : null;
  };
  const roots: { card: Element; price: Element }[] = [];
  const seen = new Set<Element>();
  for (const p of prices) {
    let card: Element = p;
    while (
      card.parentElement &&
      card.parentElement !== document.body &&
      count(card.parentElement) <= 1
    )
      card = card.parentElement;
    if (seen.has(card)) continue;
    seen.add(card);
    roots.push({ card, price: p });
    if (roots.length >= 1500) break;
  }
  // A heading inside an item's card is the item's name, not a section.
  const inCard = (h: Element) => roots.some((r) => r.card.contains(h));
  for (let k = headings.length - 1; k >= 0; k--) if (inCard(headings[k]!)) headings.splice(k, 1);
  const cards: { section: string | null; text: string; price: string; image: string | null }[] = [];
  for (const { card, price } of roots) {
    const text = ((card as HTMLElement).innerText || card.textContent || "")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!text || text.length > 600) continue;
    cards.push({
      section: sectionOf(card),
      text,
      price: (price.textContent || "").replace(/\s+/g, " ").trim(),
      image: picture(card),
    });
  }
  return cards;
}

type Meta = {
  place_id: string;
  url: string;
  adapter: string | null;
  skip: string | null;
  captured_at: string;
  pages: { url: string; status: number | null; error?: string }[];
  json: { url: string; file: string }[];
  pdf: { url: string; file: string; chars: number }[];
};

export async function capture(rawDir: string, list: MenuSource[] = sources()) {
  // Playwright is a dev dependency (web-quality); the workflow installs Chromium.
  const { chromium } = await import("@playwright/test");
  // CHROMIUM_PATH: a preinstalled Chromium when the pinned Playwright browser is not downloaded (local runs).
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (alo-king menu-harvest; +https://github.com/rashidhamzy-hue/alo-king) Chrome/130",
    locale: "en-US",
  });
  const today = new Date().toISOString().slice(0, 10);
  for (const s of list) {
    const dir = join(
      rawDir,
      s.place_id +
        (list.filter((x) => x.place_id === s.place_id).length > 1
          ? "-" + list.filter((x) => x.place_id === s.place_id).indexOf(s)
          : ""),
    );
    mkdirSync(dir, { recursive: true });
    const meta: Meta = {
      place_id: s.place_id,
      url: s.url,
      adapter: s.adapter,
      skip: s.skip,
      captured_at: today,
      pages: [],
      json: [],
      pdf: [],
    };
    if (s.skip) {
      writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
      console.log(`skip  ${s.name}: ${s.skip}`);
      continue;
    }
    const savePdf = async (url: string) => {
      try {
        const res = await ctx.request.get(driveDownloadUrl(url), { timeout: 60_000 });
        const body = await res.body();
        if (!res.ok() || body.length > MAX_PDF_BYTES || body.subarray(0, 4).toString() !== "%PDF")
          return;
        const n = meta.pdf.length;
        writeFileSync(join(dir, `file-${n}.pdf`), body);
        let text = "";
        try {
          text = execFileSync("pdftotext", ["-layout", join(dir, `file-${n}.pdf`), "-"], {
            maxBuffer: 20e6,
          }).toString();
        } catch {
          // a scanned PDF has no text: the photo reader (source 3) is the way in
        }
        writeFileSync(join(dir, `file-${n}.txt`), text);
        meta.pdf.push({ url, file: `file-${n}.pdf`, chars: text.trim().length });
      } catch (e) {
        meta.pages.push({ url, status: null, error: String(e).slice(0, 200) });
      }
    };
    if (s.adapter === "pdf" || s.adapter === "gdrive_pdf") {
      await savePdf(s.url);
    } else {
      const page = await ctx.newPage();
      page.on("response", async (r) => {
        try {
          const ct = r.headers()["content-type"] ?? "";
          if (!/json/i.test(ct) || r.request().resourceType() === "manifest") return;
          const body = await r.body();
          if (body.length > MAX_JSON_BYTES || body.length < 20) return;
          const n = meta.json.length;
          writeFileSync(join(dir, `json-${n}.json`), body);
          meta.json.push({ url: r.url().slice(0, 300), file: `json-${n}.json` });
        } catch {
          // a response that went away before it was read
        }
      });
      const visit = async (url: string, n: number) => {
        try {
          // Single-page menus keep a socket or a poll open, so "networkidle" may never come (INDINER time,
          // menutigr): wait for the document, then give the menu API up to 30 s to answer (a sleeping free-tier
          // API host, like J.O's on onrender.com, takes 20 s or more to wake).
          const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          // Lazy menus and lazy pictures: scroll down a screen at a time, then back to the top.
          for (let k = 0; k < 60; k++) {
            const more = await page
              .evaluate(() => {
                window.scrollBy(0, window.innerHeight);
                return window.scrollY + window.innerHeight < document.body.scrollHeight;
              })
              .catch(() => false);
            await page.waitForTimeout(250);
            if (!more) break;
          }
          await page.waitForTimeout(1000);
          const html = await page.content();
          const cards = await page.evaluate(extractCards).catch(() => []);
          writeFileSync(join(dir, `cards-${n}.json`), JSON.stringify(cards));
          writeFileSync(join(dir, `page-${n}.html`), html.slice(0, 3_000_000));
          writeFileSync(
            join(dir, `page-${n}.txt`),
            (await page.innerText("body").catch(() => htmlText(html))).slice(0, 500_000),
          );
          meta.pages.push({ url, status: res?.status() ?? null });
          return html;
        } catch (e) {
          meta.pages.push({ url, status: null, error: String(e).slice(0, 200) });
          return null;
        }
      };
      const html = await visit(s.url, 0);
      if (html && (s.adapter === "html" || s.adapter === "directory")) {
        let n = 1;
        for (const link of menuLinks(html, s.url)) {
          if (/\.pdf$/i.test(new URL(link).pathname) || /google\.com/.test(link))
            await savePdf(link);
          else if (n < 3) await visit(link, n++);
        }
      }
      await page.close();
    }
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
    console.log(
      `done  ${s.name}: ${meta.pages.length} pages, ${meta.json.length} json, ${meta.pdf.length} pdf`,
    );
  }
  await browser.close();
}

export type Harvested = {
  place_id: string;
  vendor_name: string;
  village: string;
  source_url: string;
  adapter: string;
  method: string;
  captured_at: string;
  sections: ReturnType<typeof fromJson>["sections"];
  warnings: string[];
};

/** Every candidate draft from one capture directory, and the best one. */
export function readCapture(dir: string) {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  const candidates: { method: string; draft: ReturnType<typeof fromJson> }[] = [];
  const read = (file: string) => {
    try {
      return JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    } catch {
      return undefined; // not JSON after all
    }
  };
  // Only the page's own JSON: ads, analytics and feature flags are not the menu.
  const own = meta.json.filter((j) => jsonFromSite(j.url, meta.url));
  const omegaMenu = own.find((j) => /omegasoftware\.ca\/getRestaurantMenu/.test(j.url));
  if (omegaMenu) {
    const data = own.find((j) => /omegasoftware\.ca\/getRestaurantData/.test(j.url));
    candidates.push({
      method: `omega ${omegaMenu.url}`,
      draft: fromOmega(read(omegaMenu.file), data ? read(data.file) : undefined),
    });
  }
  const cards: string[] = [];
  for (const j of own) {
    const v = read(j.file);
    if (v === undefined) continue;
    candidates.push({ method: `json ${j.url}`, draft: fromJson(v) });
    // Odoo snippets answer JSON-RPC with HTML product cards inside.
    const walk = (x: unknown): void => {
      if (typeof x === "string" && x.includes("oe_product_cart")) cards.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(v);
  }
  for (const f of readdirSync(dir).filter((f) => /^page-\d+\.html$/.test(f))) {
    const html = readFileSync(join(dir, f), "utf8");
    candidates.push({ method: `json-ld ${f}`, draft: fromJsonLd(html) });
    if (html.includes("oe_product_cart")) cards.push(html);
    const txt = join(dir, f.replace(/\.html$/, ".txt"));
    candidates.push({
      method: `text ${f}`,
      draft: fromText(existsSync(txt) ? readFileSync(txt, "utf8") : htmlText(html), {
        requireCurrency: true,
      }),
    });
  }
  if (cards.length)
    candidates.push({ method: "odoo product cards", draft: fromProductCards(cards.join("\n")) });
  for (const p of meta.pdf)
    candidates.push({
      method: `pdf ${p.url}`,
      draft: fromText(readFileSync(join(dir, p.file.replace(/\.pdf$/, ".txt")), "utf8")),
    });
  return { meta, candidates, best: bestDraft(candidates) };
}

/**
 * A sample for writing an adapter, with contact details and key-like strings taken out (the session F incident: never
 * commit a page's emails, phones or platform keys): emails, phone numbers, query strings and long tokens.
 */
export function redact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .replace(/(https?:\/\/[^\s?"'#]+)[?#][^\s"']*/g, "$1")
    .replace(/\+?\d[\d\s-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "<phone>" : m))
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{24,}\b/g, "<token>");
}

const NAMEISH = /^(name|title|item_?name|label|product_?name)/i;
const PRICEISH = /price|amount|cost/i;

/** The first menu-like object in a JSON answer (one of at least two with a name and a price key), values redacted. */
export function menuSample(v: unknown): string | null {
  let found: string | null = null;
  const walk = (x: unknown, path: string, depth: number) => {
    if (found || depth > 12) return;
    if (Array.isArray(x)) {
      const objs = x.filter((o) => o && typeof o === "object" && !Array.isArray(o)) as Record<
        string,
        unknown
      >[];
      const items = objs.filter(
        (o) =>
          Object.keys(o).some((k) => NAMEISH.test(k)) &&
          Object.keys(o).some((k) => PRICEISH.test(k)),
      );
      if (items.length >= 2) {
        const o = items[0];
        const vals = Object.entries(o)
          .slice(0, 30)
          .map(([k, val]) =>
            typeof val === "string"
              ? `${k}=${JSON.stringify(redact(val.slice(0, 80)))}`
              : typeof val === "number" || typeof val === "boolean" || val === null
                ? `${k}=${String(val)}`
                : `${k}=${shape(val, 1).slice(0, 160)}`,
          );
        found = `${path || "$"} (${items.length} of ${x.length}): {${vals.join(", ")}}`;
        return;
      }
      x.slice(0, 5).forEach((y, i) => walk(y, `${path}[${i}]`, depth + 1));
    } else if (x && typeof x === "object") {
      for (const [k, y] of Object.entries(x)) walk(y, `${path}.${k}`, depth + 1);
    }
  };
  walk(v, "", 0);
  return found;
}

/** The key skeleton of a JSON value, two levels deep, no values: enough to write an adapter for a new platform. */
export function shape(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `[${v.length ? shape(v[0], depth) : ""}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).slice(0, 12);
    // A key can itself be data (a map keyed by email, phone or id): those print as "*".
    const label = (k: string) => (/@|\+?\d{6,}/.test(k) ? "*" : k);
    return depth >= 2
      ? `{${keys.map(label).join(",")}}`
      : `{${keys.map((k) => `${label(k)}:${shape((v as Record<string, unknown>)[k], depth + 1)}`).join(",")}}`;
  }
  return typeof v;
}

function parse(rawDir: string, outDir: string) {
  const list = sources();
  // ONLY: a run for a few merchants adds detailed (redacted) samples to the shapes file and merges its menus into the
  // committed drafts instead of replacing the whole file.
  const only = onlyIds();
  const detail = only.size > 0;
  const byPlace = new Map(list.map((s) => [s.place_id, s]));
  const menus: Harvested[] = [];
  const lines: string[] = [];
  const rows: { village: string; name: string; line: string }[] = [];
  // What each page loaded, as URLs without query strings and JSON key skeletons (no values): the raw captures stay
  // on the runner, since a platform's answer can carry the branch's contact details.
  const shapes: string[] = ["# What the menu pages loaded (key skeletons only)", ""];
  for (const d of readdirSync(rawDir).sort()) {
    if (!existsSync(join(rawDir, d, "meta.json"))) continue;
    const { meta, candidates, best } = readCapture(join(rawDir, d));
    const s = byPlace.get(meta.place_id);
    if (!s) continue;
    if (!meta.skip) {
      shapes.push(`## ${s.name} (${meta.adapter})`, "");
      for (const p of meta.pages)
        shapes.push(
          `- page ${p.status ?? p.error?.replace(/\s+/g, " ").slice(0, 80)} ${p.url.split("?")[0]}`,
        );
      for (const p of meta.pdf) shapes.push(`- pdf ${p.chars} chars ${p.url.split("?")[0]}`);
      for (const j of meta.json) {
        let sk = "unreadable";
        try {
          sk = shape(JSON.parse(readFileSync(join(rawDir, d, j.file), "utf8"))).slice(0, 300);
        } catch {
          // not JSON
        }
        shapes.push(
          `- json ${jsonFromSite(j.url, meta.url) ? "own" : "foreign"} ${j.url.split("?")[0].slice(0, 120)} ${sk}`,
        );
        if (detail && jsonFromSite(j.url, meta.url)) {
          try {
            const sample = menuSample(JSON.parse(readFileSync(join(rawDir, d, j.file), "utf8")));
            if (sample) shapes.push(`  - item sample ${sample.slice(0, 900)}`);
          } catch {
            // not JSON
          }
        }
      }
      if (detail) {
        for (const f of readdirSync(join(rawDir, d)).filter((x) => /^cards-\d+\.json$/.test(x))) {
          const cards = JSON.parse(readFileSync(join(rawDir, d, f), "utf8")) as {
            section: string | null;
            text: string;
            image: string | null;
          }[];
          shapes.push(
            `- ${f}: ${cards.length} priced blocks, ${cards.filter((c) => c.image).length} with a picture, ${new Set(cards.map((c) => c.section)).size} headings`,
          );
          for (const c of cards.slice(0, 8))
            shapes.push(
              `  - [${redact(c.section ?? "-")}] ${redact(c.text.replace(/\s*\n\s*/g, " / ").slice(0, 140))} | ${c.image ? redact(c.image).slice(0, 140) : "no picture"}`,
            );
        }
        for (const f of readdirSync(join(rawDir, d)).filter((x) => /^page-\d+\.txt$/.test(x))) {
          const lines = readFileSync(join(rawDir, d, f), "utf8")
            .split(/\n/)
            .map((l) => l.trim())
            .filter((l) => /\d/.test(l) && l.length <= 90);
          shapes.push(`- ${f}: ${lines.length} short lines with a number; the first ones:`);
          for (const l of lines.slice(0, 20)) shapes.push(`  - ${redact(l)}`);
        }
      }
      shapes.push("");
    }
    let line: string;
    if (meta.skip) line = `skipped: ${meta.skip}`;
    else if (!best) {
      const errs = meta.pages
        .filter((p) => p.error || (p.status ?? 0) >= 400)
        .map((p) => p.error ?? `HTTP ${p.status}`);
      const scanned = meta.pdf.filter((p) => p.chars < 50).length;
      const most = Math.max(0, ...candidates.map((c) => pricedItems(c.draft)));
      line =
        errs.length && !meta.json.length
          ? `not read: ${errs[0].replace(/\s+/g, " ").slice(0, 100)}`
          : scanned
            ? `not read: ${scanned} PDF(s) without text (scanned; the photo reader needs API credit)`
            : `not read: no menu with prices found (best ${most} priced items; ${meta.json.length} JSON responses)`;
    } else if (
      menus.some(
        (m) =>
          m.place_id === meta.place_id &&
          m.sections.reduce((n, x) => n + x.items.length, 0) >= allItems(best.draft),
      )
    ) {
      line = "second link: the other one gave a bigger menu";
    } else {
      const k = menus.findIndex((m) => m.place_id === meta.place_id);
      if (k >= 0) menus.splice(k, 1);
      menus.push({
        place_id: meta.place_id,
        vendor_name: s.name,
        village: s.village,
        source_url: meta.url,
        adapter: meta.adapter ?? "html",
        method: best.method.split(" ")[0],
        captured_at: meta.captured_at,
        sections: best.draft.sections,
        warnings: best.draft.warnings,
      });
      line = `**${allItems(best.draft)} items, ${pricedItems(best.draft)} priced** in ${best.draft.sections.length} sections (${meta.adapter}, ${best.method.slice(0, 80)})`;
    }
    rows.push({
      village: s.village || "(none)",
      name: s.name,
      // A chat link is a phone number: the report names the host only.
      line: `${line} — ${/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//.test(meta.url) ? new URL(meta.url).hostname : meta.url.slice(0, 80)}`,
    });
  }
  mkdirSync(outDir, { recursive: true });
  const harvested = new Date().toISOString().slice(0, 10);
  const outFile = join(outDir, "05_harvested_menus.json");
  if (only.size && existsSync(outFile)) {
    // Merge: the other merchants' committed menus stay as they are.
    const prev = JSON.parse(readFileSync(outFile, "utf8")) as {
      harvested: string;
      menus: Harvested[];
    };
    const kept = prev.menus.filter((m) => !only.has(m.place_id));
    writeFileSync(
      outFile,
      JSON.stringify({ harvested: prev.harvested, menus: [...kept, ...menus] }, null, 1) + "\n",
    );
    const names = new Set(list.map((s) => s.name));
    const keepLines = (file: string, block: boolean) => {
      if (!existsSync(file)) return [];
      const out: string[] = [];
      let skipping = false;
      for (const l of readFileSync(file, "utf8").split("\n")) {
        if (block && l.startsWith("## "))
          skipping = [...names].some((n) => l.startsWith(`## ${n} (`));
        if (skipping) continue;
        if (!block && [...names].some((n) => l.startsWith(`- ${n}: `))) continue;
        out.push(l);
      }
      return out;
    };
    writeFileSync(
      join(outDir, "harvest-report.md"),
      [
        ...keepLines(join(outDir, "harvest-report.md"), false),
        `## Harvested again ${harvested} (${only.size} merchants)`,
        "",
        ...rows.map((r) => `- ${r.name}: ${r.line}`),
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(outDir, "harvest-shapes.md"),
      [...keepLines(join(outDir, "harvest-shapes.md"), true), ...shapes.slice(2)].join("\n"),
    );
    console.log(`harvest (merged): ${menus.length} menus for ${only.size} merchants`);
    return;
  }
  writeFileSync(outFile, JSON.stringify({ harvested, menus }, null, 1) + "\n");
  lines.push(
    "# Menu harvest report (DECISIONS §39.4 source 2)",
    "",
    `Harvested ${harvested}: ${menus.length} menus from ${list.length} links (${list.filter((s) => s.skip).length} skipped by rule).`,
    "",
  );
  for (const v of [...new Set(rows.map((r) => r.village))].sort()) {
    lines.push(`## ${v}`, "");
    for (const r of rows.filter((x) => x.village === v)) lines.push(`- ${r.name}: ${r.line}`);
    lines.push("");
  }
  writeFileSync(join(outDir, "harvest-report.md"), lines.join("\n"));
  writeFileSync(join(outDir, "harvest-shapes.md"), shapes.join("\n"));
  console.log(
    `harvest: ${menus.length} menus, ${menus.reduce((n, m) => n + m.sections.reduce((k, s) => k + s.items.length, 0), 0)} items`,
  );
}

if (process.argv[1]?.endsWith("harvest.ts")) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "capture" && a) await capture(a);
  else if (cmd === "parse" && a && b) parse(a, b);
  else if (cmd === "list")
    for (const s of sources()) console.log(`${s.adapter ?? "skip"}\t${s.name}\t${s.skip ?? s.url}`);
  else {
    console.error("usage: harvest.ts capture <raw dir> | parse <raw dir> <out dir> | list");
    process.exit(2);
  }
}
