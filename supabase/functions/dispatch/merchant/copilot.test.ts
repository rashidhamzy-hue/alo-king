// The merchant copilot on the Merchant number (DECISIONS §39.7): rules and recorded model answers become proposals the
// merchant confirms with a tap; reports, staff and memory only read. The database is a fake RPC layer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { runDispatch, copilotDoneText, type DispatchDeps, type SendResult } from "../handler";
import { checkInteractive } from "../../_shared/meta-limits";
import { memoryText, reportText, writesIn } from "./copilot";
import { toolToCommand } from "./copilot-model";
import { isMedicineRequest } from "../customer/intents";
import { parseMerchantCommand } from "../../_shared/merchant-commands";
import {
  firstLink,
  htmlText,
  linkAllowed,
  privateAddress,
  safeFetch,
} from "../../_shared/safe-fetch";

const MEMBER = "99999999-2222-3333-4444-555555555555";
const VENDOR = "20000000-0000-0000-0000-00000000000a";
const PROP = "77777777-2222-3333-4444-555555555555";
const SECTION = "58000000-0000-0000-0000-0000000000a1";
const NOW = new Date("2026-10-11T12:00:00Z"); // 15:00 in Beirut
const LONG = "منقوشة كشك مع جبنة وبندورة ونعنع وزيتون وبصل وكتير أغراض تانية ".repeat(3).trim();

function harness(rpcs: Record<string, (a: any) => any> = {}, extra: Partial<DispatchDeps> = {}) {
  const calls: { fn: string; args: any }[] = [];
  let events: any[] = [];
  const replies: any[] = [];
  const rpc = async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (rpcs[fn]) return rpcs[fn](args);
    switch (fn) {
      case "webhook_claim": {
        const e = events;
        events = [];
        return e;
      }
      case "outbox_claim":
        return replies.splice(0).map((r, k) => ({
          id: 1000 + k,
          order_id: null,
          vendor_id: null,
          channel: "whatsapp",
          purpose: "reply",
          target: r.p_to,
          payload: r.p_payload,
          attempts: 1,
          card: null,
        }));
      case "app_reply":
        replies.push(args);
        return 1;
      case "merchant_members_by_phone":
        return [{ member_id: MEMBER, vendor_id: VENDOR, role: "owner", vendor_name: "A" }];
      case "merchant_member_for":
        return MEMBER;
      case "whatsapp_sender":
        return "PNID-M";
      case "merchant_proposal_create":
        return PROP;
      case "ai_quota_take":
        return { ok: true, call_id: 41 };
      case "merchant_menu_parts":
        return {
          sections: [{ section_id: SECTION, name_en: "Sandwiches", name_ar: "سندويشات", items: 4 }],
        };
      case "menu_item_match":
        return /knefe|كنافه|الكنافة/.test(args.p_query)
          ? [{ item_id: "it-knefe", name: "كنافة", score: 0.9 }]
          : /long/.test(args.p_query)
            ? [{ item_id: "it-long", name: LONG, score: 0.9 }]
            : [];
      default:
        return null;
    }
  };
  const sent: any[] = [];
  const d: DispatchDeps = {
    rpc,
    whatsapp: async (_from, payload): Promise<SendResult> => {
      sent.push(payload);
      return { ok: true, id: `wamid.${sent.length}` };
    },
    call: null,

    now: () => NOW,
    budgetMs: 60_000,
    ...extra,
  };
  const say = async (msg: any) => {
    events = [
      {
        msg_id: 1,
        event_id: 7,
        event_type: "whatsapp.message.received",
        phone_number_id: "PNID-M",
        payload: {
          message: { id: "wamid.in", kapso: { direction: "inbound" }, ...msg },
          conversation: { phone_number: "+96171000001" },
        },
      },
    ];
    await runDispatch(d);
  };
  return {
    text: (body: string) => say({ type: "text", text: { body } }),
    tap: (id: string) =>
      say({
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id, title: "x" } },
      }),
    photo: (caption: string | null, mime = "image/jpeg") =>
      say({
        type: "image",
        image: { id: "MEDIA-P1", mime_type: mime, ...(caption === null ? {} : { caption }) },
      }),
    sent,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
    proposal: () => calls.filter((c) => c.fn === "merchant_proposal_create").map((c) => c.args)[0],
    body: (k = 0) => sent[k]?.text?.body ?? sent[k]?.interactive?.body?.text ?? "",
  };
}

