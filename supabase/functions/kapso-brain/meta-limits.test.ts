// Fails if any interactive message the bot can build exceeds WhatsApp's limits (3 buttons, 20-char button titles, 10 list rows,
// 24-char row titles, 1024-char body). Two layers: (1) every pure builder with worst-case inputs, English and Arabic;
// (2) a scan of every hard-coded title / label / header in index.ts, so a new button can't slip past the limits.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { META, checkInteractive } from "../_shared/meta-limits";
import { buildClaimCard } from "../_shared/claims";
import { buildDeliveredRatingList, buildRatingList, ratingRows } from "../_shared/lifecycle";
import { basketCardText, basketTapId } from "./basket";
import { addressRows, voiceCardText, voiceTapId } from "./smart";
import { czNext, itemPageRows, qtyRows } from "./browse";
import { buildReorderCard } from "./customer";
import { buildVendorOrderCard } from "./orders";

const LONG_EN = "Chicken shawarma sandwich with extra garlic sauce and pickles and fries on the side";
const LONG_AR = "ساندويش شاورما دجاج مع ثوم زيادة ومخلل وبطاطا مقلية على الجانب";
const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89_500).toLocaleString("en-US")} LBP`;
const expectOk = (payload: any) => expect(checkInteractive(payload), JSON.stringify(payload).slice(0, 300)).toEqual([]);
const buttons = (body: string, btns: { id: string; title: string }[]) => ({ type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: btns.map((b) => ({ type: "reply", reply: b })) } } });
const listMsg = (rows: any[]) => ({ type: "interactive", interactive: { type: "list", body: { text: "x" }, action: { button: "Choose", sections: [{ title: "Menu", rows }] } } });

describe("pure builders never exceed Meta's limits", () => {
  const lines = Array.from({ length: 30 }, (_, i) => ({ quantity: 20, name_en: `${LONG_EN} ${i}`, choices: [{ option: "Extra large with cheese" }, { option: "No onions" }] }));
  it("vendor order card (30 long lines, long name/address/notes)", () => {
    expectOk(buildVendorOrderCard("96170000001", { orderId: "11111111-1111-1111-1111-111111111111", shortCode: "AB12CD", customerName: "N".repeat(200), village: "V".repeat(100), landmark: "L".repeat(400), lines, totalText: both(149.99), notes: "n".repeat(900) }));
  });
  it("customer reorder card, both languages, 30 lines", () => {
    for (const lang of ["en", "ar"] as const) expectOk(buildReorderCard("96170000001", lang, { orderId: "11111111-1111-1111-1111-111111111111", vendorId: "v".repeat(80), vendorName: "Vendor ".repeat(40), lines: lines.map((l) => ({ quantity: l.quantity, name_en: l.name_en })) }));
  });
  it("vendor-claim card for the admin", () => {
    expectOk(buildClaimCard("96170000001", { claimId: "11111111-1111-1111-1111-111111111111", vendorName: "V".repeat(300), village: "x".repeat(100), contactName: "C".repeat(300), contactPhone: "9617000000001", evidence: "e".repeat(2000) }));
  });
  it("basket card body with 15 worst-case lines, both languages, with the three basket buttons", () => {
    const cl = Array.from({ length: 15 }, (_, i) => ({ quantity: 20, name: `${LONG_EN} ${i}`, choices: ["Extra large", "Cheese"], lineTotal: 149.99 }));
    for (const ar of [false, true]) {
      const body = basketCardText({ vendorName: "V".repeat(80), lines: ar ? cl.map((l) => ({ ...l, name: LONG_AR })) : cl, subtotal: 149.99, deliveryFee: 2, both, ar, unavailable: ["Hummus", "Fattoush", "Tabbouleh"] });
      expectOk(buttons(body, [{ id: basketTapId("CHECKOUT", "11111111-1111-1111-1111-111111111111"), title: ar ? "✅ إتمام الطلب" : "✅ Checkout" }, { id: "MENU|v", title: ar ? "➕ زيد أصناف" : "➕ Add more" }, { id: basketTapId("BCLR", "11111111-1111-1111-1111-111111111111"), title: ar ? "🗑 فضي السلة" : "🗑 Clear basket" }]));
    }
  });
  it("menu browsing: dish pages (every page of a 40-dish category), quantity picker, customization steps", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ item_id: `item-${i}`.padEnd(120, "x"), item_name_en: `${LONG_EN} ${i}`, item_name_ar: `${LONG_AR} ${i}`, price_usd: 149.99, section: "S", is_popular: i % 2 === 0 }));
    for (const ar of [false, true]) {
      for (let page = 0; page < 5; page++) expectOk(listMsg(itemPageRows(items, page, "v".repeat(60), "slug", ar, both)));
      expectOk(listMsg(qtyRows("v".repeat(60), "item".padEnd(100, "x"), LONG_EN, ar)));
      const groups = [{ name: "Size", required: true, options: Array.from({ length: 10 }, (_, k) => ({ name: `${LONG_EN} ${k}`, price_delta_usd: 1.5 })) }, { name: "Extras", required: false, options: Array.from({ length: 9 }, (_, k) => ({ name: `Extra ${k} with a long name here`, price_delta_usd: 0.5 })) }];
      for (const picks of [[], ["0.0"]]) { const st: any = czNext(groups, picks, "CZ|v|i|1|", both, ar); expect(st.kind).toBe("ask"); expectOk(listMsg(st.rows)); }
    }
  });
  it("rating list as sent (body, footer, button, section, rows)", () => {
    for (const lang of ["en", "ar"] as const) expectOk(buildRatingList("96170000001", "11111111-1111-1111-1111-111111111111", lang));
  });
  it("delivered + rating list as sent (delivery text and rating prompt in one body)", () => {
    for (const lang of ["en", "ar"] as const) expectOk(buildDeliveredRatingList("96170000001", "11111111-1111-1111-1111-111111111111", lang, { code: "AB12", vendor: "V".repeat(80) }));
  });
  it("address picker (9 saved + new) and rating list", () => {
    const saved = Array.from({ length: 12 }, (_, i) => ({ id: `id${i}`.padEnd(36, "0"), label: "L".repeat(60), village: "Baakleen", landmark: `${LONG_EN} ${i}`, last_used_at: `2026-09-${10 + i}` }));
    for (const ar of [false, true]) { expectOk(listMsg(addressRows(saved, ar, "11111111-1111-1111-1111-111111111111"))); expectOk(listMsg(ratingRows("11111111-1111-1111-1111-111111111111", ar ? "ar" : "en"))); }
  });
  it("voice confirmation card", () => {
    for (const ar of [false, true]) expectOk(buttons(voiceCardText("y".repeat(3000), ar), [{ id: voiceTapId("ok", "11111111-1111-1111-1111-111111111111"), title: ar ? "✅ أيوه" : "✅ Yes" }, { id: voiceTapId("no", "11111111-1111-1111-1111-111111111111"), title: ar ? "✏️ لا، كمان مرة" : "✏️ No, retry" }]));
  });
});

// ---- layer 2: every literal in index.ts ----
import { readdirSync } from "node:fs";
const FN = resolve(process.cwd(), "supabase/functions");
const read = (rel: string) => readFileSync(resolve(FN, rel), "utf8");
const src = read("kapso-brain/index.ts");
/** Non-test source files that can build WhatsApp messages: every kapso-brain/*.ts and _shared/*.ts (a new builder file is picked up automatically). */
const sourceFiles = [...readdirSync(resolve(FN, "kapso-brain")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `kapso-brain/${f}`), ...readdirSync(resolve(FN, "_shared")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `_shared/${f}`)];
const allSrc = sourceFiles.map((f) => ({ f, text: read(f) }));
const strLit = String.raw`"((?:[^"\\\n]|\\.)*)"`;
/** All string literals in a snippet that is a plain "x", tr(c, "en", "ar"), or `cond ? "en" : "ar"`. */
const literals = (snippet: string): string[] => [...snippet.matchAll(new RegExp(strLit, "g"))].map((m) => m[1]);
const len = (s: string) => [...s.replace(/\\n/g, "\n")].length;

