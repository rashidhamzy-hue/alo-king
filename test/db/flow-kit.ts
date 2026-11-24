// The customer-flow test rig on the real schema, shared by the B2 tests: a PGlite database with every migration and seed,
// a scripted model, the Durable Object with a fake storage, the real turn code, tools and gateway, and a recorder in place of
// Kapso's HTTP endpoint. Same wiring as concierge-flow.test.ts.
import { expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationDO, type Env } from "../../apps/gateway/src/index";
import { type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

export interface Ids { LABNEH: string; BREAD: string; HUB: string; BAAKLINE: string }

/** A database with the clock open all day, an exchange rate, and stock on every shelf. */
export async function openFlowDb(): Promise<{ db: TestDb; ids: Ids }> {
  const db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  const BAAKLINE = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  const HUB = (await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [BAAKLINE])).id;
  const LABNEH = (await db.one(`select id from products where name_en = 'Liban Lait Labneh Baladieh 900G'`)).id;
  const BREAD = (await db.one(`select id from products where name_en = 'Wooden Bakery Pita White Bread Big 800G'`)).id;
  await oldPicks(db);
  return { db, ids: { LABNEH, BREAD, HUB, BAAKLINE } };
}

/**
 * B1c (0138): «ربطتين خبز» and «لبنة ليبان ليه» take the house default now. The flow tests were written for the products the planner
 * chose before 0138 (the best sellers: Liban Lait labneh 450 g, Wooden Bakery pita medium), so those are this rig's defaults for
 * labneh and bread, in place of the proposed ones (Al Forno's pita). The other proposed defaults stay.
 */
export async function oldPicks(db: TestDb) {
  await db.pg.query(`update products set house_default = (sku in ('AK-0046', 'AK-0082')) where sku in ('AK-0046', 'AK-0051', 'AK-0080', 'AK-0081', 'AK-0082')`);
}

let toolSeq = 0;
export const use = (name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: "tool_use", id: `tu_${++toolSeq}`, name, input } as Anthropic.ToolUseBlock);
/** The forced first call: the model's reading of the turn, and nothing else. */
export const read = (intent: Record<string, unknown>) => [use("extract_order", { intent: { language: "ar_lb", ...intent } })];

export function scriptedModel(steps: Anthropic.ToolUseBlock[][]) {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const model = { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    seen.push(structuredClone(body));
    const content = steps[seen.length - 1] ?? [];
    return { id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason: content.length ? "tool_use" : "end_turn",
             stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Message;
  } } };
  return { model, seen };
}

function fakeState() {
  const store = new Map<string, unknown>();
  const storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    delete: async (k: string) => store.delete(k), setAlarm: async () => undefined };
  return { state: { storage } as unknown as DurableObjectState, store };
}

export interface Sent { url: string; body: any }
/** Replaces fetch with a recorder of what would have gone to Kapso. Media downloads are answered from `media`. */
/** CAT2: `refuse` answers a payload as Kapso's proxy would refuse it (e.g. 422 "Invalid message payload"); refused sends are in `refused`. */
export function recordKapso(media: Record<string, { bytes: Uint8Array; type: string }> = {}, refuse?: (body: any) => Response | null): Sent[] & { refused?: Sent[] } {
  const outbound: Sent[] & { refused?: Sent[] } = [];
  Object.defineProperty(outbound, "refused", { value: [], enumerable: false });   // kept off toEqual([]) in other tests
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (media[url]) return new Response(media[url].bytes, { status: 200, headers: { "content-type": media[url].type } });
    const body = JSON.parse(String(init?.body));
    const no = refuse?.(body);
    if (no) { outbound.refused!.push({ url, body }); return no; }
    outbound.push({ url, body });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${Math.random()}` }] }), { status: 200 });
  }));
  return outbound;
}

/** Stand-in for the private `media` bucket: what the worker uploaded, by bucket and key. */
export const bucket = new Map<string, { bytes: Uint8Array; contentType?: string }>();
const storage = { from: (b: string) => ({
  upload: async (path: string, bytes: Uint8Array, opts?: { contentType?: string }) => {
    bucket.set(`${b}/${path}`, { bytes, contentType: opts?.contentType }); return { data: { path }, error: null };
  } }) };

export const ENV = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };

let customerSeq = 0;
/** One fresh customer per call, so tests never see each other's orders. */
export function flow(db: TestDb, steps: Anthropic.ToolUseBlock[][], opts: { who?: { waUserId: string; phone?: string }; deps?: Partial<TurnDeps>; env?: Record<string, string> } = {}) {
  const n = ++customerSeq;
  const who = opts.who ?? { waUserId: `bsuid-b2-${n}`, phone: `+9617100${String(n).padStart(4, "0")}` };
  const shim = supabaseOver(db), m = scriptedModel(steps), s = fakeState();
  Object.assign(shim.client, { storage });
  const env = { BUFFER_SECONDS: "6", MODEL_FAST: "fast", ...ENV, ...opts.env, TEST_DEPS: { db: shim.client, model: m.model } } as unknown as Env;
  const conv = new ConversationDO(s.state, env);
  const event = (message: Record<string, unknown>) => ({
    message: { id: `wamid.b2.${n}.${Math.random()}`, timestamp: "1794390000", kapso: { direction: "inbound", origin: "cloud_api" }, ...message },
    conversation: { id: `conv_b2_${n}`, contact_name: "Test" }, phone_number_id: "PN_CUSTOMER" });
  const inbound = (message: Record<string, unknown>) =>
    new Request("https://do/inbound", { method: "POST", body: JSON.stringify({ line: "customer", who, event: event(message) }) });
  const customer = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone ?? null, p_name: "Test" });
  /** The turn code, wired as index.ts wires it, for tests that need to pass extra dependencies. */
  const deps: TurnDeps = { db: shim.client, model: m.model, modelName: "fast", send: (req) => gatewaySend(shim.client, ENV, req), ...opts.deps };
  const pending = (message: Record<string, unknown>): Pending[] => [{ line: "customer", who, event: event(message) as any }];
  /** Sends one message and runs the turn (the buffer's alarm), as the Durable Object would. */
  const say = async (message: Record<string, unknown>) => { await conv.fetch(inbound(message)); await conv.alarm(); };
  return { ...m, conv, who, rpcCalls: shim.log.rpc, client: shim.client, customer, inbound, deps, pending, say,
           text: (body: string) => say({ type: "text", text: { body } }),
           tap: (id: string, title = "x") => say({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }) };
}

/** A customer with a pinned place in Baakline (so a card goes straight out). */
export async function pinned(db: TestDb, t: ReturnType<typeof flow>, village: string) {
  const c = await t.customer();
  await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  return c;
}

/** The ledger must always sum to zero, per transaction and overall. */
export async function expectLedgerBalanced(db: TestDb) {
  expect(Number((await db.one(`select coalesce(sum(usd_equiv), 0) as s from ledger_entries`)).s)).toBeCloseTo(0, 2);
  expect(await db.all(`select txn_id from ledger_entries group by txn_id having abs(sum(usd_equiv)) > 0.005`)).toEqual([]);
}
