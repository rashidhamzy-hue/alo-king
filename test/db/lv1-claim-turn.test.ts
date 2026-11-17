// Session LV1: "Is this your place? Claim it" on the customer line. The website opens our WhatsApp with "Claim <listing_id>" already typed; the turn
// reads it BY CODE, before any model: a staff case with the listing and the sender, a fixed reply that we will be in touch, and nothing else. The
// model is scripted so that any call to it is a failure of this test. We never message a listed number (there is none): the owner's own message
// starts the thread, which is also what keeps invariant 17. On the real migrations; invented numbers only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { ar, en, fr } from "@ak/agents/messages";
import type { ConversationState } from "@ak/agents/concierge-tools";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let pickA: any; let pickB: any;
beforeAll(async () => {
  db = await openTestDb();
  pickA = await db.one(`select * from listings where village = 'Baakleen' and kind = 'bakery' order by km_from_hub limit 1`);
  pickB = await db.one(`select * from listings where listing_id like '3ala-el-fahem%'`);
}, 120_000);

let toolSeq = 0;
function scriptedModel(steps: { tools?: [string, unknown][] }[]) {
  const seen: unknown[] = [];
  const model = { messages: { create: async (body: unknown) => {
    seen.push(structuredClone(body));
    const s = steps[seen.length - 1] ?? {};
    const content = (s.tools ?? []).map(([name, input]) => ({ type: "tool_use", id: `tu_${++toolSeq}`, name, input }));
    return { id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason: content.length ? "tool_use" : "end_turn",
             stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Message;
  } } };
  return { model, seen };
}

let n = 0;
function customer(steps: { tools?: [string, unknown][] }[] = [], lang?: "ar" | "en" | "fr") {
  const k = ++n;
  const who = { waUserId: `bsuid-lv1-${k}`, phone: `+9617310${String(k).padStart(4, "0")}` };
  const shim = supabaseOver(db), m = scriptedModel(steps);
  const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
  const deps: TurnDeps = { db: shim.client, model: m.model as any, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req),
                           capacity: { backoffMs: [1, 1, 1], sleep: async () => undefined } };
  const state: ConversationState = lang ? { lang } : {};
  const event = (message: Record<string, unknown>): Pending[] => [{ line: "customer", who, event: { phone_number_id: "PN_CUSTOMER",
    conversation: { id: `c${k}`, contact_name: "Test" },
    message: { id: `wamid.lv1.${k}.${Math.random()}`, timestamp: "0", kapso: { direction: "inbound", origin: "cloud_api" }, ...message } } as any }];
  const text = (body: string) => event({ type: "text", text: { body } });
  const conv = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone, p_name: "Test" });
  return { ...m, deps, state, who, text, conv, turn: (p: Pending[]) => runTurn(deps, p, state) };
}

let outbound: { url: string; body: any }[];
beforeEach(() => {
  outbound = []; toolSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    outbound.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${Math.random()}` }] }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const bodies = () => outbound.map((o) => o.body.text?.body ?? o.body.interactive?.body?.text ?? "");

describe("Claim <listing_id>, read by code before any model", () => {
  it("opens a staff case with the listing and the sender, tells the sender we will be in touch, and calls no model", async () => {
    const t = customer([], "en");
    const r = await t.turn(t.text(`Claim ${pickA.listing_id}`));
    expect(r.outcome).toBe("claim");
    expect(t.seen).toHaveLength(0);                                              // no model
    expect(bodies()).toEqual([en.fixed.listingClaimed(pickA.name)]);
    const c = await t.conv();
    const cases = await db.all<any>(`select kind, state, topic, source from handoffs where conversation_id = $1`, [c.conversation_id]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ kind: "other", state: "open", source: "listing_claim" });
    expect(cases[0].topic).toContain(pickA.listing_id);
    const claim = await db.one<any>(`select listing_id, party_id, conversation_id, wamid from listing_claims where conversation_id = $1`, [c.conversation_id]);
    expect(claim).toMatchObject({ listing_id: pickA.listing_id, party_id: c.party_id });
    expect(claim.wamid).toMatch(/^wamid\.lv1\./);
    // the case reaches staff at once (open hours or not, the ladder is HO1's); the listing is untouched
    expect((await db.one<any>(`select hidden_at from listings where listing_id = $1`, [pickA.listing_id])).hidden_at).toBeNull();
  });

  it("answers in the sender's language: Arabic, English or French", async () => {
    for (const [lang, m] of [["ar", ar], ["en", en], ["fr", fr]] as const) {
      outbound.length = 0;
      const t = customer([], lang);
      expect((await t.turn(t.text(`claim ${pickB.listing_id}`))).outcome).toBe("claim");   // an Arabic listing id (it has Arabic letters in it)
      expect(bodies()).toEqual([m.fixed.listingClaimed(pickB.name)]);
    }
  });

  it("the reply says we will be in touch and promises nothing: no ordering, no price, no 'approved'", () => {
    for (const m of [ar, en, fr]) {
      const line = m.fixed.listingClaimed("Test Place");
      expect(line).toContain("Test Place");
      expect(line).not.toMatch(/\$|order|commande|اطلب|طلب|approved|موافق|verified|vérifié|تم التحقق/i);
    }
  });

  it("the same person sending it again is the same claim: the same reply and no second case", async () => {
    const t = customer([], "en");
    await t.turn(t.text(`Claim ${pickA.listing_id}`));
    await t.turn(t.text(`Claim ${pickA.listing_id}`));
    expect(bodies()).toEqual([en.fixed.listingClaimed(pickA.name), en.fixed.listingClaimed(pickA.name)]);
    const c = await t.conv();
    expect(Number((await db.one<any>(`select count(*)::int as n from handoffs where conversation_id = $1`, [c.conversation_id])).n)).toBe(1);
    expect(Number((await db.one<any>(`select count(*)::int as n from listing_claims where conversation_id = $1`, [c.conversation_id])).n)).toBe(1);
    expect(t.seen).toHaveLength(0);
  });

  it("is not a claim unless it is exactly 'Claim' and a listing we know: anything else goes the Concierge's way", async () => {
    const t = customer([{ tools: [["extract_order", { intent: { language: "en", lines: [], intent: "question" } }]] }, { tools: [["reply", { text: "Sure." }]] }], "en");
    const r = await t.turn(t.text("Claim refund"));
    expect(r.outcome).not.toBe("claim");
    expect(t.seen.length).toBeGreaterThan(0);                                    // the model was asked: it is an ordinary message
    const c = await t.conv();
    expect(Number((await db.one<any>(`select count(*)::int as n from listing_claims where party_id = $1`, [c.party_id])).n)).toBe(0);
    expect(bodies().some((b) => b === en.fixed.listingClaimed("x"))).toBe(false);
  });

  it("STOP still wins, and a claim never starts a message to anyone else", async () => {
    const t = customer([], "en");
    expect((await t.turn(t.text("STOP"))).outcome).toBe("opt_out");
    expect(t.seen).toHaveLength(0);
    // every message that went out went to the sender's own number, on the customer line: none to a listed number (there is none to send to)
    outbound.length = 0;
    const t2 = customer([], "en");
    await t2.turn(t2.text(`Claim ${pickA.listing_id}`));
    expect(outbound.length).toBe(1);
    expect(outbound[0]!.body.to).toBe(t2.who.phone);
    expect(outbound.every((o) => o.url.includes("PN_CUSTOMER"))).toBe(true);        // never the ops number (invariant 9)
  });
});