/** Text between a bracket opening at `open` and its match. */
function balanced(text: string, open: number): string {
  const o = text[open], c = o === "[" ? "]" : o === "(" ? ")" : "}";
  let d = 0, inStr: string | null = null;
  for (let k = open; k < text.length; k++) {
    const ch = text[k];
    if (inStr) { if (ch === "\\") k++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === o) d++; else if (ch === c && --d === 0) return text.slice(open, k + 1);
  }
  return text.slice(open);
}

// NOTE: this scan is best-effort source analysis (plain strings, tr(c, "en", "ar") and `cond ? "en" : "ar"` literals). Titles built dynamically
// (template literals, variables) are covered by the worst-case builder tests above and, as a last line of defence, by clampInteractive at send time.
describe("hard-coded WhatsApp titles in every message-building source file", () => {
  // `title: <literal-ish>` inside a `buttons: [...]` array → button title (20). Everywhere else a literal title is a row / section title (24).
  const buttonTitles: string[] = [];
  for (const { text } of allSrc) for (const m of text.matchAll(/buttons:\s*\[/g)) {
    const arr = balanced(text, m.index! + m[0].length - 1);
    for (const t of arr.matchAll(/title:\s*(tr\(c,\s*(?:"(?:[^"\\\n]|\\.)*")\s*,\s*(?:"(?:[^"\\\n]|\\.)*")\s*\)|"(?:[^"\\\n]|\\.)*"|[a-z]+\s*\?\s*"(?:[^"\\\n]|\\.)*"\s*:\s*"(?:[^"\\\n]|\\.)*")/g)) buttonTitles.push(...literals(t[1]));
  }
  it("found the button titles it should be checking", () => expect(buttonTitles.length).toBeGreaterThan(30));
  it("every hard-coded button title is at most 20 characters", () => {
    const bad = buttonTitles.filter((t) => len(t) > META.buttonTitle).map((t) => `"${t}" (${len(t)})`);
    expect(bad).toEqual([]);
  });

  const labelBad: string[] = [];
  for (const { text } of allSrc) for (const m of text.matchAll(/\b(button|header|headerText):\s*(tr\(c,\s*"(?:[^"\\\n]|\\.)*"\s*,\s*"(?:[^"\\\n]|\\.)*"\s*\)|"(?:[^"\\\n]|\\.)*")/g)) {
    const cap = m[1] === "button" ? META.listButton : META.header;
    for (const t of literals(m[2])) if (len(t) > cap) labelBad.push(`${m[1]}: "${t}" (${len(t)} > ${cap})`);
  }
  it("list button labels (<=20) and headers (<=60) fit", () => expect(labelBad).toEqual([]));

  const rowBad: string[] = [];
  for (const { text } of allSrc) for (const m of text.matchAll(/\{\s*id:\s*[^{}]*?title:\s*(tr\(c,\s*"(?:[^"\\\n]|\\.)*"\s*,\s*"(?:[^"\\\n]|\\.)*"\s*\)|"(?:[^"\\\n]|\\.)*")/g)) for (const t of literals(m[1])) if (len(t) > META.rowTitle) rowBad.push(`"${t}" (${len(t)})`);
  it("hard-coded row titles fit in 24 characters", () => expect(rowBad).toEqual([]));

  const sectionBad: string[] = [];
  for (const { text } of allSrc) for (const m of text.matchAll(/sections:\s*\[\{\s*title:\s*(tr\(c,\s*"(?:[^"\\\n]|\\.)*"\s*,\s*"(?:[^"\\\n]|\\.)*"\s*\)|"(?:[^"\\\n]|\\.)*")/g)) for (const t of literals(m[1])) if (len(t) > META.sectionTitle) sectionBad.push(`"${t}" (${len(t)})`);
  it("hard-coded list section titles fit in 24 characters", () => expect(sectionBad).toEqual([]));

  it("the senders clip with the shared META limits, never private numbers", () => {
    expect(src).toContain("clip(b.title, META.buttonTitle)");
    expect(src).toContain("o.buttons.slice(0, META.maxButtons)");
    expect(src).toContain("clip(r.title, META.rowTitle)");
    expect(src).toContain("rows.slice(0, rowsLeft)"); // 10 rows in total across sections
    expect(src).toContain("clip(ensureDualCurrency(o.body, LBP_RATE), META.body)");
  });
  it("every outgoing payload goes through clampInteractive, including the cards built inline by the sweep", () => {
    expect([...src.matchAll(/payload = clampInteractive\(payload\);/g)].length).toBe(2); // rawSend and rawSendId
    expect(src.indexOf("payload = clampInteractive(payload)")).toBeLessThan(src.indexOf("if (dry) { out?.push(payload)")); // dry runs show exactly what would be sent
    // the only direct fetches to the Kapso messages endpoint are inside those two functions
    // plus exactly one more: the read receipt / typing indicator (a status payload with no interactive content, built by buildReadReceipt)
    expect([...src.matchAll(/\/messages`/g)].length).toBe(3);
    expect(src).toMatch(/buildReadReceipt\(e\.id, ack\.typing\)[\s\S]{0,400}\/messages`/);
    const notify = readFileSync(resolve(process.cwd(), "supabase/functions/order-notify/index.ts"), "utf8");
    expect(notify).toContain("clampInteractive(payload)");
  });
});

describe("every function that posts to the Kapso messages API clamps interactive payloads", () => {
  const dirs = readdirSync(FN, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "node_modules").map((d) => d.name);
  const files = dirs.flatMap((d) => readdirSync(resolve(FN, d)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `${d}/${f}`));
  it("found the functions it should be checking", () => expect(files).toEqual(expect.arrayContaining(["kapso-brain/index.ts", "order-notify/index.ts", "claim-vendor/index.ts"])));
  it.each(files.filter((f) => /api\.kapso\.ai\/meta\/whatsapp/.test(read(f))))("%s", (f) => {
    const text = read(f);
    const interactive = /type: "interactive"|buildClaimCard|buildRatingList|buildDeliveredRatingList|buildVendorOrderCard|buildReorderCard/.test(text) || /notifyOrderStatus/.test(text);
    if (interactive) expect(text, `${f} sends interactive messages without clampInteractive`).toContain("clampInteractive(");
  });
});

describe("item 3 ask card (orderparse.buildAskCard)", () => {
  it("fits WhatsApp's reply-button limits for long names, both languages", async () => {
    const { buildAskCard } = await import("./orderparse.ts");
    for (const ar of [false, true]) {
      const c = buildAskCard({ query: "q".repeat(200), quantity: 20, added: Array.from({ length: 10 }, (_, i) => `${i}× A fairly long dish name ${i}`), failed: ["Something"], ar, options: Array.from({ length: 5 }, (_, i) => ({ vendor_id: "v".repeat(60), item_id: `i${i}`.repeat(30), name: "N".repeat(80) })) });
      expect(c.buttons.length).toBeLessThanOrEqual(META.maxButtons);
      for (const b of c.buttons) { expect(b.title.length).toBeLessThanOrEqual(META.buttonTitle); expect(b.id.length).toBeLessThanOrEqual(META.buttonId); }
      expect(c.body.length).toBeLessThanOrEqual(META.body);
    }
  });
});

describe("item 4 numbered page (numbered.buildNumberedPage)", () => {
  it("every page of a long menu fits the 1024 body limit in both languages, and shows dual-currency prices", async () => {
    const { buildNumberedPage, orderForList } = await import("./numbered.ts");
    const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89500).toLocaleString("en-US")} LBP`;
    const items = orderForList(Array.from({ length: 80 }, (_, i) => ({ item_id: `i${i}`, item_name_en: "Extra Large Mixed Grill Platter with Rice and Garlic Sauce " + i, item_name_ar: "مشاوي مشكلة كبيرة مع رز وثوم " + i, price_usd: 3 + i / 7, is_popular: i % 3 === 0, sort_order: i, customizations: [] })));
    const plain = orderForList(Array.from({ length: 80 }, (_, i) => ({ item_id: `n${i}`, item_name_en: "Extra Large Mixed Grill Platter with Rice and Garlic Sauce " + i, item_name_ar: "مشاوي مشكلة كبيرة مع رز وثوم " + i, price_usd: 3 + i / 7, sort_order: i, customizations: [] })), "late");
    for (const ar of [false, true]) for (let p = 0; p < 10; p++) { const r = buildNumberedPage({ vendorName: "Shawarma King", items: plain, page: p, ar, daypart: "late", both }); expect(r.body.length).toBeLessThanOrEqual(META.body); } // the longest title ("Suggested for late night") with the legend
    for (const ar of [false, true]) for (let p = 0; p < 10; p++) { const r = buildNumberedPage({ vendorName: "Shawarma King", items, page: p, ar, both }); expect(r.body.length).toBeLessThanOrEqual(META.body); for (const l of r.body.split("\n").filter((x) => /^\d+\. /.test(x))) expect(l).toMatch(/LBP$/); }
  });
});

describe("item 5 basket edit (basketedit.editListRows / lineButtons)", () => {
  it("the edit list and the line buttons fit WhatsApp's limits in both languages", async () => {
    const { editListRows, lineButtons } = await import("./basketedit.ts");
    const lines = Array.from({ length: 15 }, (_, i) => ({ id: "11111111-2222-3333-4444-" + String(i).padStart(12, "0"), name_en: "A very long dish name with extras number " + i, name_ar: "صنف طويل جدا مع اضافات رقم " + i, quantity: i + 1 }));
    for (const ar of [false, true]) {
      const rows = editListRows("11111111-2222-3333-4444-555555555555", lines, ar);
      expect(rows.length).toBeLessThanOrEqual(META.listRows);
      for (const r of rows) { expect(r.title.length).toBeLessThanOrEqual(META.rowTitle); expect((r.description ?? "").length).toBeLessThanOrEqual(META.rowDescription); expect(r.id.length).toBeLessThanOrEqual(META.rowId); }
      for (const q of [1, 2, 19, 20]) { const b = lineButtons({ id: lines[0].id, quantity: q }, ar); expect(b.length).toBeLessThanOrEqual(META.maxButtons); for (const x of b) { expect(x.title.length).toBeLessThanOrEqual(META.buttonTitle); expect(x.id.length).toBeLessThanOrEqual(META.buttonId); } }
    }
  });
});

describe("item 6 search-first list (searchfirst.buildSearchRows)", () => {
  it("rows fit WhatsApp's list limits in both languages and always show dual-currency prices", async () => {
    const { buildSearchRows } = await import("./searchfirst.ts");
    const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89500).toLocaleString("en-US")} LBP`;
    const hits = Array.from({ length: 40 }, (_, i) => ({ item_id: "item-" + "x".repeat(150) + i, vendor_id: "vendor-" + (i % 9), vendor_name: "A Restaurant With A Rather Long Name Number " + i, name_en: "A fairly long dish name that needs clipping " + i, name_ar: "صنف طويل جدا يحتاج اختصار رقم " + i, price_usd: 3.5 + i / 3, score: 1, is_popular: false, km: i / 2, exact: true }));
    for (const ar of [false, true]) {
      const rows = buildSearchRows(hits, ar, both);
      expect(rows.length).toBeLessThanOrEqual(META.listRows);
      for (const r of rows) { expect(r.title.length).toBeLessThanOrEqual(META.rowTitle); expect(r.description.length).toBeLessThanOrEqual(META.rowDescription); expect(r.id.length).toBeLessThanOrEqual(META.rowId); expect(r.description).toMatch(/LBP$/); }
    }
  });
});

describe("P1-5 re-ask card (ambiguity.reAskCard)", () => {
  it("two buttons with worst-case option names, both languages", async () => {
    const { reAskCard } = await import("./ambiguity.ts");
    for (const ar of [false, true]) { const c = reAskCard([LONG_EN, LONG_AR], ar); expectOk(buttons(c.body, c.buttons)); expect(c.buttons).toHaveLength(2); }
  });
});
