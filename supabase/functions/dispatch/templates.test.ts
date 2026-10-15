import { describe, expect, it } from "vitest";
import { runDispatch, type DispatchDeps, type SendResult } from "./handler";
import { templateFill, templateKey, templatePayload } from "./templates";

const ORDER = "11111111-2222-3333-4444-555555555555";
const GIFT = "33333333-2222-3333-4444-555555555555";
const PROPOSAL = "44444444-2222-3333-4444-555555555555";
const card = {
  order_id: ORDER,
  code: "AB3CD9",
  vendor_name: "Vendor A",
  total_usd: 12.5,
  total_lbp: 1118750,
  items: [{ name: "شاورما", quantity: 2 }],
};
const row = (purpose: string, payload: any, c: any = card) => ({
  order_id: c ? ORDER : null,
  target: "+96170000001",
  purpose,
  payload,
  card: c,
});

describe("templateFill: each message's template values (DECISIONS §39.8)", () => {
  it("order confirmed carries the ETA and both currencies; on the way and Send Home track by a tap", () => {
    expect(
      templateFill(
        "accepted",
        row("customer_message", { kind: "accepted", eta: { min: 25, max: 35 } }),
        "en",
      ),
    ).toEqual({
      values: {
        code: "AB3CD9",
        vendor: "Vendor A",
        eta: "25-35 min",
        total: "$12.50 / 1,118,750 LBP",
      },
      payloads: ["c:track"],
    });
    expect(
      templateFill(
        "on_the_way",
        row("customer_message", { kind: "on_the_way", eta: { min: 10, max: 15 } }),
        "ar",
      )?.values.eta,
    ).toBe("10-15 د");
    expect(
      templateFill(
        "gift_accepted",
        row("customer_message", { kind: "gift_accepted", recipient_name: "Mama", code: "AB3CD9" }),
        "en",
      )?.payloads,
    ).toEqual(["c:track"]);
  });
  it("delivered + rate: the buttons are the rating list's own ids", () => {
    expect(
      templateFill("delivered", row("customer_message", { kind: "delivered" }), "fr")?.payloads,
    ).toEqual([`rate:${ORDER}:f5`, `rate:${ORDER}:f3`, `rcv:${ORDER}:no`]);
  });
  it("the gift request answers with the gift card's own Accept / Decline", () => {
    const f = templateFill(
      "gift_request",
      row(
        "customer_message",
        {
          kind: "gift_request",
          gift_id: GIFT,
          sender: "",
          vendor: "فيندور",
          vendor_en: "Vendor A",
          total_usd: 18,
          total_lbp: 1611000,
        },
        null,
      ),
      "en",
    );
    expect(f?.values).toEqual({
      sender: "Someone",
      vendor: "Vendor A",
      total: "$18.00 / 1,611,000 LBP",
    });
    expect(f?.payloads).toEqual([`gft:${GIFT}:y`, `gft:${GIFT}:n`]);
  });
  it("merchant cards: accept 15 / 30 or reject; a suggestion answers the proposal; the weekly summary asks for the report", () => {
    expect(templateFill("new_order", row("new_order", {}), "ar")).toEqual({
      values: { code: "AB3CD9", items: "2 × شاورما", total: "$12.50" },
      payloads: [`acc:${ORDER}:15`, `acc:${ORDER}:30`, `rej:${ORDER}`],
    });
    expect(
      templateFill(
        "proposal",
        row(
          "proposal",
          { proposal_id: PROPOSAL, summary: "Knefe off after 9?", vendor_name: "A" },
          null,
        ),
        "ar",
      )?.payloads,
    ).toEqual([`pyes:${PROPOSAL}`, `pno:${PROPOSAL}`]);
    expect(
      templateFill(
        "merchant_weekly",
        row(
          "reply",
          {
            kind: "merchant_weekly",
            shop: "A",
            orders: "4",
            delivered: "4",
            sales: "$40.00",
            rating: "4.8",
          },
          null,
        ),
        "ar",
      )?.payloads,
    ).toEqual(["mcmd:week"]);
  });
  it("a missing value is left blank, so the template is refused rather than sent with a hole or a made-up ETA", () => {
    expect(
      templatePayload(
        { name: "alo_order_on_the_way", lang: "en" },
        "on_the_way",
        row("customer_message", { kind: "on_the_way" }),
      ),
    ).toBeNull();
    expect(
      templatePayload(
        { name: "alo_order_delivered", lang: "en" },
        "delivered",
        row("customer_message", { kind: "delivered" }, { ...card, vendor_name: null }),
      ),
    ).toBeNull();
  });
  it("a row missing what the template needs fills nothing", () => {
    expect(
      templateFill("delivered", row("customer_message", { kind: "delivered" }, null), "en"),
    ).toBeNull();
    expect(
      templateFill(
        "gift_request",
        row("customer_message", { kind: "gift_request", gift_id: "x" }, null),
        "en",
      ),
    ).toBeNull();
    expect(
      templateFill("near_drop", row("customer_message", { kind: "near_drop" }), "en"),
    ).toBeNull();
  });
  it("the key: the customer kind, the merchant purpose, the weekly reply; never another reply", () => {
    expect(templateKey(row("customer_message", { kind: "on_the_way" }))).toBe("on_the_way");
    expect(templateKey(row("new_order", {}))).toBe("new_order");
    expect(templateKey(row("reply", { kind: "merchant_weekly" }))).toBe("merchant_weekly");
    expect(templateKey(row("reply", { kind: "staff_welcome" }))).toBe("staff_welcome");
    expect(templateKey(row("reply", { kind: "kitchen_full" }))).toBe("kitchen_full");
    expect(templateKey(row("reply", { text: "hi" }))).toBeNull();
  });
  it("staff welcome and kitchen full (§32.5): the role in the template's language, a button the merchant could type", () => {
    const w = templatePayload(
      { name: "alo_staff_welcome", lang: "fr" },
      "staff_welcome",
      row("reply", { kind: "staff_welcome", shop: "Grill", role: "kitchen" }),
    ) as any;
    expect(JSON.stringify(w)).toContain("cuisine");
    expect(JSON.stringify(w)).toContain("mcmd:help");
    expect(
      templateFill(
        "staff_welcome",
        row("reply", { kind: "staff_welcome", shop: "Grill", role: "owner" }),
        "en",
      ),
    ).toBeNull();
    const k = templatePayload(
      { name: "alo_kitchen_full", lang: "ar" },
      "kitchen_full",
      row("reply", { kind: "kitchen_full", shop: "Grill", queue: "16", max: "8" }),
    ) as any;
    expect(JSON.stringify(k)).toContain("mcmd:open");
    expect(
      templatePayload(
        { name: "alo_kitchen_full", lang: "en" },
        "kitchen_full",
        row("reply", { kind: "kitchen_full", shop: "Grill", queue: "16" }),
      ),
    ).toBeNull();
  });
});

