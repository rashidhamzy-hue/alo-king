// CAT2: every interactive type the gateway sends, against the shapes Kapso's OpenAPI states (api/meta/whatsapp/openapi-whatsapp.yaml,
// InteractiveMessage and its examples interactive_button, interactive_cta_url, interactive_location_request_message, interactive_product,
// interactive_product_list, interactive_catalog_message). A builder that makes a shape Kapso refuses fails here, in CI, before a customer
// meets silence. And the gateway's fallback: a refused interactive message is never the end of a reply.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { askLocation, buttons, ctaUrl, list, type Outbound } from "../src/kapso";
import { checkInteractive, cutChars, INTERACTIVE_TYPES, plainOf } from "../src/contract";
import { preflight, send, type SendRequest } from "../src/gateway";
import { catalogMessage, productListMessages, productMessage } from "../../agents/src/catalog-messages";

vi.mock("@sentry/cloudflare", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

/** Kapso's own examples, as its OpenAPI gives them (the bodies only). Each must pass our check: if it did not, our check is wrong. */
const KAPSO_EXAMPLES: Record<(typeof INTERACTIVE_TYPES)[number], Outbound> = {
  button: { type: "interactive", interactive: { type: "button", body: { text: "Would you like to proceed with your order?" },
    action: { buttons: [{ type: "reply", reply: { id: "btn_yes", title: "Yes" } }, { type: "reply", reply: { id: "btn_no", title: "No" } }] } } },
  list: { type: "interactive", interactive: { type: "list", body: { text: "Please select an option" },
    action: { button: "View Options", sections: [{ title: "Popular Items", rows: [{ id: "row_1", title: "Option 1", description: "This is option 1" }] }] } } },
  cta_url: { type: "interactive", interactive: { type: "cta_url", header: { type: "text", text: "New workshop dates announced!" },
    body: { text: "Tap the button below to see available dates." }, footer: { text: "Dates subject to change" },
    action: { name: "cta_url", parameters: { display_text: "See Dates", url: "https://example.com/workshops?utm_source=whatsapp" } } } },
  catalog_message: { type: "interactive", interactive: { type: "catalog_message", body: { text: "Browse our catalog on WhatsApp." },
    action: { name: "catalog_message", parameters: { thumbnail_product_retailer_id: "SKU_THUMBNAIL" } } } },
  product: { type: "interactive", interactive: { type: "product", body: { text: "Optional body text" }, action: { catalog_id: "CATALOG_ID", product_retailer_id: "SKU_1234" } } },
  product_list: { type: "interactive", interactive: { type: "product_list", header: { type: "text", text: "Our bestsellers" }, body: { text: "Choose a product" },
    footer: { text: "While supplies last" }, action: { catalog_id: "CATALOG_ID", sections: [{ title: "Popular", product_items: [{ product_retailer_id: "SKU_1234" }, { product_retailer_id: "SKU_2345" }] }] } } },
  location_request_message: { type: "interactive", interactive: { type: "location_request_message",
    body: { text: "Please share your location so we can provide accurate delivery estimates." }, action: { name: "send_location" } } },
};

/** What our builders make for each type (the words are ours, in Arabic, with emoji, at their limits). */
const OURS: Record<(typeof INTERACTIVE_TYPES)[number], Outbound[]> = {
  button: [buttons("🛒 *تأكيد الطلب؟*", [{ id: "o:confirm:123", title: "✅ تأكيد الطلب" }, { id: "o:edit:123", title: "✏️ تعديل" }, { id: "o:cancel:123", title: "❌ إلغاء الطلب كليًا يا جماعة 🙏" }])],
  list: [list("🔎 *أيا وحدة؟*", "اختار من هون يا صديقي 👇", Array.from({ length: 12 }, (_, i) => ({ id: `pick:${i}`, title: `لبنة ${i} 🧀 كيلو كامل طازة من الضيعة`, description: "$3.50 · ".repeat(20) })))],
  cta_url: [ctaUrl("🛒 *كتالوج ألو كينغ بالصور*", "افتح الكتالوج من هون يا صاحبي", "https://wa.me/c/12036602328")],
  catalog_message: [catalogMessage("🛒 *كتالوج ألو كينغ بالصور*\nاكبس الزر تحت لتشوفو.", "AK-0103")],
  product: [productMessage("1178584524839853", "AK-0103", "زيدو عالسلة"), productMessage("1178584524839853", "AK-0103")],
  product_list: productListMessages("1178584524839853", "الألبان والبيض", "🛒 *الألبان والبيض*",
    [{ title: "لبنة ولبن وأجبان بيضا من كل الأنواع", skus: Array.from({ length: 45 }, (_, i) => `AK-${1000 + i}`) }, { title: "بيض", skus: ["AK-0049"] }]),
  location_request_message: [askLocation("📍 ابعتلنا موقعك")],
};

describe("Kapso's shapes (OpenAPI, read 24 Nov 2026), one per interactive type we send", () => {
  it.each(INTERACTIVE_TYPES.map((t) => [t]))("%s: Kapso's own example passes the check", (t) => {
    expect(checkInteractive(KAPSO_EXAMPLES[t])).toBeNull();
  });
  it.each(INTERACTIVE_TYPES.map((t) => [t]))("%s: what our builder makes passes the check and keeps Kapso's keys", (t) => {
    for (const msg of OURS[t]) {
      expect(checkInteractive(msg)).toBeNull();
      const ours = (msg as any).interactive, theirs = (KAPSO_EXAMPLES[t] as any).interactive;
      expect(ours.type).toBe(theirs.type);
      expect(Object.keys(ours.action).sort()).toEqual(Object.keys(theirs.action).sort());
      if (theirs.action.parameters) expect(Object.keys(ours.action.parameters).sort()).toEqual(Object.keys(theirs.action.parameters).sort());
    }
  });
  it("the catalogue message of 23 and 24 November (no action.parameters) is refused before Kapso, as Kapso refused it (422)", () => {
    const sent = { type: "interactive", interactive: { type: "catalog_message",
      body: { text: "🛒 *كتالوج ألو كينغ بالصور*\nاكبس الزر تحت لتشوفو، أو اكتب «الكتالوج» بأي وقت." }, action: { name: "catalog_message" } } } as Outbound;
    expect(checkInteractive(sent)).toBe("catalog_thumbnail");
  });
  it("refuses the shapes Kapso or Meta refuse", () => {
    const bad: [string, Outbound][] = [
      ["type_carousel", { type: "interactive", interactive: { type: "carousel", action: { cards: [] } } }],
      ["buttons_count", { type: "interactive", interactive: { type: "button", body: { text: "x" }, action: { buttons: [] } } }],
      ["button_shape", { type: "interactive", interactive: { type: "button", body: { text: "x" }, action: { buttons: [{ type: "reply", reply: { id: "a", title: "x".repeat(21) } }] } } }],
      ["button_id_twice", { type: "interactive", interactive: { type: "button", body: { text: "x" }, action: { buttons: [{ type: "reply", reply: { id: "a", title: "1" } }, { type: "reply", reply: { id: "a", title: "2" } }] } } }],
      ["list_rows_count", { type: "interactive", interactive: { type: "list", body: { text: "x" }, action: { button: "b", sections: [{ title: "s", rows: Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: "t" })) }] } } }],
      ["list_row_description", { type: "interactive", interactive: { type: "list", body: { text: "x" }, action: { button: "b", sections: [{ title: "s", rows: [{ id: "r", title: "t", description: "d".repeat(73) }] }] } } }],
      ["cta_url", { type: "interactive", interactive: { type: "cta_url", body: { text: "x" }, action: { name: "cta_url", parameters: { display_text: "Open", url: "http://insecure.test" } } } }],
      ["product_list_header", { type: "interactive", interactive: { type: "product_list", body: { text: "x" }, action: { catalog_id: "c", sections: [{ title: "s", product_items: [{ product_retailer_id: "a" }] }] } } }],
      ["location_request_name", { type: "interactive", interactive: { type: "location_request_message", body: { text: "x" }, action: {} } }],
      ["body_text", { type: "interactive", interactive: { type: "button", body: { text: "" }, action: { buttons: [{ type: "reply", reply: { id: "a", title: "b" } }] } } }],
    ];
    for (const [why, msg] of bad) expect([why, checkInteractive(msg)]).toEqual([why, why]);
  });
  it("cuts by characters, never half an emoji (a lone surrogate is an invalid payload)", () => {
    const title = "x".repeat(19) + "🙏";                                  // 21 UTF-16 units, 20 characters
    expect(cutChars(title, 20)).toBe(title);
    expect(cutChars("x".repeat(20) + "🙏", 20)).toBe("x".repeat(20));
    const b = buttons("x", [{ id: "a", title: "x".repeat(19) + "🙏🙏" }]) as any;
    expect(b.interactive.action.buttons[0].reply.title).toBe("x".repeat(19) + "🙏");
    expect(b.interactive.action.buttons[0].reply.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it("the gateway's preflight runs the same check: a refused shape never reaches Kapso", () => {
    const req: SendRequest = { line: "customer", partyId: "p", to: "x", category: "service", dedupeKey: "k:1",
      msg: { type: "interactive", interactive: { type: "catalog_message", body: { text: "x" }, action: { name: "catalog_message" } } } };
    expect(preflight(req)).toBe("shape_catalog_thumbnail");
    expect(preflight({ ...req, msg: KAPSO_EXAMPLES.catalog_message })).toBeNull();
  });
  it("plain text of each kind keeps the words and the choices", () => {
    expect(plainOf(OURS.button[0]!)).toBe("🛒 *تأكيد الطلب؟*\n\n▫️ ✅ تأكيد الطلب\n▫️ ✏️ تعديل\n▫️ " + cutChars("❌ إلغاء الطلب كليًا يا جماعة 🙏", 20).trimEnd());
    expect(plainOf(OURS.cta_url[0]!)).toContain("https://wa.me/c/12036602328");
    expect(plainOf({ type: "text", text: { body: "x" } })).toBeNull();
  });
});

// ---------- the gateway: a refused interactive message is replaced, through the same door ----------
const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_C", PHONE_NUMBER_ID_OPS: "PN_O" };
function fakeDb(gate = "ok") {
  const calls: { fn: string; args?: any }[] = [];
  return { calls, rpc: async (fn: string, args?: unknown) => { calls.push({ fn, args }); return { data: fn === "can_send" ? gate : fn === "outbox_claim" ? true : null, error: null }; },
    from: () => ({ insert: async (row: unknown) => { calls.push({ fn: "insert", args: row }); return { error: null }; } }) } as any;
}
const invalid = () => new Response(JSON.stringify({ error: "Invalid message payload" }), { status: 422, headers: { "content-type": "application/json" } });
const okRes = (id: string) => new Response(JSON.stringify({ messages: [{ id }] }), { status: 200, headers: { "content-type": "application/json" } });
/** Kapso stand-in: refuses the payloads `no` names; records every payload it was given, in order. */
function kapso(no: (body: any) => boolean) {
  const seen: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => { const b = JSON.parse(String(init?.body)); seen.push(b); return no(b) ? invalid() : okRes(`wamid.${seen.length}`); }));
  return seen;
}
const catalogReq = (fallback?: SendRequest["fallback"]): SendRequest => ({ line: "customer", partyId: "p1", to: "+9613000000", category: "service", dedupeKey: "turn-1:hcat",
  msg: catalogMessage("🛒 *كتالوج ألو كينغ بالصور*\nاكبس الزر تحت لتشوفو.", "AK-0103"), ...(fallback ? { fallback } : {}) });
