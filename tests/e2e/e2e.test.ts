import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { deliver, inboundPayload, sign } from "./lib/kapso";
import { kindMatches, langOf, mismatch, render, toOut, valueMatches } from "./lib/match";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { expand } from "./lib/parts";
import type { Scenario } from "./lib/types";

const row = (payload: any, kind = "interactive:button", body = "hello") => ({
  id: 7,
  to_phone: "+99996112345678",
  kind,
  body,
  payload,
});

describe("signing and payloads", () => {
  it("signs with HMAC-SHA256 over the exact body", () => {
    expect(sign("s", "{}")).toBe(createHmac("sha256", "s").update("{}").digest("hex"));
  });

  it("builds the Kapso shape the bot reads, for text, taps, pins and voice", () => {
    const base = { phone: "+99996112345678", phoneNumberId: "555" };
    const t: any = inboundPayload({ ...base, message: { type: "text", text: "Order" } });
    expect(t.message).toMatchObject({
      type: "text",
      from: "99996112345678",
      text: { body: "Order" },
    });
    expect(t.message.kapso.direction).toBe("inbound");
    expect(t.conversation.phone_number).toBe("+99996112345678");
    const b: any = inboundPayload({
      ...base,
      message: { type: "button", id: "c:order", title: "Order" },
    });
    expect(b.message.interactive.button_reply.id).toBe("c:order");
    const l: any = inboundPayload({
      ...base,
      message: { type: "list", id: "ps:s1", title: "Sandwiches" },
    });
    expect(l.message.interactive.list_reply.id).toBe("ps:s1");
    const p: any = inboundPayload({ ...base, message: { type: "location", lat: 33.7, lon: 35.5 } });
    expect(p.message.location).toEqual({ latitude: 33.7, longitude: 35.5 });
    const v: any = inboundPayload({ ...base, message: { type: "voice", transcript: "shawarma" } });
    expect(v.message.type).toBe("audio");
    expect(v.message.kapso.transcript.text).toBe("shawarma");
  });

  it("posts the signature header and the event name, and never the secret", async () => {
    let seen: any;
    const f = (async (_u: string, init: any) => {
      seen = init;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await deliver("https://x.test/h", "topsecret", { a: 1 }, f);
    expect(r.status).toBe(200);
    expect(seen.headers["x-webhook-signature"]).toBe(sign("topsecret", seen.body));
    expect(seen.headers["x-webhook-event"]).toBe("whatsapp.message.received");
    expect(JSON.stringify(seen)).not.toContain("topsecret");
  });
});

describe("matching", () => {
  const card = toOut(
    row(
      {
        interactive: {
          type: "button",
          header: { type: "text", text: "New order #A1" },
          body: { text: "Pick up or delivery" },
          action: { buttons: [{ type: "reply", reply: { id: "c:order", title: "🍽️ Order" } }] },
        },
      },
      "interactive:button",
      "Pick up or delivery",
    ),
  );
  const list = toOut(
    row(
      {
        interactive: {
          type: "list",
          action: { sections: [{ rows: [{ id: "ps:s1", title: "Sandwiches" }] }] },
        },
      },
      "interactive:list",
    ),
  );

  it("reads buttons and list rows", () => {
    expect(card.options).toEqual([{ id: "c:order", title: "🍽️ Order" }]);
    expect(list.options).toEqual([{ id: "ps:s1", title: "Sandwiches" }]);
  });

  it("checks kind, text, buttons and language", () => {
    expect(
      mismatch({ kind: "button", text: ["pick up", "#a1"], buttons: ["c:order", "order"] }, card),
    ).toBe("");
    expect(mismatch({ kind: "list" }, card)).toMatch(/kind/);
    expect(mismatch({ not_text: "delivery" }, card)).toMatch(/has "delivery"/);
    expect(mismatch({ buttons: ["c:track"] }, card)).toMatch(/no option/);
    expect(mismatch({ text_any: ["zzz", "new order"] }, card)).toBe("");
    expect(mismatch({ text_re: "order #[A-Z]\\d" }, card)).toBe("");
    expect(mismatch({ lang: "en" }, card)).toBe("");
    expect(langOf("اهلا فيك")).toBe("ar");
    expect(langOf("Bonjour, voulez-vous commander ?")).toBe("fr");
    expect(langOf("Hello there")).toBe("en");
  });

  it("compares database values", () => {
    expect(valueMatches("placed", "placed")).toBe(true);
    expect(valueMatches(3, ">=2")).toBe(true);
    expect(valueMatches(3, "<2")).toBe(false);
    expect(valueMatches("ABC-1", "~^ABC")).toBe(true);
    expect(valueMatches(undefined, null)).toBe(true);
    expect(valueMatches("4.50", 4.5)).toBe(true);
    expect(valueMatches(true, true)).toBe(true);
  });

  it("renders templates and refuses a missing value", () => {
    expect(render("a {{cust.phone}} {{vars.x}}", { cust: { phone: "+9" }, vars: { x: "1" } })).toBe(
      "a +9 1",
    );
    expect(() => render("{{vars.nope}}", { vars: {} })).toThrow(/no value/);
  });
});

describe("scenario files", () => {
  const dir = `${process.cwd()}/tests/e2e/scenarios/`;
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

  it("has the nine starting scenarios of DECISIONS §36", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it("marks exactly five smoke scenarios (DECISIONS §36, test diet of 16 October)", () => {
    const smoke = files.filter(
      (f) => (parse(readFileSync(dir + f, "utf8")) as Scenario).smoke === true,
    );
    expect(smoke).toHaveLength(5);
  });

  for (const f of files) {
    it(`${f} is well formed`, () => {
      const sc = expand(parse(readFileSync(dir + f, "utf8")) as Scenario, `${dir}_parts`);
      expect(sc.name).toMatch(/^[a-z0-9-]+$/);
      expect(Object.keys(sc.personas).length).toBeGreaterThan(0);
      for (const [i, s] of sc.steps.entries()) {
        const actions = ["say", "tap", "pin", "voice", "cart", "sql", "wait_s"].filter(
          (k) => (s as any)[k] !== undefined,
        );
        expect(actions.length, `step ${i + 1} needs exactly one action`).toBeLessThanOrEqual(1);
        for (const k of Object.keys(s))
          expect(
            [
              "note",
              "say",
              "tap",
              "pin",
              "voice",
              "cart",
              "sql",
              "wait_s",
              "expect",
              "db",
              "timeout_s",
              "quiet_s",
            ],
            `step ${i + 1}: ${k}`,
          ).toContain(k);
        for (const p of [
          s.say?.as,
          s.tap?.as,
          s.pin?.as,
          s.voice?.as,
          s.cart?.as,
          ...(s.expect ?? []).map((e) => e.to ?? e.none),
        ])
          if (p) expect(sc.personas[p], `step ${i + 1}: persona ${p}`).toBeDefined();
      }
    });
  }
});

describe("toOut: CTA-URL messages (session 5g part E)", () => {
  it("carries the link in the text, so a scenario can capture the signed token", () => {
    const o = toOut(
      row(
        {
          type: "interactive",
          interactive: {
            type: "cta_url",
            body: { text: "Dash" },
            action: {
              name: "cta_url",
              parameters: {
                display_text: "Open menu",
                url: "https://alo-king.vercel.app/en/m/dash?t=Ab3_-Ab3_-Ab3_-Ab3_-Ab3_",
              },
            },
          },
        },
        "interactive:cta_url",
        "Dash",
      ),
    );
    expect(o.text).toContain("/m/dash?t=Ab3_-Ab3_-Ab3_-Ab3_-Ab3_");
    expect(o.options).toEqual([{ id: "url", title: "Open menu" }]);
  });
});

describe("toOut: templates (session 5b, DECISIONS §39.8)", () => {
  it("renders a template's text and quick replies the way the person would see them", () => {
    const o = toOut({
      id: 9,
      to_phone: "+99996100000009",
      kind: "template",
      body: "",
      payload: {
        type: "template",
        template: {
          name: "alo_order_delivered",
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: "AB3CD9" },
                { type: "text", text: "Alo Test Grill" },
              ],
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: "0",
              parameters: [{ type: "payload", payload: "rate:x:f5" }],
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: "2",
              parameters: [{ type: "payload", payload: "rcv:x:no" }],
            },
          ],
        },
      },
    });
    expect(o.text).toBe(
      "[template alo_order_delivered/en] Your order #AB3CD9 from Alo Test Grill was delivered. How was the food? Pick a rating below; it helps the shop.",
    );
    expect(o.options).toEqual([
      { id: "rate:x:f5", title: "Great" },
      { id: "rcv:x:no", title: "A problem" },
    ]);
  });
});