// ---- dispatch with the window closed ---------------------------------------------------------------------------------
function harness(opts: {
  open: boolean | null;
  template: any;
  outbox?: any[];
  rpcs?: Record<string, (a: any) => any>;
}) {
  const calls: { fn: string; args: any }[] = [];
  let outbox = opts.outbox ?? [];
  const rpc = async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (opts.rpcs?.[fn]) return opts.rpcs[fn](args);
    switch (fn) {
      case "webhook_claim":
        return [];
      case "outbox_claim": {
        const o = outbox;
        outbox = [];
        return o;
      }
      case "whatsapp_sender":
        return "PNID";
      case "whatsapp_window_open":
        return opts.open;
      case "whatsapp_template_for":
        return opts.template;
      case "order_track":
        return null;
      default:
        return null;
    }
  };
  const sent: { from: string; payload: any }[] = [];
  const d: DispatchDeps = {
    rpc,
    whatsapp: async (from, payload): Promise<SendResult> => {
      sent.push({ from, payload });
      return { ok: true, id: `wamid.${sent.length}` };
    },
    call: null,

    budgetMs: 60_000,
    ...(opts.rpcs?.__kapso ? { kapsoBroadcast: opts.rpcs.__kapso({}) } : {}),
  };
  return {
    d,
    sent,
    calls,
    finish: () => calls.filter((c) => c.fn === "outbox_finish").map((c) => c.args),
  };
}
const outboxRow = (purpose: string, payload: any, c: any = card, target = "+96170000001") => ({
  id: 1,
  order_id: c ? ORDER : null,
  vendor_id: null,
  channel: "whatsapp",
  purpose,
  target,
  payload,
  attempts: 1,
  card: c,
});

