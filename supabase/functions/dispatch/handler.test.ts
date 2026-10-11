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
    telegram: null,
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

describe("ops alerts", () => {
  it("are not claimed while Telegram is not configured", async () => {
    const db = fakeDb({ alerts: [{ id: 1, severity: "urgent", summary: "x" }] });
    await runDispatch(deps(db).d);
    expect(db.of("ops_alerts_claim")).toHaveLength(0);
  });
  it("go to Telegram with a link to the admin page and are marked sent", async () => {
    const texts: string[] = [];
    const db = fakeDb({
      alerts: [{ id: 5, severity: "urgent", summary: "Order AB not acknowledged after 76 s" }],
    });
    const { d } = deps(db, {
      telegram: async (t, url) => {
        texts.push(`${t} ${url}`);
        return { ok: true };
      },
      adminUrl: "https://aloking.com",
    });
    await runDispatch(d);
    expect(texts[0]).toBe(
      "🚨 Order AB not acknowledged after 76 s https://aloking.com/admin?alert=5",
    );
    expect(db.of("ops_alert_sent")[0].args).toEqual({ p_id: 5 });
  });
});
