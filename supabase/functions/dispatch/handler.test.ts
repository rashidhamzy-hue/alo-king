import { describe, expect, it } from "vitest";
import { readInbound, runDispatch, type DispatchDeps, type SendResult } from "./handler";

const ORDER = "11111111-2222-3333-4444-555555555555";
const MEMBER = "99999999-2222-3333-4444-555555555555";
const VENDOR = "20000000-0000-0000-0000-00000000000a";
const NOW = new Date("2026-10-11T12:00:00Z"); // 15:00 in Beirut

const card = {
  order_id: ORDER,
  code: "AB3CD9",
  fulfilment: "pickup",
  payment_method: "cod",
  total_usd: 12.5,
  total_lbp: 1118750,
  usd_lbp_rate: 89500,
  items: [{ name: "شاورما", quantity: 2 }],
};

// A fake database: queues of claimed rows and a log of every RPC.
function fakeDb(opts: {
  events?: any[];
  outbox?: any[];
  alerts?: any[];
  members?: any[];
  sender?: string | null;
  rpcs?: Record<string, (a: any) => any>;
}) {
  const calls: { fn: string; args: any }[] = [];
  let events = opts.events ?? [];
  let outbox = opts.outbox ?? [];
  const replies: any[] = [];
  const rpc = async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (opts.rpcs?.[fn]) return opts.rpcs[fn](args);
    switch (fn) {
      case "webhook_claim": {
        const e = events;
        events = [];
        return e;
      }
      case "outbox_claim": {
        const o = [
          ...outbox,
          ...replies.splice(0).map((r, k) => ({
            id: 1000 + k,
            order_id: null,
            vendor_id: null,
            channel: "whatsapp",
            purpose: "reply",
            target: r.p_to,
            payload: r.p_payload,
            attempts: 1,
            card: null,
          })),
        ];
        outbox = [];
        return o;
      }
      case "app_reply":
        replies.push(args);
        return 1;
      case "merchant_members_by_phone":
        return opts.members ?? [];
      case "merchant_member_for":
        return MEMBER;
      case "whatsapp_sender":
        return opts.sender === undefined ? "PNID-M" : opts.sender;
      case "ops_alerts_claim":
        return opts.alerts ?? [];
      case "onboarding_session_get":
        return null;
      default:
        return { status: "ok" };
    }
  };
  return { rpc, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

function deps(db: ReturnType<typeof fakeDb>, extra: Partial<DispatchDeps> = {}) {
  const sent: { from: string; payload: any }[] = [];
  const d: DispatchDeps = {
    rpc: db.rpc,
    whatsapp: async (from, payload): Promise<SendResult> => {
      sent.push({ from, payload });
      return { ok: true, id: `wamid.${sent.length}` };
    },
    call: null,

    now: () => NOW,
    budgetMs: 60_000,
    ...extra,
  };
  return { d, sent };
}

const inbound = (msg: any, phone = "+96171000001") => ({
  msg_id: 1,
  event_id: 7,
  event_type: "whatsapp.message.received",
  phone_number_id: "PNID-M",
  payload: {
    message: { id: "wamid.in", kapso: { direction: "inbound" }, ...msg },
    conversation: { phone_number: phone },
  },
});

describe("readInbound", () => {
  it("reads a button reply and normalises the sender to E.164", () => {
    expect(
      readInbound(
        inbound({ type: "interactive", interactive: { button_reply: { id: "x" } } }, "96171000001")
          .payload,
      ),
    ).toEqual({ from: "+96171000001", messageId: "wamid.in", buttonId: "x", text: null });
  });
  it("ignores outbound echoes and bad senders", () => {
    expect(
      readInbound({
        message: { kapso: { direction: "outbound" } },
        conversation: { phone_number: "+96171000001" },
      }),
    ).toBeNull();
    expect(
      readInbound({ message: { type: "text" }, conversation: { phone_number: "abc" } }),
    ).toBeNull();
  });
});

describe("merchant taps and commands", () => {
  const merchant = [{ member_id: MEMBER, vendor_id: VENDOR, role: "owner", vendor_name: "A" }];

  it("an Accept tap accepts as the sender's membership on the WhatsApp channel, then confirms", async () => {
    const db = fakeDb({
      members: merchant,
      events: [
        inbound({ type: "interactive", interactive: { button_reply: { id: `acc:${ORDER}:15` } } }),
      ],
      rpcs: { order_accept: () => ({ status: "accepted" }) },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("order_accept")[0].args).toEqual({
      p_order_id: ORDER,
      p_prep_minutes: 15,
      p_member_id: MEMBER,
      p_channel: "whatsapp",
    });
    expect(db.of("webhook_finish")[0].args.p_status).toBe("done");
    expect(sent[0].payload.text.body).toMatch(/تم القبول/);
  });

  it("an accept that lost to a cancel says so instead of failing", async () => {
    const db = fakeDb({
      members: merchant,
      events: [
        inbound({ type: "interactive", interactive: { button_reply: { id: `acc:${ORDER}:30` } } }),
      ],
      rpcs: {
        order_accept: () => {
          throw new Error("order_accept: 400 stale_status: order AB is cancelled");
        },
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("webhook_finish")[0].args.p_status).toBe("done");
    expect(sent[0].payload.text.body).toMatch(/ما عاد فيك/);
  });

  it('"Mrakad 30 mins" proposes a 30-minute pause and asks for the confirming tap', async () => {
    const db = fakeDb({
      members: merchant,
      events: [inbound({ type: "text", text: { body: "Mrakad 30 mins" } })],
      rpcs: { merchant_proposal_create: () => "77777777-2222-3333-4444-555555555555" },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    const p = db.of("merchant_proposal_create")[0].args;
    expect(p.p_kind).toBe("pause");
    expect(p.p_payload.until).toBe("2026-10-11T12:30:00.000Z");
    expect(db.of("merchant_proposal_decide")).toHaveLength(0);
    expect(sent[0].payload.interactive.action.buttons[0].reply.id).toBe(
      "pyes:77777777-2222-3333-4444-555555555555",
    );
  });

  it("unrecognised merchant text gets the help reply, no model call", async () => {
    const db = fakeDb({
      members: merchant,
      events: [inbound({ type: "text", text: { body: "can you redo my whole menu" } })],
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(sent[0].payload.text.body).toMatch(/جرّب/);
  });

  it("a customer's message is left to the customer bot", async () => {
    const db = fakeDb({
      members: [],
      events: [inbound({ type: "text", text: { body: "بدي شاورما" } }, "+96170000001")],
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("webhook_finish")[0].args.p_status).toBe("ignored");
    expect(sent).toHaveLength(0);
  });
});

describe("outbox through the order_channel router", () => {
  const row = (o: any) => ({
    id: 1,
    order_id: ORDER,
    vendor_id: VENDOR,
    channel: "whatsapp",
    purpose: "new_order",
    target: "+96171000005",
    payload: {},
    attempts: 1,
    card,
    ...o,
  });

  it("sends the order card from the merchant number and records the message id", async () => {
    const db = fakeDb({ outbox: [row({})] });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(sent[0].from).toBe("PNID-M");
    expect(sent[0].payload.to).toBe("96171000005");
    expect(sent[0].payload.interactive.header.text).toContain("AB3CD9");
    expect(db.of("outbox_finish")[0].args).toMatchObject({
      p_id: 1,
      p_status: "sent",
      p_provider_ref: "wamid.1",
    });
  });

  it("a run whose budget is spent still sends one small batch, so an order card never waits for the next tick", async () => {
    const db = fakeDb({ outbox: [row({})] });
    const { d, sent } = deps(db, { budgetMs: 0 });
    await runDispatch(d);
    expect(db.of("webhook_claim")).toHaveLength(0);
    expect(db.of("outbox_claim").map((c) => c.args.p_limit)).toEqual([5]);
    expect(sent[0].payload.interactive.header.text).toContain("AB3CD9");
  });

  it("no merchant number yet (#67): skipped, which fires the backup in the database", async () => {
    const db = fakeDb({ outbox: [row({})], sender: null });
    const { d } = deps(db);
    await runDispatch(d);
    expect(db.of("outbox_finish")[0].args).toMatchObject({ p_status: "skipped" });
  });

  it("a Kapso 5xx is retried, then failed after 3 attempts", async () => {
    for (const [attempts, status] of [
      [1, "queued"],
      [3, "failed"],
    ] as const) {
      const db = fakeDb({ outbox: [row({ attempts })] });
      const { d } = deps(db, {
        whatsapp: async () => ({ ok: false, retry: true, error: "kapso 502" }),
      });
      await runDispatch(d);
      expect(db.of("outbox_finish")[0].args.p_status).toBe(status);
    }
  });

  it("the call layer without a voice provider is skipped; portal and printer need no send", async () => {
    const db = fakeDb({
      outbox: [
        row({ id: 1, channel: "call", purpose: "call", target: "+96171000001" }),
        row({ id: 2, channel: "portal" }),
        row({ id: 3, channel: "printer", target: "p1" }),
      ],
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("outbox_finish").map((c) => c.args.p_status)).toEqual(["skipped", "sent", "sent"]);
    expect(sent).toHaveLength(0);
  });

  it("places the call when a provider is configured", async () => {
    const calls: string[] = [];
    const db = fakeDb({
      outbox: [row({ channel: "call", purpose: "call", target: "+96171000001" })],
    });
    const { d } = deps(db, {
      call: async (to) => {
        calls.push(to);
        return { ok: true, id: "CA1" };
      },
    });
    await runDispatch(d);
    expect(calls).toEqual(["+96171000001"]);
    expect(db.of("outbox_finish")[0].args).toMatchObject({
      p_status: "sent",
      p_provider_ref: "CA1",
    });
  });
});

describe("customer messages and the delivery code (session 4)", () => {
  const merchant = [{ member_id: MEMBER, vendor_id: VENDOR, role: "owner", vendor_name: "A" }];
  it("a customer message goes from the customer number with the code read at send time", async () => {
    const db = fakeDb({
      outbox: [
        {
          id: 5,
          order_id: ORDER,
          vendor_id: VENDOR,
          channel: "whatsapp",
          purpose: "customer_message",
          target: "+96170000001",
          attempts: 1,
          card: { ...card, vendor_name: "Shop" },
          payload: { kind: "accepted", lang: "en", customer_id: "c1", eta: { min: 20, max: 30 } },
        },
      ],
      rpcs: {
        whatsapp_sender: (a) => (a.p_audience === "customer" ? "PNID-C" : "PNID-M"),
        order_track: () => ({ delivery_code: "4821" }),
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(sent[0].from).toBe("PNID-C");
    expect(sent[0].payload.text.body).toContain("4821");
    expect(db.of("outbox_finish")[0].args.p_status).toBe("sent");
  });
  it("a delivered tap on a coded order asks for the code instead of failing", async () => {
    const db = fakeDb({
      members: merchant,
      events: [
        inbound({ type: "interactive", interactive: { button_reply: { id: `dlv:${ORDER}` } } }),
      ],
      rpcs: {
        order_progress: () => {
          throw new Error(
            "order_progress: 400 delivery_code_required: order AB3CD9 needs the code",
          );
        },
      },
    });
    const { d } = deps(db);
    await runDispatch(d);
    expect(db.of("app_reply")[0]?.args.p_payload.text ?? "").toContain("رمز التسليم");
    expect(db.of("webhook_finish")[0].args.p_status).toBe("done");
  });
  it("four digits typed by the merchant confirm the delivery code (Arabic digits too)", async () => {
    const db = fakeDb({
      members: merchant,
      events: [inbound({ type: "text", text: { body: " ٤٨٢١ " } })],
      rpcs: { order_confirm_delivery_code: () => ({ status: "delivered", code: "AB3CD9" }) },
    });
    const { d } = deps(db);
    await runDispatch(d);
    expect(db.of("order_confirm_delivery_code")[0].args).toEqual({
      p_phone_e164: "+96171000001",
      p_code: "4821",
    });
    expect(db.of("app_reply")[0].args.p_payload.text).toContain("AB3CD9");
  });
  it("a barcode typed by the merchant shows what Open Food Facts says, cached (§39.5)", async () => {
    const db = fakeDb({
      members: merchant,
      events: [inbound({ type: "text", text: { body: "4006381333931" } })],
      rpcs: { off_product_get: () => null, off_product_put: () => null },
    });
    const offFetch = (async () =>
      new Response(
        JSON.stringify({
          status: 1,
          product: {
            product_name: "Labneh",
            brands: "Taanayel",
            quantity: "500 g",
            allergens_tags: ["en:milk"],
          },
        }),
      )) as unknown as typeof fetch;
    const { d } = deps(db, { offFetch });
    await runDispatch(d);
    expect(db.of("off_product_put")[0].args.p_product).toMatchObject({
      barcode: "4006381333931",
      found: true,
      allergens: ["dairy"],
    });
    expect(db.of("app_reply")[0].args.p_payload.text).toMatch(
      /Labneh · Taanayel · 500 g[\s\S]*estimated/,
    );
    expect(db.of("order_confirm_delivery_code")).toHaveLength(0);
  });
  it("a number that is not a valid barcode is not looked up", async () => {
    const db = fakeDb({
      members: merchant,
      events: [inbound({ type: "text", text: { body: "4006381333932" } })],
    });
    const { d } = deps(db, {
      offFetch: (async () => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch,
    });
    await runDispatch(d);
    expect(db.of("off_product_get")).toHaveLength(0);
  });
});

describe("the Slack queue (§32.1; Telegram dropped)", () => {
  it("is not claimed while Slack is not installed", async () => {
    const db = fakeDb({});
    await runDispatch(deps(db).d);
    expect(db.of("slack_claim")).toHaveLength(0);
  });
  it("posts each queued message to its channel and thread, then records the ts", async () => {
    const posted: any[] = [];
    const db = fakeDb({
      rpcs: {
        slack_claim: () => [
          {
            id: 7,
            channel_id: "C0URGENT",
            thread_ts: null,
            text: "🚨 Order AB not acknowledged",
            actions: [{ action_id: "ack_alert", text: "Acknowledge", value: "5" }],
          },
          {
            id: 8,
            channel_id: "C0ORDERS",
            thread_ts: "1700.1",
            text: "#AB → accepted",
            actions: [],
          },
        ],
      },
    });
    const { d } = deps(db, {
      slack: async (m) => {
        posted.push(m);
        return { ok: true, ts: `ts-${posted.length}` };
      },
    });
    await runDispatch(d);
    expect(posted.map((p) => [p.channel, p.threadTs])).toEqual([
      ["C0URGENT", null],
      ["C0ORDERS", "1700.1"],
    ]);
    expect(db.of("slack_finish").map((c) => c.args)).toEqual([
      { p_id: 7, p_ok: true, p_channel_id: "C0URGENT", p_ts: "ts-1", p_error: null, p_retry: true },
      { p_id: 8, p_ok: true, p_channel_id: "C0ORDERS", p_ts: "ts-2", p_error: null, p_retry: true },
    ]);
  });
});

describe("merchant WhatsApp extras (§32.5)", () => {
  const merchant = [{ member_id: MEMBER, vendor_id: VENDOR, role: "owner", vendor_name: "A" }];
  const PROP = "77777777-2222-3333-4444-555555555555";
  const run = async (body: string, rpcs: Record<string, (a: any) => any> = {}) => {
    const db = fakeDb({
      members: merchant,
      events: [inbound({ type: "text", text: { body } })],
      rpcs: { merchant_proposal_create: () => PROP, ...rpcs },
    });
    const out = deps(db);
    await runDispatch(out.d);
    return { db, sent: out.sent };
  };
  it("generator mode, capacity and the same-price badge are proposals the merchant confirms", async () => {
    for (const [body, kind, payload] of [
      ["ما في كهربا", "power_off", {}],
      ["power back", "power_on", {}],
      ["capacity 6", "capacity", { max: 6 }],
      ["same price as in the shop", "same_price", { on: true }],
    ] as const) {
      const { db, sent } = await run(body);
      const p = db.of("merchant_proposal_create")[0].args;
      expect([p.p_kind, p.p_payload]).toEqual([kind, payload]);
      expect(db.of("merchant_proposal_decide")).toHaveLength(0);
      expect(sent[0].payload.interactive.action.buttons[0].reply.id).toBe(`pyes:${PROP}`);
    }
  });
  it("adding staff proposes the phone in E.164 with the role; a non-owner is told it is the owner's job", async () => {
    const { db } = await run("add Ali as kitchen 03 123 456");
    expect(db.of("merchant_proposal_create")[0].args.p_payload).toEqual({
      name: "Ali",
      role: "kitchen",
      phone: "+9613123456",
    });
    const x = await run("add Ali as kitchen 03 123 456", {
      merchant_proposal_create: () => {
        throw new Error("not allowed to act on this vendor's orders");
      },
    });
    expect(x.sent[0].payload.text.body).toMatch(/Only the owner/);
  });
  it("removing staff finds the member by name, and refuses a vague name", async () => {
    const { db } = await run("remove Ali", {
      vendor_staff_find: () => [
        { member_id: "m-ali", display_name: "Ali", role: "kitchen", score: 0.9 },
      ],
    });
    expect(db.of("merchant_proposal_create")[0].args).toMatchObject({
      p_kind: "staff_remove",
      p_payload: { member_id: "m-ali" },
    });
    const y = await run("remove Ali", { vendor_staff_find: () => [] });
    expect(y.db.of("merchant_proposal_create")).toHaveLength(0);
    expect(y.sent[0].payload.text.body).toMatch(/No staff member/);
  });
  it("a substitute is offered with the item from the menu, never a price from the message", async () => {
    const { db, sent } = await run("sub K7M2QX pepsi = 7up", {
      menu_item_match: () => [{ item_id: "i-7up", name: "7up", score: 0.9 }],
      order_substitution_offer: () => ({
        status: "offered",
        code: "K7M2QX",
        line: "Pepsi",
        substitute: "7up",
        diff_usd: 0.25,
        pref: "replace",
        max_usd: 2,
      }),
    });
    expect(db.of("order_substitution_offer")[0].args).toEqual({
      p_vendor_id: VENDOR,
      p_code: "K7M2QX",
      p_missing: "pepsi",
      p_substitute_item_id: "i-7up",
      p_member_id: MEMBER,
    });
    expect(sent[0].payload.text.body).toMatch(/\+\$0\.25/);
    expect(sent[0].payload.text.body).toMatch(/up to \$2\.00 more/);
  });
  it("a staff member's first message of a shift gets the handover first", async () => {
    const db = fakeDb({
      members: [{ member_id: MEMBER, vendor_id: VENDOR, role: "kitchen", vendor_name: "A" }],
      events: [inbound({ type: "text", text: { body: "Mrakad 30 mins" } })],
      rpcs: {
        merchant_proposal_create: () => PROP,
        staff_shift_touch: () => [
          {
            vendor_id: VENDOR,
            vendor_name: "A",
            pending: [{ code: "K7M2QX", status: "preparing", minutes: 12 }],
            pending_count: 1,
            sold_out: ["كنافة"],
            complaints: 1,
          },
        ],
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(sent[0].payload.text.body).toMatch(/Shift start/);
    expect(sent[0].payload.text.body).toMatch(/#K7M2QX/);
    expect(sent[0].payload.text.body).toMatch(/كنافة/);
    expect(sent[1].payload.interactive.action.buttons[0].reply.id).toBe(`pyes:${PROP}`);
  });
  it("a confirmed power cut says how many items were hidden", async () => {
    const db = fakeDb({
      members: merchant,
      events: [
        inbound({
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: `pyes:${PROP}`, title: "✅" } },
        }),
      ],
      rpcs: {
        merchant_proposal_decide: () => ({ status: "confirmed", kind: "power_off", hidden: 4 }),
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(sent[0].payload.text.body).toMatch(/4 items hidden/);
  });
  it("the accepted message is preceded by the gold order card image when it is switched on", async () => {
    const outbox = [
      {
        id: 5,
        order_id: ORDER,
        vendor_id: VENDOR,
        channel: "whatsapp",
        purpose: "customer_message",
        target: "+96170000001",
        attempts: 1,
        card: { ...card, vendor_name: "Shop" },
        payload: { kind: "accepted", lang: "ar", customer_id: "c1" },
      },
    ];
    const svgs: string[] = [];
    const db = fakeDb({
      outbox,
      rpcs: {
        whatsapp_sender: (a) => (a.p_audience === "customer" ? "PNID-C" : "PNID-M"),
        order_track: () => ({}),
        order_card_image: () => ({
          code: "AB3CD9",
          lines: [{ name_ar: "شاورما", quantity: 2, line_usd: 9 }],
          total_usd: 12.5,
          total_lbp: 1118750,
          usd_lbp_rate: 89500,
        }),
      },
    });
    const { d, sent } = deps(db, { orderCard: async (_from, svg) => (svgs.push(svg), "MEDIA1") });
    await runDispatch(d);
    expect(svgs[0]).toContain("1,118,750 LBP");
    expect(sent[0].payload).toMatchObject({ type: "image", image: { id: "MEDIA1" } });
    expect(sent[1].payload.type).toBe("text");
    // Switched off (null from the database): the text alone.
    const off = fakeDb({
      outbox,
      rpcs: {
        whatsapp_sender: () => "PNID-C",
        order_track: () => ({}),
        order_card_image: () => null,
      },
    });
    const o = deps(off, { orderCard: async () => "MEDIA1" });
    await runDispatch(o.d);
    expect(o.sent.map((x) => x.payload.type)).toEqual(["text"]);
  });
});

describe("the one-phone test switch and the merchant's next-step cards (session T, §34)", () => {
  const merchant = [
    { member_id: MEMBER, vendor_id: VENDOR, role: "owner", vendor_name: "Alo Test Grill" },
  ];
  const tap = (id: string) =>
    inbound({ type: "interactive", interactive: { button_reply: { id } } });
  const text = (body: string) => inbound({ type: "text", text: { body } });
  const buttonIds = (sent: { payload: any }[]) =>
    sent.flatMap((x) => (x.payload.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id));

  it("#merchant from the owner's phone switches the side and says so; nothing else runs", async () => {
    const db = fakeDb({
      members: [],
      events: [text("#merchant")],
      rpcs: {
        test_side_get: () => "customer",
        test_side_set: () => ({ status: "ok", side: "merchant", vendor: "Alo Test Grill" }),
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("test_side_set")[0].args).toEqual({
      p_phone_e164: "+96171000001",
      p_side: "merchant",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.text.body).toMatch(/merchant of Alo Test Grill/);
    expect(db.of("webhook_finish")[0].args.p_status).toBe("done");
  });

  it("#customer switches back (case and spaces do not matter)", async () => {
    const db = fakeDb({
      members: merchant,
      events: [text("  #Customer ")],
      rpcs: {
        test_side_get: () => "merchant",
        test_side_set: () => ({ status: "ok", side: "customer", vendor: "Alo Test Grill" }),
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("test_side_set")[0].args.p_side).toBe("customer");
    expect(sent[0].payload.text.body).toMatch(/customer again/);
  });

  it("any other number sending #merchant gets the normal paths, never the switch", async () => {
    const db = fakeDb({
      members: merchant,
      events: [text("#merchant")],
      rpcs: { test_side_get: () => null },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("test_side_set")).toHaveLength(0);
    expect(sent[0].payload.text.body).toMatch(/جرّب/); // the merchant help text
  });

  it("on the customer side a member's text goes to the customer bot, not the merchant help", async () => {
    const db = fakeDb({
      members: merchant,
      events: [text("hi")],
      rpcs: { test_side_get: () => "customer" },
    });
    const { d, sent } = deps(db);
    await runDispatch(d); // no customer deps in this test: the customer path answers "ignored"
    expect(db.of("webhook_finish")[0].args.p_status).toBe("ignored");
    expect(sent).toHaveLength(0);
  });

  it("a merchant card tapped on the customer side still reaches the merchant handler", async () => {
    const db = fakeDb({
      members: merchant,
      events: [tap(`acc:${ORDER}:15`)],
      rpcs: { test_side_get: () => "customer", order_accept: () => ({ status: "accepted" }) },
    });
    const { d } = deps(db);
    await runDispatch(d);
    expect(db.of("order_accept")).toHaveLength(1);
  });

  it("a customer button tapped on the merchant side goes to the customer bot", async () => {
    const db = fakeDb({
      members: merchant,
      events: [tap("c:order")],
      rpcs: { test_side_get: () => "merchant" },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(db.of("webhook_finish")[0].args.p_status).toBe("ignored");
    expect(sent).toHaveLength(0);
  });

  it("accepting offers the Ready card, ready offers Out for delivery, out offers Delivered", async () => {
    const run = async (id: string, brief: any, rpcs: Record<string, (a: any) => any>) => {
      const db = fakeDb({
        members: merchant,
        events: [tap(id)],
        rpcs: { order_brief: () => brief, ...rpcs },
      });
      const { d, sent } = deps(db);
      await runDispatch(d);
      return buttonIds(sent);
    };
    const delivery = { code: "AB3CD9", fulfilment: "delivery", is_test: true };
    expect(
      await run(`acc:${ORDER}:15`, delivery, { order_accept: () => ({ status: "accepted" }) }),
    ).toContain(`rdy:${ORDER}`);
    expect(
      await run(`rdy:${ORDER}`, delivery, { order_progress: () => ({ status: "ready" }) }),
    ).toContain(`out:${ORDER}`);
    expect(
      await run(`out:${ORDER}`, delivery, { order_progress: () => ({ status: "picked_up" }) }),
    ).toEqual([`dlv:${ORDER}`]);
    expect(
      await run(
        `rdy:${ORDER}`,
        { code: "AB3CD9", fulfilment: "pickup", is_test: true },
        { order_progress: () => ({ status: "ready" }) },
      ),
    ).toEqual([`dlv:${ORDER}`]);
  });

  it("a real merchant gets no chained card", async () => {
    const db = fakeDb({
      members: merchant,
      events: [tap(`acc:${ORDER}:15`)],
      rpcs: {
        order_brief: () => ({ code: "AB3CD9", fulfilment: "delivery", is_test: false }),
        order_accept: () => ({ status: "accepted" }),
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(buttonIds(sent)).toEqual([]);
  });

  it("a step that failed offers no next card", async () => {
    const db = fakeDb({
      members: merchant,
      events: [tap(`acc:${ORDER}:15`)],
      rpcs: {
        order_brief: () => ({ code: "AB3CD9", fulfilment: "delivery", is_test: true }),
        order_accept: () => {
          throw new Error("order_accept: 400 stale_status: order AB is cancelled");
        },
      },
    });
    const { d, sent } = deps(db);
    await runDispatch(d);
    expect(buttonIds(sent)).toEqual([]);
  });
});

describe("the catalogue sync step runs inside a normal dispatch run (§39.12)", () => {
  it("with the usual 20 s reply budget, the sync still takes shops while the worker has time left", async () => {
    const db = fakeDb({});
    const api = {
      batch: async () => ({ ok: true as const }),
      productSet: async () => null,
      imageUrl: (id: string, h: string) => `https://x.test/${id}?v=${h}`,
    };
    const { d } = deps(db, {
      budgetMs: 20_000,
      workerDeadline: new Date(Date.now() + 150_000),
      catalog: api,
    });
    await runDispatch(d);
    expect(db.of("catalog_sync_claim").length).toBeGreaterThan(0);
  });
  it("a worker near its end takes no shop", async () => {
    const db = fakeDb({});
    const { d } = deps(db, {
      budgetMs: 20_000,
      workerDeadline: new Date(Date.now() + 20_000),
      catalog: {
        batch: async () => ({ ok: true as const }),
        productSet: async () => null,
        imageUrl: () => "",
      },
    });
    await runDispatch(d);
    expect(db.of("catalog_sync_claim")).toHaveLength(0);
  });
});

describe("a held message is waited for inside the run (session 5e, 30-second ticks)", () => {
  it("claims again once webhook_next_due says a message comes back within the budget", async () => {
    let due: number | null = 4;
    let later: any[] = [];
    const db = fakeDb({
      members: [{ member_id: MEMBER, vendor_id: VENDOR, role: "owner", vendor_name: "A" }],
      rpcs: {
        webhook_claim: () => {
          const e = later;
          later = [];
          return e;
        },
        webhook_next_due: () => {
          const d = due;
          if (d != null) {
            later = [
              inbound({
                type: "interactive",
                interactive: { button_reply: { id: `acc:${ORDER}:15` } },
              }),
            ];
            due = null;
          }
          return d;
        },
        order_accept: () => ({ status: "accepted" }),
      },
    });
    const waits: number[] = [];
    let outboxBeforeWait = false;
    const { d } = deps(db, {
      sleep: async (ms) => {
        outboxBeforeWait = db.of("outbox_claim").length > 0;
        waits.push(ms);
      },
    });
    const out = await runDispatch(d);
    expect(outboxBeforeWait, "the outbox (an order card) goes out before the wait").toBe(true);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(4000);
    expect(waits[0]).toBeLessThanOrEqual(4100);
    expect(out.inbound).toBe(1);
    expect(db.of("order_accept")).toHaveLength(1);
  });

  it("does not wait for a message due after the run's budget", async () => {
    const db = fakeDb({ rpcs: { webhook_next_due: () => 59 } });
    const waits: number[] = [];
    const { d } = deps(db, { sleep: async (ms) => void waits.push(ms) });
    await runDispatch(d);
    expect(waits).toEqual([]);
  });
});