describe("dispatch outside the window", () => {
  it("inside the window the free-form message goes as before", async () => {
    const h = harness({
      open: true,
      template: null,
      outbox: [outboxRow("customer_message", { kind: "on_the_way", lang: "en" })],
    });
    await runDispatch(h.d);
    expect(h.sent[0].payload.type).toBe("text");
    expect(h.calls.some((c) => c.fn === "whatsapp_template_for")).toBe(false);
  });
  it("outside it, the approved template goes instead, from the same number", async () => {
    const h = harness({
      open: false,
      template: { name: "alo_order_on_the_way", lang: "en", dry_run: false },
      outbox: [
        outboxRow("customer_message", {
          kind: "on_the_way",
          lang: "en",
          eta: { min: 10, max: 15 },
        }),
      ],
    });
    await runDispatch(h.d);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].from).toBe("PNID");
    expect(h.sent[0].payload.template.name).toBe("alo_order_on_the_way");
    expect(h.sent[0].payload.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "AB3CD9",
      "10-15 min",
    ]);
    expect(h.finish()[0]).toMatchObject({ p_status: "sent", p_provider_ref: "wamid.1" });
  });
  it("outside it with no template a customer message is skipped, never sent free-form", async () => {
    const h = harness({
      open: false,
      template: null,
      outbox: [outboxRow("customer_message", { kind: "on_the_way", lang: "en" })],
    });
    await runDispatch(h.d);
    expect(h.sent).toHaveLength(0);
    expect(h.finish()[0]).toMatchObject({ p_status: "skipped" });
    expect(h.finish()[0].p_error).toMatch(/no approved template/);
  });
  it("a merchant's new-order card: the template outside the window; with none, the card is still tried", async () => {
    const t = harness({
      open: false,
      template: { name: "alo_merchant_new_order", lang: "ar", dry_run: false },
      outbox: [outboxRow("new_order", {}, card, "+96171000001")],
    });
    await runDispatch(t.d);
    expect(t.sent[0].payload.template.name).toBe("alo_merchant_new_order");
    const n = harness({
      open: false,
      template: null,
      outbox: [outboxRow("new_order", {}, card, "+96171000001")],
    });
    await runDispatch(n.d);
    expect(n.sent[0].payload.type).toBe("interactive");
  });
  it("a simulator number gets the template as a dry run through the sink", async () => {
    const h = harness({
      open: false,
      template: { name: "alo_order_delivered", lang: "ar", dry_run: true },
      outbox: [
        outboxRow("customer_message", { kind: "delivered", lang: "ar" }, card, "+99996100000009"),
      ],
      rpcs: { sim_sink_record: () => true },
    });
    await runDispatch(h.d);
    expect(h.sent[0].payload.template.name).toBe("alo_order_delivered");
    expect(h.finish()[0].p_status).toBe("sent");
  });
  it("an older database without the window function: free-form as before", async () => {
    const h = harness({
      open: null,
      template: null,
      outbox: [outboxRow("customer_message", { kind: "on_the_way", lang: "en" })],
    });
    await runDispatch(h.d);
    expect(h.sent[0].payload.type).toBe("text");
  });
});

describe("broadcasts (DECISIONS §39.8)", () => {
  const claim = {
    id: "b1",
    name: "Wraps week",
    template: "alo_offer_nearby",
    values: { shop: "Vendor A", offer: "20% off wraps" },
    groups: { en: ["+96170000001", "+99996100000009"], ar: ["+96170000002"] },
  };
  const kapso = () => {
    const log: any[] = [];
    return {
      log,
      api: {
        create: async (name: string, pn: string, tid: string) => (
          log.push({ create: [name, pn, tid] }),
          `kb-${tid}`
        ),
        addRecipients: async (id: string, r: any[]) => void log.push({ add: [id, r] }),
        send: async (id: string) => void log.push({ send: id }),
      },
    };
  };
  it("nothing happens without a claim (the switch is off or nothing is approved)", async () => {
    const k = kapso();
    const h = harness({ open: true, template: null, rpcs: { broadcast_claim: () => null } });
    await runDispatch({ ...h.d, kapsoBroadcast: k.api });
    expect(k.log).toEqual([]);
    expect(h.calls.some((c) => c.fn === "broadcast_finish")).toBe(false);
  });
  it("one Kapso broadcast per language with the approved template; simulator numbers only through the sink", async () => {
    const k = kapso();
    const h = harness({
      open: true,
      template: null,
      rpcs: {
        broadcast_claim: () => claim,
        broadcast_template_id: (a) => `t-${a.p_lang}`,
        sim_sink_record: () => true,
      },
    });
    await runDispatch({ ...h.d, kapsoBroadcast: k.api });
    expect(k.log.filter((x) => x.create).map((x) => x.create)).toEqual([
      ["Wraps week (en)", "PNID", "t-en"],
      ["Wraps week (ar)", "PNID", "t-ar"],
    ]);
    const added = k.log
      .filter((x) => x.add)
      .flatMap((x) => x.add[1].map((r: any) => r.phone_number));
    expect(added).toEqual(["+96170000001", "+96170000002"]);
    const comps = k.log.find((x) => x.add).add[1][0].components;
    expect(comps.map((c: any) => c.parameters?.[0]?.payload ?? c.parameters?.[0]?.text)).toEqual([
      "Vendor A",
      "c:order",
      "mkt:stop",
    ]);
    expect(h.sent.map((s) => s.payload.to)).toEqual(["99996100000009"]);
    const fin = h.calls.find((c) => c.fn === "broadcast_finish")!.args;
    expect(fin).toMatchObject({
      p_id: "b1",
      p_ok: true,
      p_kapso_ids: ["kb-t-en", "kb-t-ar"],
      p_dry_run_phones: ["+99996100000009"],
      p_sent_phones: ["+96170000001", "+96170000002"],
    });
  });
  it("a language whose template is not approved fails that group and says why", async () => {
    const k = kapso();
    const h = harness({
      open: true,
      template: null,
      rpcs: {
        broadcast_claim: () => claim,
        broadcast_template_id: (a) => (a.p_lang === "ar" ? "t-ar" : null),
        sim_sink_record: () => true,
      },
    });
    await runDispatch({ ...h.d, kapsoBroadcast: k.api });
    const fin = h.calls.find((c) => c.fn === "broadcast_finish")!.args;
    expect(fin.p_ok).toBe(false);
    expect(fin.p_error).toMatch(/en: alo_offer_nearby is not approved/);
    // The Arabic group did go out: those recipients count as sent (weekly cap), only the English one failed.
    expect(fin.p_sent_phones).toEqual(["+96170000002"]);
  });
  it("a utility template is never broadcast", async () => {
    const k = kapso();
    const h = harness({
      open: true,
      template: null,
      rpcs: { broadcast_claim: () => ({ ...claim, template: "alo_order_confirmed" }) },
    });
    await runDispatch({ ...h.d, kapsoBroadcast: k.api });
    expect(k.log).toEqual([]);
    expect(h.calls.find((c) => c.fn === "broadcast_finish")!.args).toMatchObject({
      p_ok: false,
      p_error: "not a marketing template",
    });
  });
});