const LINK = { text: "🛒 *كتالوج ألو كينغ بالصور*\nافتحو من هالرابط.", link: { label: "افتح الكتالوج", url: "https://wa.me/c/12036602328" } };

describe("CAT2: the gateway never ends a reply in silence", () => {
  it("Kapso refuses the catalogue (422): Sentry hears reply_refused with Kapso's error, and the link goes as a cta_url button", async () => {
    const seen = kapso((b) => b.interactive?.type === "catalog_message");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb();
    const r = await send(db, env, catalogReq(LINK));
    quiet.mockRestore();
    expect(r).toEqual({ ok: true, wamid: "wamid.2" });
    expect(seen.map((b) => b.interactive?.type ?? b.type)).toEqual(["catalog_message", "cta_url"]);
    expect(seen[1].interactive.action).toEqual({ name: "cta_url", parameters: { display_text: "افتح الكتالوج", url: "https://wa.me/c/12036602328" } });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = (Sentry.captureMessage as any).mock.calls[0];
    expect(msg).toBe("reply_refused");
    expect(ctx.tags).toMatchObject({ interactive: "catalog_message", reason: expect.stringMatching(/^kapso_/) });
    expect(ctx.extra.kapso).toMatch(/422/);
    expect(JSON.stringify(ctx)).not.toMatch(/9613000000|اكبس/);                              // no number, no words
    // the refusal is recorded, and the replacement was claimed under its own stable key
    expect(db.calls.filter((c: any) => c.fn === "outbox_claim").map((c: any) => c.args.p_key)).toEqual(["turn-1:hcat", "turn-1:hcat:alt0"]);
    expect(db.calls.some((c: any) => c.fn === "insert" && c.args.outcome === "refused")).toBe(true);
  });
  it("the button refused too: the words and the link as text", async () => {
    const seen = kapso((b) => b.type === "interactive");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send(fakeDb(), env, catalogReq(LINK))).ok).toBe(true);
    quiet.mockRestore();
    expect(seen.map((b) => b.interactive?.type ?? b.type)).toEqual(["catalog_message", "cta_url", "text"]);
    expect(seen[2].text.body).toBe(`${LINK.text}\nhttps://wa.me/c/12036602328`);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);                                     // one alarm per refused reply, not per try
  });
  it("buttons with no caller words: the gateway's own text, the choices one per line", async () => {
    const seen = kapso((b) => b.type === "interactive");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await send(fakeDb(), env, { line: "customer", partyId: "p1", to: "x", category: "service", dedupeKey: "turn-2:h1",
      msg: buttons("قصدك Safa Chicken؟", [{ id: "y", title: "إيه" }, { id: "n", title: "لا" }]) });
    quiet.mockRestore();
    expect(r.ok).toBe(true);
    expect(seen.at(-1)).toMatchObject({ type: "text", text: { body: "قصدك Safa Chicken؟\n\n▫️ إيه\n▫️ لا" } });
  });
  it("a shape our check refuses never reaches Kapso; the text does", async () => {
    const seen = kapso(() => false);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await send(fakeDb(), env, { ...catalogReq(LINK), msg: { type: "interactive", interactive: { type: "catalog_message", body: { text: "x" }, action: { name: "catalog_message" } } } });
    quiet.mockRestore();
    expect(r.ok).toBe(true);
    expect(seen.map((b) => b.interactive?.type ?? b.type)).toEqual(["cta_url"]);
    expect((Sentry.captureMessage as any).mock.calls[0][1].tags.reason).toBe("shape_catalog_thumbnail");
  });
  it("STOP, the window or the gate: no replacement (a refusal by can_send is not a refused shape)", async () => {
    const seen = kapso(() => false);
    expect(await send(fakeDb("opted_out"), env, catalogReq(LINK))).toEqual({ ok: false, refused: "opted_out" });
    expect(seen).toEqual([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
  it("outside the 24-hour window (Kapso's 422, Meta's 131047): nothing is replaced and no alarm (catalog-check run 45343575813)", async () => {
    const seen: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => { seen.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: "Cannot send non-template messages outside the 24-hour window." }), { status: 422, headers: { "content-type": "application/json" } }); }));
    const r = await send(fakeDb(), env, catalogReq(LINK));
    expect(r.ok).toBe(false);
    expect(seen.map((b) => b.interactive?.type ?? b.type)).toEqual(["catalog_message"]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
  it("a refused text is not replaced (nothing simpler to send) and a refused replacement is not replaced again", async () => {
    const seen = kapso(() => true);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send(fakeDb(), env, { line: "customer", partyId: "p1", to: "x", category: "service", dedupeKey: "t:3", msg: { type: "text", text: { body: "x" } } })).ok).toBe(false);
    expect((await send(fakeDb(), env, catalogReq(LINK))).ok).toBe(false);
    quiet.mockRestore();
    expect(seen.map((b) => b.interactive?.type ?? b.type)).toEqual(["text", "catalog_message", "cta_url", "text"]);
  });
});