describe("catalogue messages and carts (session 5d, DECISIONS §39.12)", () => {
  it("a multi-product message shows each product as an option titled with its section", () => {
    const o = toOut({
      id: 3,
      to_phone: "+99996100000001",
      kind: "interactive:product_list",
      body: "Tap an item",
      payload: {
        interactive: {
          type: "product_list",
          header: { type: "text", text: "Alo Test Grill" },
          action: {
            catalog_id: "sim",
            sections: [
              {
                title: "Sides",
                product_items: [{ product_retailer_id: "p1" }, { product_retailer_id: "p2" }],
              },
            ],
          },
        },
      },
    });
    expect(o.options).toEqual([
      { id: "p1", title: "Sides" },
      { id: "p2", title: "Sides" },
    ]);
    expect(kindMatches("products", o.kind)).toBe(true);
  });
  it("a cart is delivered as WhatsApp's order message, with the price the catalogue showed", () => {
    const p: any = inboundPayload({
      phone: "+99996100000001",
      phoneNumberId: "123",
      message: {
        type: "order",
        catalogId: "sim",
        items: [
          { id: "p1", quantity: 2, price: 1.5 },
          { id: "p2", quantity: 1, price: null },
        ],
      },
    });
    expect(p.message.type).toBe("order");
    expect(p.message.order).toEqual({
      catalog_id: "sim",
      text: "",
      product_items: [
        { product_retailer_id: "p1", quantity: "2", item_price: "1.5", currency: "USD" },
        { product_retailer_id: "p2", quantity: "1" },
      ],
    });
  });
});