describe("STOP inside WhatsApp (Kapso marketing preference event)", () => {
  it("opts the customer out", async () => {
    const calls: any[] = [];
    let events = [
      {
        msg_id: 1,
        event_id: 2,
        event_type: "whatsapp.contact.marketing_preference_changed",
        phone_number_id: "PNID",
        payload: { contact: { wa_id: "96170000001" }, marketing_preference: { status: "stopped" } },
      },
    ];
    await runDispatch({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "webhook_claim") {
          const e = events;
          events = [];
          return e;
        }
        return null;
      },
      whatsapp: async () => ({ ok: true }),
      call: null,

      budgetMs: 60_000,
    });
    expect(calls.find((c) => c.fn === "customer_marketing_stop_by_phone")?.args).toEqual({
      p_phone_e164: "+96170000001",
      p_stopped: true,
    });
    expect(calls.find((c) => c.fn === "webhook_finish")?.args.p_status).toBe("done");
  });
});

describe("which number sends (5b review)", () => {
  it("an outbox row leaves from the number where the person's window is open", async () => {
    const h = harness({
      open: true,
      template: null,
      outbox: [outboxRow("customer_message", { kind: "on_the_way", lang: "en", eta: { min: 5 } })],
      rpcs: { whatsapp_sender_for: (a) => (a.p_target === "+96170000001" ? "PN-SANDBOX" : "PNID") },
    });
    await runDispatch(h.d);
    expect(h.sent[0].from).toBe("PN-SANDBOX");
  });
  it("a merchant member's 'Stop promotions' tap is STOP too", async () => {
    const calls: any[] = [];
    let events = [
      {
        msg_id: 1,
        event_id: 3,
        event_type: "whatsapp.message.received",
        phone_number_id: "PNID",
        payload: {
          message: {
            id: "wamid.s",
            type: "button",
            button: { payload: "mkt:stop" },
            kapso: { direction: "inbound" },
          },
          conversation: { phone_number: "+96171000001" },
        },
      },
    ];
    await runDispatch({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "webhook_claim") {
          const e = events;
          events = [];
          return e;
        }
        if (fn === "merchant_members_by_phone")
          return [{ member_id: "m", vendor_id: "v", role: "owner" }];
        return null;
      },
      whatsapp: async () => ({ ok: true }),
      call: null,

      budgetMs: 60_000,
    });
    expect(calls.find((c) => c.fn === "customer_marketing_stop_by_phone")?.args).toEqual({
      p_phone_e164: "+96171000001",
      p_stopped: true,
    });
    expect(calls.find((c) => c.fn === "app_reply")?.args.p_payload.text).toMatch(
      /Promotions stopped/,
    );
  });
});
