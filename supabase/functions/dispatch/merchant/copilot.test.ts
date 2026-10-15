// The merchant copilot on the Merchant number (DECISIONS §39.7): rules and recorded model answers become proposals the
// merchant confirms with a tap; reports, staff and memory only read. The database is a fake RPC layer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runDispatch, copilotDoneText, type DispatchDeps, type SendResult } from "../handler";
import { checkInteractive } from "../../_shared/meta-limits";
import { memoryText, reportText, writesIn } from "./copilot";
import { toolToCommand } from "./copilot-model";
import { parseMerchantCommand } from "../../_shared/merchant-commands";
import { firstLink, htmlText, linkAllowed, safeFetch } from "../../_shared/safe-fetch";

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
    telegram: null,
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
    expect(toolToCommand("boost", { budget_usd: 1000, audience: "nearby" }, NOW)).toBeNull();
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