describe("availability (§38.3 'fryer off 15 min')", () => {
  it("a station off for a while is a proposal with its end time; nothing is applied", async () => {
    const h = harness();
    await h.text("fryer off 15 min");
    expect(h.proposal()).toMatchObject({
      p_kind: "availability_off",
      p_payload: { scope: "station", target: "fryer", until: "2026-10-11T12:15:00.000Z" },
      p_member_id: MEMBER,
    });
    expect(h.body()).toMatch(/Back on its own at 15:15/);
    expect(h.sent[0].interactive.action.buttons[0].reply.id).toBe(`pyes:${PROP}`);
    expect(h.of("merchant_proposal_decide")).toHaveLength(0);
  });
  it("a section by name, an item by the menu match, and a station back on", async () => {
    const a = harness();
    await a.text("sandwiches off 1h");
    expect(a.proposal().p_payload).toMatchObject({ scope: "section", target: SECTION });
    const b = harness();
    await b.text("knefe off till 6");
    expect(b.proposal().p_payload).toMatchObject({
      scope: "item",
      target: "it-knefe",
      until: "2026-10-11T15:00:00.000Z",
    });
    const c = harness();
    await c.text("الفراية رجعت");
    expect(c.proposal()).toMatchObject({
      p_kind: "availability_on",
      p_payload: { scope: "station", target: "fryer" },
    });
  });
  it("an unknown target is asked about, not guessed", async () => {
    const h = harness();
    await h.text("shawarma off 20 min");
    expect(h.of("merchant_proposal_create")).toHaveLength(0);
    expect(h.body()).toMatch(/isn't on your menu/);
  });
  it("the tap applies it and says when it comes back", async () => {
    const h = harness({
      merchant_proposal_decide: () => ({
        status: "confirmed",
        kind: "availability_off",
        hidden: 3,
        until: "2026-10-11T12:15:00Z",
      }),
    });
    await h.tap(`pyes:${PROP}`);
    expect(h.of("merchant_proposal_decide")[0].args).toMatchObject({
      p_confirm: true,
      p_member_id: MEMBER,
    });
    expect(h.body()).toMatch(/3 items off until 15:15; they come back on their own/);
  });
});

describe("items, offers, hours and money: each a proposal", () => {
  it.each([
    ["stock knefe 20", "stock_set", { item_id: "it-knefe", quantity: 20 }],
    [
      "add item falafel wrap 4.5 in sandwiches",
      "item_add",
      { name: "falafel wrap", price_usd: 4.5, section: "sandwiches" },
    ],
    [
      "rename knefe to knefe bi jebne",
      "item_edit",
      { item_id: "it-knefe", name: "knefe bi jebne" },
    ],
    ["remove item knefe", "item_remove", { item_id: "it-knefe" }],
    [
      "offer 10% on sandwiches 3 days",
      "offer_create",
      { kind: "percent", percent: 10, days: 3, section_id: SECTION },
    ],
    ["first order 15%", "offer_create", { kind: "first_order", percent: 15, days: 30 }],
    [
      "happy hour 20% 3pm-6pm on knefe",
      "offer_create",
      { kind: "happy_hour", from: "15:00", to: "18:00", item_ids: ["it-knefe"] },
    ],
    ["stop offer", "offer_stop", {}],
    ["closed tomorrow", "closure", { day: "2026-10-12" }],
    [
      "hours mon-fri 9-23",
      "hours_set",
      { weekdays: [1, 2, 3, 4, 5], opens: "09:00", closes: "23:00" },
    ],
    ["closed every sunday", "hours_set", { weekdays: [0], closed: true }],
    ["min order 10", "min_order", { usd: 10 }],
    ["no minimum", "min_order", { usd: null }],
    ["radius 3 km", "radius", { km: 3 }],
    ["boost 20 nearby", "boost_start", { budget_usd: 20, audience: "nearby" }],
    ["stop boost", "boost_stop", {}],
    ["price knefe 3.5", "price", { item_id: "it-knefe", price_usd: 3.5 }],
  ])("%s → %s", async (text, kind, payload) => {
    const h = harness();
    await h.text(text);
    expect(h.proposal()).toMatchObject({ p_kind: kind, p_payload: payload });
    expect(h.of("merchant_proposal_decide")).toHaveLength(0);
    expect(checkInteractive(h.sent[0])).toEqual([]);
  });
  it("Boost says nothing is charged until sponsored placement starts", async () => {
    const h = harness();
    await h.text("boost 30 past customers");
    expect(h.body()).toMatch(/Nothing is charged until sponsored placement starts/);
  });
  it("the server's refusal is said, nothing changes", async () => {
    const h = harness({
      merchant_proposal_create: () => {
        throw new Error("check_violation: a closure is a day in the next 60 days");
      },
    });
    await h.text("closed 1/1");
    expect(h.body()).toMatch(/Not possible as asked/);
  });
  it("cards with very long item names stay within WhatsApp's limits", async () => {
    for (const t of [
      "remove item long",
      "stock long 5",
      "long off 30 min",
      "free long with 2 long",
    ]) {
      const h = harness();
      await h.text(t);
      for (const p of h.sent) expect(checkInteractive(p), t).toEqual([]);
    }
  });
});

describe("reports, staff and memory only read", () => {
  it("the day report is text from the server's numbers", async () => {
    const h = harness({
      merchant_report: () => ({
        period: "day",
        orders: 12,
        delivered: 10,
        rejected: 1,
        cancelled: 1,
        food_sales_usd: 143.5,
        offers_usd: 4,
        order_fees_usd: 7.2,
        acceptance_median_s: 48,
        rating_avg: 4.6,
        ratings: 7,
        top_items: [{ name: "شاورما", quantity: 9 }],
      }),
    });
    await h.text("report");
    expect(h.of("merchant_proposal_create")).toHaveLength(0);
    expect(h.body()).toMatch(
      /orders: 12[\s\S]*\$143\.50 \(عروض \/ offers −\$4\.00\)[\s\S]*48 s[\s\S]*شاورما ×9/,
    );
  });
  it("staff and memory; a cashier is told reports are for the owner", async () => {
    const h = harness({
      vendor_staff_list: () => [{ name: "Ali", role: "kitchen", phone: "+9613123456" }],
    });
    await h.text("staff");
    expect(h.body()).toMatch(/Ali · kitchen · \+9613123456/);
    const m = harness({
      merchant_memory: () => ({
        facts: { writes_in: { value: "arabizi" }, recent_changes: { value: [{ kind: "price" }] } },
        sellout_names: ["كنافة"],
        parts: { min_order_usd: 10, radius_km: 3, offers: [], holds: [] },
      }),
    });
    await m.text("شو بتتذكر");
    expect(m.body()).toMatch(
      /arabizi[\s\S]*كنافة[\s\S]*\$10\.00[\s\S]*3 km[\s\S]*every change waits for your tap/,
    );
    const c = harness({
      merchant_report: () => {
        throw new Error("not allowed to act on this vendor's orders");
      },
    });
    await c.text("report");
    expect(c.body()).toMatch(/Reports are for the owner or a manager/);
  });
  it("help lists what the copilot does", async () => {
    const h = harness();
    await h.text("help");
    expect(h.body()).toMatch(/fryer off 15 min[\s\S]*boost 20 nearby/);
  });
  it("the language the merchant writes in is remembered", async () => {
    const h = harness();
    await h.text("el fryer off 15 min");
    expect(h.of("merchant_fact_writes_in")[0].args).toEqual({
      p_vendor_id: VENDOR,
      p_lang: "arabizi",
    });
    expect(writesIn("الفراية مطفاية")).toBe("ar");
    expect(writesIn("fermé demain")).toBe("fr");
    expect(writesIn("fryer off")).toBe("en");
  });
  it("text helpers handle missing numbers", () => {
    expect(reportText({ period: "week" })).toMatch(/Last 7 days[\s\S]*orders: 0/);
    expect(memoryText({})).toMatch(/Nothing yet/);
    expect(copilotDoneText({ status: "rejected", kind: "availability_off" })).toBeNull();
  });
});

describe("the copilot's model (behind ai_merchant_text_enabled, §32.4)", () => {
  const fx = JSON.parse(readFileSync("evals/merchant/fixtures/model-turns.json", "utf8"));
  for (const c of fx.cases) {
    it(`${c.id} ${c.lang}: "${c.text}"`, async () => {
      const h = harness(
        { merchant_report: () => ({ period: "week", orders: 3 }) },
        {
          merchantCopilot: {
            model: "claude-haiku-4-5-20251001",
            call: async () => ({
              content: c.response.map((r: any, k: number) => ({
                type: "tool_use",
                id: `t${k}`,
                name: r.name,
                input: r.input,
              })),
              usage: { input_tokens: 100, output_tokens: 20 },
              stop_reason: "tool_use",
            }),
          },
        },
      );
      await h.text(c.text);
      expect(h.of("merchant_proposal_decide")).toHaveLength(0);
      if (c.expect.kind)
        expect(h.proposal()).toMatchObject({ p_kind: c.expect.kind, p_payload: c.expect.payload });
      else expect(h.of("merchant_proposal_create")).toHaveLength(0);
      if (c.expect.rpc) expect(h.of(c.expect.rpc)[0].args).toMatchObject(c.expect.args);
      if (c.expect.help) expect(h.body()).toMatch(/ما فهمت عليك/);
    });
  }
  it("without the model (switch off or no credit), text the rules do not read gets the help", async () => {
    const h = harness();
    await h.text("el fryer 3am ya3mel mashekel, wa22fo shi rob3 se3a");
    expect(h.of("merchant_proposal_create")).toHaveLength(0);
    expect(h.body()).toMatch(/ما فهمت عليك/);
  });
  it("a model error is logged and answered with the help", async () => {
    const logs: string[] = [];
    const h = harness(
      {},
      {
        merchantCopilot: {
          model: "m",
          call: async () => Promise.reject(new Error("credit balance too low")),
        },
        log: (m) => logs.push(m),
      },
    );
    await h.text("something odd");
    expect(logs).toContain("merchant model failed");
    expect(h.body()).toMatch(/ما فهمت عليك/);
  });
  it("tool inputs are checked before anything is proposed", () => {
    expect(toolToCommand("set_price", { item: "x", price_usd: -1 }, NOW)).toBeNull();
    expect(toolToCommand("close_day", { date: "2020-01-01" }, NOW)).toBeNull();
    expect(
      toolToCommand("set_hours", { weekdays: [9], opens: "09:00", closes: "17:00" }, NOW),
    ).toBeNull();
    expect(toolToCommand("boost", { budget_usd: 20000, audience: "nearby" }, NOW)).toBeNull();
    expect(
      toolToCommand("set_availability", { target: "oven", on: true, minutes: null }, NOW),
    ).toEqual({
      kind: "avail_on",
      station: "oven",
    });
    expect(toolToCommand("unknown_tool", {}, NOW)).toBeNull();
  });
});

describe("menu from a link (§39.7)", () => {
  it("only public https links are fetched", () => {
    expect(linkAllowed("https://www.example.com/menu")).toBe(true);
    for (const bad of [
      "http://example.com/menu",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://localhost/x",
      "https://intranet/x",
      "https://user:pw@example.com/x",
      "https://example.com:8443/x",
      "https://abc.supabase.co/rest/v1/",
      "https://2130706433/x",
      "file:///etc/passwd",
    ])
      expect(linkAllowed(bad), bad).toBe(false);
    expect(firstLink("here: https://example.com/menu.pdf.")).toBe("https://example.com/menu.pdf");
  });
  it("a redirect to a private host, a big file and an odd type are refused", async () => {
    const fake = (res: Response) => (async () => res) as unknown as typeof fetch;
    expect(
      await safeFetch("https://example.com/m", {
        fetch: fake(
          new Response(null, { status: 302, headers: { location: "https://10.0.0.1/" } }),
        ),
      }),
    ).toBeNull();
    expect(
      await safeFetch("https://example.com/m", {
        maxBytes: 10,
        fetch: fake(new Response("x".repeat(100), { headers: { "content-type": "text/html" } })),
      }),
    ).toBeNull();
    expect(
      await safeFetch("https://example.com/m", {
        fetch: fake(new Response("x", { headers: { "content-type": "application/zip" } })),
      }),
    ).toBeNull();
    const ok = await safeFetch("https://example.com/m", {
      fetch: fake(
        new Response("<p>Falafel 4$</p>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    });
    expect(ok?.mime).toBe("text/html");
  });
  it("a page's text keeps one line per block and drops scripts", () => {
    expect(
      htmlText(
        "<script>evil()</script><h2>Sandwiches</h2><li>Falafel &amp; fries 4$</li><li>Shawarma 5$</li>",
      ),
    ).toBe("Sandwiches\nFalafel & fries 4$\nShawarma 5$");
  });
});

describe("the merchant eval's rule cases (evals/merchant/cases.jsonl, every PR)", () => {
  const cases = readFileSync("evals/merchant/cases.jsonl", "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  it("covers all four languages", () => {
    for (const lang of ["ar", "arabizi", "en", "fr"])
      expect(
        cases.some((c) => c.lang === lang),
        lang,
      ).toBe(true);
  });
  for (const c of cases.filter((x) => x.rules))
    it(`${c.id} ${c.lang}: "${c.text}" → ${c.expect.kind}`, () => {
      expect(parseMerchantCommand(c.text, NOW)?.kind ?? "none").toBe(c.expect.kind);
    });
});

describe("review fixes (§39.7)", () => {
  it("'<section> back' switches the section on; an item name still means back in stock", async () => {
    const h = harness();
    await h.text("sandwiches back");
    expect(h.proposal()).toMatchObject({
      p_kind: "availability_on",
      p_payload: { scope: "section", target: SECTION },
    });
    // An item whose name starts with a section's name is the item, not the section.
    const pz = harness({
      merchant_menu_parts: () => ({
        sections: [{ section_id: SECTION, name_en: "Pizza", name_ar: "بيتزا" }],
      }),
      menu_item_match: () => [{ item_id: "it-marg", name: "Pizza Margherita", score: 0.9 }],
    });
    await pz.text("pizza margherita back");
    expect(pz.proposal()).toMatchObject({
      p_kind: "back_in_stock",
      p_payload: { item_id: "it-marg" },
    });
    const k = harness();
    await k.text("knefe back");
    expect(k.proposal()).toMatchObject({
      p_kind: "back_in_stock",
      p_payload: { item_id: "it-knefe" },
    });
  });
  it("no medicine is added to a menu", async () => {
    const h = harness();
    await h.text("add item panadol 3");
    expect(h.of("merchant_proposal_create")).toHaveLength(0);
    expect(h.body()).toMatch(/Medicines can't be sold/);
  });
  it("the model's call is taken from the AI budget and logged; a spent budget means the help", async () => {
    const call = async () => ({
      content: [{ type: "tool_use" as const, id: "t0", name: "set_radius", input: { km: 2 } }],
      usage: { input_tokens: 321, output_tokens: 12 },
      stop_reason: "tool_use",
    });
    const h = harness({}, { merchantCopilot: { model: "m", call } });
    await h.text("ma ba3ad bade wasel aktar men 2 km");
    expect(h.of("ai_quota_take")[0].args).toMatchObject({
      p_purpose: "merchant",
      p_customer_id: null,
    });
    expect(h.of("ai_call_finish")[0].args).toMatchObject({
      p_call_id: 41,
      p_input_tokens: 321,
      p_ok: true,
    });
    expect(h.proposal()).toMatchObject({ p_kind: "radius", p_payload: { km: 2 } });
    const spent = harness(
      { ai_quota_take: () => ({ ok: false, reason: "daily_cap" }) },
      { merchantCopilot: { model: "m", call } },
    );
    await spent.text("ma ba3ad bade wasel aktar men 2 km");
    expect(spent.of("merchant_proposal_create")).toHaveLength(0);
    expect(spent.body()).toMatch(/ما فهمت عليك/);
  });
  it("a link whose DNS answer is private is never fetched", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ])
      expect(privateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"])
      expect(privateAddress(ip), ip).toBe(false);
    let fetched = 0;
    const f = (async () => {
      fetched++;
      return new Response("x", { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    expect(
      await safeFetch("https://x.nip.io/menu", { fetch: f, resolve: async () => ["127.0.0.1"] }),
    ).toBeNull();
    expect(
      await safeFetch("https://example.com/menu", { fetch: f, resolve: async () => [] }),
    ).toBeNull();
    expect(fetched).toBe(0);
    expect(
      await safeFetch("https://example.com/menu", {
        fetch: f,
        resolve: async () => ["93.184.216.34"],
      }),
    ).not.toBeNull();
  });
  it("a hostile page cannot break the reader", () => {
    expect(htmlText("<li>Falafel &#9999999; 4$</li>")).toBe("Falafel 4$");
    expect(htmlText("<li>Falafel &#99999999; 4$</li>")).toBe("Falafel &#99999999; 4$");
    for (const evil of [
      "<".repeat(1_000_000),
      "<!--".repeat(250_000),
      "<a".repeat(500_000),
      "<script>".repeat(100_000),
    ]) {
      const t = Date.now();
      htmlText(evil);
      expect(Date.now() - t, evil.slice(0, 8)).toBeLessThan(1000);
    }
    expect(htmlText("<p>a<!-- x --> b</p><style>p{}</style><li>Falafel 4$</li>")).toBe(
      "a b\nFalafel 4$",
    );
    for (const ip of [
      "64:ff9b::7f00:1",
      "64:ff9b:1::a00:1",
      "2002:7f00:1::",
      "::127.0.0.1",
      "::a00:1",
      "::a9fe:a9fe",
      "::c0a8:101",
    ])
      expect(privateAddress(ip), ip).toBe(true);
    // An unclosed script tag drops the rest of the page (fails closed: the merchant is asked for photos or text), quickly.
    const t0 = Date.now();
    expect(htmlText("<script>" + "x".repeat(2_000_000)).length).toBeLessThanOrEqual(50_000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

// DECISIONS §39.15.4: the merchant hears what Meta would refuse, in their language, before anything reaches Meta.
describe("catalogue rules: a bad photo or a bad name is explained, with the fix", () => {
  const PENDING = "66666666-2222-3333-4444-555555555555";
  const photoOf = async (w: number, h: number, flat = false) =>
    new Uint8Array(
      await sharp({
        create: {
          width: w,
          height: h,
          channels: 3,
          background: flat ? "#ffffff" : "#884422",
          ...(flat ? {} : { noise: { type: "gaussian" as const, mean: 128, sigma: 30 } }),
        },
      })
        .jpeg({ quality: 82 })
        .toBuffer(),
    );
  function photoHarness(bytes: Uint8Array | null, rpcs: Record<string, (a: any) => any> = {}) {
    const puts: { path: string; size: number; mime: string }[] = [];
    const removed: string[] = [];
    const fetched: any[] = [];
    let putOk = true;
    const h = harness(
      {
        merchant_item_photo_path: (a) => ({
          status: "ok",
          vendor_id: VENDOR,
          item_name: "كنافة",
          pending_id: PENDING,
          path: `merchant/${VENDOR}/${PENDING}.${a.p_ext}`,
        }),
        merchant_item_photo_pending: () => ({ status: "ok", replaced: null }),
        merchant_item_photo_pending_expired: () => [],
        ...rpcs,
      },
      {
        fetchMenuMedia: async (_pnid, m) => {
          fetched.push(m);
          return bytes ? { bytes, mime: "image/jpeg" } : null;
        },
        itemPhotos: {
          put: async (path, b, mime) => {
            puts.push({ path, size: b.length, mime });
            return putOk;
          },
          remove: async (path) => {
            removed.push(path);
          },
        },
      },
    );
    return { h, puts, removed, fetched, failPut: () => (putOk = false) };
  }

  it("a photo too small: the fix in Arabic, and nothing is uploaded or recorded", async () => {
    const t = photoHarness(await photoOf(320, 240));
    await t.h.photo("صورة الكنافة");
    expect(t.h.sent).toHaveLength(1);
    const body = t.h.body();
    expect(body).toContain("كاتالوج واتساب رح يرفض هالصورة لـ «كنافة»");
    expect(body).toContain("هالصورة زغيرة كتير (320 × 240)، فواتساب رح يرفضها.");
    expect(body).toContain("ابعت صورة أكبر، 500 × 500 عالأقل");
    expect(body).toContain("ما حفظنا شي.");
    expect(t.puts).toEqual([]);
    expect(t.h.of("merchant_item_photo_path")).toHaveLength(0);
    expect(t.h.of("merchant_item_photo_pending")).toHaveLength(0);
    expect(t.fetched[0]).toMatchObject({ id: "MEDIA-P1" });
  });
  it("in English, French and Arabizi as the merchant wrote the caption", async () => {
    const en = photoHarness(await photoOf(800, 800, true));
    await en.h.photo("photo knefe");
    expect(en.h.body()).toBe(
      "📷 WhatsApp's catalogue would refuse this photo of “كنافة”:\n• This looks like a placeholder or an empty image, not a photo of the item. Send a real photo of the item.\nNothing was saved.",
    );
    const fr = photoHarness(await photoOf(1600, 600));
    await fr.h.photo("photo de la knefe");
    expect(fr.h.body()).toContain("Cette photo est trop longue et étroite (1600 × 600)");
    expect(fr.h.body()).toContain("Rien n'a été enregistré.");
    const az = photoHarness(await photoOf(400, 400));
    await az.h.photo("sora knefe");
    expect(az.h.body()).toContain("Hal soura zghire ktir (400 × 400)");
    for (const x of [en, fr, az]) expect(x.puts).toEqual([]);
  });
  it("a photo that passes waits at a fresh path for a one-tap card naming the item; nothing is recorded yet", async () => {
    const bytes = await photoOf(900, 900);
    const t = photoHarness(bytes);
    await t.h.photo("photo knefe");
    expect(t.h.of("merchant_item_photo_path")[0].args).toEqual({
      p_member_id: MEMBER,
      p_item_id: "it-knefe",
      p_ext: "jpg",
    });
    expect(t.puts).toEqual([
      { path: `merchant/${VENDOR}/${PENDING}.jpg`, size: bytes.length, mime: "image/jpeg" },
    ]);
    const rec = t.h.of("merchant_item_photo_pending")[0].args;
    expect(rec).toMatchObject({
      p_member_id: MEMBER,
      p_pending_id: PENDING,
      p_item_id: "it-knefe",
      p_storage_path: `merchant/${VENDOR}/${PENDING}.jpg`,
      p_width: 900,
      p_height: 900,
      p_bytes: bytes.length,
      p_lang: "en",
    });
    expect(rec.p_origin_hash).toMatch(/^[0-9a-f]{64}$/);
    // The card: the item named, one button, nothing confirmed.
    expect(t.h.sent).toHaveLength(1);
    expect(t.h.body()).toMatch(/^📷 Use this photo for “كنافة”\?/);
    expect(t.h.sent[0].interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: `IPH|${PENDING}`, title: "✅ Use this photo" } },
    ]);
    expect(checkInteractive(t.h.sent[0])).toEqual([]);
    expect(t.h.of("merchant_item_photo_confirm")).toHaveLength(0);
    // Expired pending photos are swept before a new one is stored.
    expect(t.h.of("merchant_item_photo_pending_expired")[0].args).toEqual({ p_limit: 20 });
  });
  it("the tap records it, in the caption's language, and deletes the photo it replaced", async () => {
    const t = photoHarness(null, {
      merchant_item_photo_confirm: () => ({
        status: "ok",
        item_name: "كنافة",
        lang: "ar",
        previous: `merchant/${VENDOR}/old.png`,
      }),
      merchant_item_photo_pending_expired: () => [`merchant/${VENDOR}/stale.jpg`],
    });
    await t.h.tap(`IPH|${PENDING}`);
    expect(t.h.of("merchant_item_photo_confirm")[0].args).toEqual({
      p_pending_id: PENDING,
      p_member_ids: [MEMBER],
    });
    expect(t.h.body()).toBe("📷 حفظناها صورة «كنافة». كاتالوج واتساب بياخدها بأوّل تحديث.");
    expect(t.removed).toEqual([`merchant/${VENDOR}/stale.jpg`, `merchant/${VENDOR}/old.png`]);
    // The tap is the photo's, never a merchant order action.
    expect(t.h.of("merchant_proposal_decide")).toHaveLength(0);
  });
  it("a tap that came too late deletes the waiting photo and asks for it again", async () => {
    const t = photoHarness(null, {
      merchant_item_photo_confirm: () => ({
        status: "expired",
        lang: "en",
        path: `merchant/${VENDOR}/${PENDING}.jpg`,
      }),
    });
    await t.h.tap(`IPH|${PENDING}`);
    expect(t.removed).toEqual([`merchant/${VENDOR}/${PENDING}.jpg`]);
    expect(t.h.body()).toMatch(/waited too long and was not saved/);
  });
  it("a second photo of the same item replaces the one still waiting, whose file goes", async () => {
    const t = photoHarness(await photoOf(900, 900), {
      merchant_item_photo_pending: () => ({
        status: "ok",
        replaced: `merchant/${VENDOR}/earlier.jpg`,
      }),
    });
    await t.h.photo("صورة الكنافة");
    expect(t.removed).toEqual([`merchant/${VENDOR}/earlier.jpg`]);
    expect(t.h.sent[0].interactive.action.buttons[0].reply.title).toBe("✅ استعملها");
  });
  it("a refused record deletes the file it just uploaded", async () => {
    const t = photoHarness(await photoOf(900, 900), {
      merchant_item_photo_pending: () => ({ status: "demo_shop" }),
    });
    await t.h.photo("photo knefe");
    expect(t.removed).toEqual([`merchant/${VENDOR}/${PENDING}.jpg`]);
    expect(t.h.body()).toMatch(/This is a demo shop/);
  });
  it("only an owner or a manager changes photos; a demo shop is refused", async () => {
    const c = photoHarness(await photoOf(900, 900), {
      merchant_members_by_phone: () => [{ member_id: MEMBER, vendor_id: VENDOR, role: "cashier" }],
    });
    await c.h.photo("photo knefe");
    expect(c.h.body()).toBe("📷 Only the owner or a manager can change the menu's photos.");
    expect(c.fetched).toEqual([]);
    const d = photoHarness(await photoOf(900, 900), {
      merchant_item_photo_path: () => ({ status: "demo_shop" }),
    });
    await d.h.photo("photo knefe");
    expect(d.h.body()).toMatch(/This is a demo shop/);
    expect(d.puts).toEqual([]);
  });
  it("not an item photo, so the message carries on: no clear item, a plain caption, a menu command, no caption, no image type", async () => {
    for (const [caption, mime] of [
      ["photo shawarma", "image/jpeg"],
      ["knefe", "image/jpeg"],
      ["photo menu", "image/jpeg"],
      ["menu", "image/jpeg"],
      [null, "image/jpeg"],
      ["photo knefe", ""],
    ] as const) {
      const t = photoHarness(await photoOf(900, 900));
      await t.h.photo(caption, mime);
      expect(t.fetched, String(caption)).toEqual([]);
      expect(t.h.of("merchant_item_photo_path")).toHaveLength(0);
      // The commands' answer, as before this session.
      expect(t.h.body()).toMatch(/^ما فهمت عليك/);
    }
  });
  it("a file over the bucket's 2 MB, or a store that fails, saves nothing and says so", async () => {
    const head = await photoOf(1600, 1200);
    const huge = new Uint8Array(2_200_000);
    huge.set(head.subarray(0, 600));
    huge.fill(0x55, 600);
    const b = photoHarness(huge);
    await b.h.photo("photo knefe");
    expect(b.h.body()).toMatch(/too big \(over 2 MB\)/);
    expect(b.puts).toEqual([]);
    const f = photoHarness(await photoOf(900, 900));
    f.failPut();
    await f.h.photo("photo knefe");
    expect(f.h.body()).toMatch(/Saving the photo failed/);
    expect(f.h.of("merchant_item_photo_pending")).toHaveLength(0);
  });
  it("during a menu import: an uncaptioned photo is a menu page; a captioned one is looked up in the imported shop only", async () => {
    const OTHER = "20000000-0000-0000-0000-00000000000b";
    const importing = {
      onboarding_session_get: () => ({
        step: "menu_import",
        data: { vendor_id: OTHER, member_id: "m-other" },
      }),
      merchant_members_by_phone: () => [
        { member_id: MEMBER, vendor_id: VENDOR, role: "owner" },
        { member_id: "m-other", vendor_id: OTHER, role: "owner" },
      ],
    };
    const m = photoHarness(await photoOf(900, 900), importing);
    await m.h.photo(null);
    expect(m.h.of("merchant_item_photo_path")).toHaveLength(0);
    expect(m.h.of("merchant_menu_help")[0].args.p_media_ref).toBe("wa-media:MEDIA-P1");
    const p = photoHarness(await photoOf(900, 900), importing);
    await p.h.photo("photo knefe");
    expect(p.h.of("menu_item_match").map((c) => c.args.p_vendor_id)).toEqual([OTHER]);
  });

  it("an item whose name mixes two languages: the fix in the merchant's language, then the same card", async () => {
    const h = harness();
    await h.text("add item sujuk platter صحن سجق 5");
    expect(h.body(0)).toContain("⚠️ كاتالوج واتساب رح يرفض هيدا:");
    expect(h.body(0)).toContain("هالاسم خالط عربي وأحرف لاتينية (sujuk platter)");
    expect(h.body(0)).toContain("اكتب الاسم بلغة وحدة");
    expect(h.body(0)).toContain("بينحفظ لمنيو المحادثة والموقع");
    // The confirmation is unchanged: the card with its tap, nothing applied.
    expect(h.proposal()).toMatchObject({
      p_kind: "item_add",
      p_payload: { name: "sujuk platter صحن سجق", price_usd: 5 },
    });
    expect(h.sent[1].interactive.action.buttons[0].reply.id).toBe(`pyes:${PROP}`);
    expect(h.of("merchant_proposal_decide")).toHaveLength(0);
  });
  it("alcohol, a phone number in a name, promotional text in a description: each explained before the card", async () => {
    const a = harness();
    await a.text("add item almaza beer 4");
    expect(a.body(0)).toContain("This looks like alcohol (Almaza Beer)");
    expect(a.proposal().p_kind).toBe("item_add");
    const r = harness();
    await r.text("rename knefe to knefe 03123456");
    expect(r.body(0)).toContain("This name has a price, an offer or contact details (03123456)");
    expect(r.proposal()).toMatchObject({
      p_kind: "item_edit",
      p_payload: { name: "knefe 03123456" },
    });
    const d = harness();
    await d.text("describe knefe: Best price in town!!!");
    expect(d.body(0)).toContain("The description has promotional text (!!!)");
    expect(d.body(0)).toContain("Describe the item itself");
    expect(d.proposal().p_kind).toBe("item_edit");
    const t = harness();
    await t.text("زيد صنف علبة دخان 5");
    expect(t.body(0)).toContain("هيدا بيبيّن دخان أو منتج تبغ");
  });
  it("antibiotic-free chicken is food, not medicine: added with no refusal (review)", async () => {
    expect(isMedicineRequest("antibiotic-free chicken breast")).toBe(false);
    expect(isMedicineRequest("Poulet sans antibiotiques")).toBe(false);
    expect(isMedicineRequest("بدي مضاد حيوي")).toBe(true);
    const h = harness();
    await h.text("add item antibiotic-free chicken breast 6");
    expect(h.sent).toHaveLength(1);
    expect(h.proposal()).toMatchObject({
      p_kind: "item_add",
      p_payload: { name: "antibiotic-free chicken breast", price_usd: 6 },
    });
  });
  it("a name our own titles fix (capitals) or a clean one: no note, the card comes first as before", async () => {
    for (const msg of ["add item falafel wrap 4.5", "add item HOT DOG 5", "زيد صنف فلافل 4"]) {
      const h = harness();
      await h.text(msg);
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0].interactive.action.buttons[0].reply.id).toBe(`pyes:${PROP}`);
    }
  });
});
