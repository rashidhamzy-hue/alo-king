// The Concierge: the only customer-facing model. It reads, searches, asks, and proposes. It never commits.
//
// One model on the hot path, and no escalation (audit G1, point 10; recorded by SP1). Every call here uses the model the turn
// is given: MODEL_FAST (wrangler.jsonc). MODEL_SMART is configured but not used at run time: it refuses the forced tool choice
// that extractOrder() depends on (tool_choice {type: "tool"}), so it cannot take the reading. A reading that fails the
// contract goes to the open-question loop on the same model, which asks the customer or hands the chat to a person. Do not add
// a second model to the turn to "escalate": measure first, and change MODEL_FAST for every call if the evals say so.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { OrderIntent } from "./schemas";
import systemPrompt from "./prompts/concierge.md";

type ToolResult = Promise<unknown>;
export interface ConciergeTools {
  search_catalog(args: { query: string; source_hint?: string | null }): ToolResult;
  resolve_place(args: { village?: string | null; landmark?: string | null; verbatim?: string | null }): ToolResult;
  quote_order(args: { lines: { product_id: string; qty: number; modifiers?: string[]; note?: string | null; source_id?: string | null }[]; pickup?: boolean }): ToolResult;
  ask_location_pin(args: { text: string }): ToolResult;
  /** Approved food facts (1.11) for products, with their status, and optionally whether each meets restriction codes. */
  food_facts(args: { product_ids: string[]; restrictions?: string[] | null }): ToolResult;
  /** Creates the order from the last quote, moves it to awaiting_confirmation and sends the card. */
  send_confirmation(args: { payment_method?: "cod" | "whish" | "omt"; change_for_usd?: number | null; notes?: string | null }): ToolResult;
  /** price_of: product ids whose prices the system appends from the database. The model never writes an amount itself. */
  reply(args: { text: string; buttons?: { id: string; title: string }[]; price_of?: string[] }): ToolResult;
  handoff_human(args: { reason: string }): ToolResult;
  /** 1.21: WhatsApp's catalog view, one category as product lists, or one product. Built and sent by code; never confirms. */
  show_catalog(args: { category?: string | null; product_id?: string | null }): ToolResult;
}

const str = { type: "string" } as const, nstr = { type: ["string", "null"] } as const;
const { $schema: _drop, ...intentSchema } = z.toJSONSchema(OrderIntent, { io: "input" }) as Record<string, unknown>;
// Both calls of a turn send the same tool list and system prompt, so the second one reads them from the prompt cache.
const TOOL_DEFS: Anthropic.Tool[] = [
  { name: "extract_order", description: "Record the structured reading of the customer's messages (the OrderIntent contract).",
    input_schema: { type: "object", properties: { intent: intentSchema }, required: ["intent"] } },
  { name: "search_catalog", description: "Search products and merchant menus by what the customer said. Returns product_id, source_id, names, price, in_stock. reason is 'no_match' or 'merchant_not_onboarded' when nothing is found.",
    input_schema: { type: "object", properties: { query: str, source_hint: nstr }, required: ["query"] } },
  { name: "resolve_place", description: "Match a spoken village and landmark, and list the customer's saved places. Sets the delivery village for quote_order when it is recognised and served.",
    input_schema: { type: "object", properties: { village: nstr, landmark: nstr, verbatim: nstr } } },
  { name: "quote_order", description: "Price the order from the database: line totals, delivery fee, total in USD and LBP, ETA, and issues (out_of_stock with substitutes, below_minimum, closed, no_delivery_village, village_not_served). Pass product_id and source_id exactly as search_catalog returned them.",
    input_schema: { type: "object", properties: {
      lines: { type: "array", items: { type: "object", properties: { product_id: str, source_id: nstr, qty: { type: "number" }, modifiers: { type: "array", items: str }, note: nstr }, required: ["product_id", "qty"] } },
      pickup: { type: "boolean" } }, required: ["lines"] } },
  { name: "food_facts", description: "Approved food facts for up to 6 products: allergens, halal, vegetarian, vegan, fasting, ingredients, nutrition, each with its status (certified, declared, calculated) and source. Pass restrictions as codes (gluten, crustaceans, eggs, fish, peanuts, soy, milk, tree_nuts, celery, mustard, sesame, sulphites, lupin, molluscs, halal, vegetarian, vegan, fasting) to get, per product, meets true or false and each check's result: pass, fails or unknown. Unknown is never safe. The only source for any food statement.",
    input_schema: { type: "object", properties: { product_ids: { type: "array", items: str, maxItems: 6 }, restrictions: { type: ["array", "null"], items: str } }, required: ["product_ids"] } },
  { name: "ask_location_pin", description: "Send WhatsApp's location request button. Use for a first-time address or when resolve_place says needs_pin. Ends your turn.",
    input_schema: { type: "object", properties: { text: str }, required: ["text"] } },
  { name: "send_confirmation", description: "Create the order from the last quote_order result and send the order card with Confirm / Edit / Cancel buttons. Only works when that quote has ok=true. Ends your turn.",
    input_schema: { type: "object", properties: { payment_method: { type: "string", enum: ["cod", "whish", "omt"] }, change_for_usd: { type: ["number", "null"] }, notes: nstr } } },
  { name: "reply", description: "Send one text message, optionally with up to three buttons. Ends your turn. Never write a price, fee or total: the message is refused. To show prices, put the product ids in price_of and the system appends one priced line per product from the database.",
    input_schema: { type: "object", properties: { text: str, buttons: { type: "array", items: { type: "object", properties: { id: str, title: str }, required: ["id", "title"] } },
      price_of: { type: "array", items: str, maxItems: 6 } }, required: ["text"] } },
  { name: "handoff_human", description: "Pass the conversation to the operations lead. Ends your turn.",
    input_schema: { type: "object", properties: { reason: str }, required: ["reason"] } },
  { name: "show_catalog", description: "Send the WhatsApp catalog with pictures: no arguments for the whole catalog, `category` (a category name or code, in any language) for that category's products, or `product_id` for one product. The customer adds items to a cart there and sends it; the system then sends the order card. The message is written by the system. If it answers catalog_not_ready or a category error, carry on in words. Ends your turn.",
    input_schema: { type: "object", properties: { category: nstr, product_id: nstr } } },
];
const TERMINAL = new Set(["send_confirmation", "reply", "handoff_human", "ask_location_pin", "show_catalog"]);
const MAX_STEPS = 6;

export interface TurnInput {
  texts: string[];                                  // buffered messages of this turn, oldest first
  transcripts: { primary: string; secondary?: string }[];
  state: unknown;                                   // delivery village, open quote, recent exchange
}
/** What the open-question loop receives on top of the turn: the model's own reading and what the database made of it. */
export interface AskInput extends TurnInput { reading: OrderIntent | null; plan: unknown }
/** The slice of the Anthropic client the loop uses. Lets tests script the model. */
export interface ModelClient { messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } }
/** One model call, as agent_runs.trace.calls records it (SP1): which call, how long it took, and its tokens. */
export interface CallTiming { kind: "reading" | "ask"; ms: number; input: number; output: number; cache_read: number; cache_write: number }
/** input is the uncached input (the API's input_tokens); cache reads and writes are counted apart, as they are priced. */
export interface Usage { input: number; output: number; cacheRead?: number; cacheWrite?: number; calls?: CallTiming[] }

/**
 * The reading's effort (SP1). Haiku 5.5 thinks adaptively at effort medium by default, and the reading's output was about four
 * times the card path's on the ask path (A4). "low" is used only while the language-pack gate holds on it (item F1 at least
 * 0.90, zero wrong products, the demo message right): see docs/HANDOFF.md, session SP1. The open-question loop keeps the default.
 */
export const READING_EFFORT: "low" | "medium" = "low";

async function timedCall(client: ModelClient, body: Anthropic.MessageCreateParamsNonStreaming, kind: CallTiming["kind"]) {
  const t0 = Date.now();
  const res = await client.messages.create(body);
  const u = res.usage as Anthropic.Usage;
  const call: CallTiming = { kind, ms: Date.now() - t0, input: u.input_tokens, output: u.output_tokens,
                             cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 };
  return { res, call };
}
const usageOf = (calls: CallTiming[]): Usage => ({
  input: calls.reduce((s, c) => s + c.input, 0), output: calls.reduce((s, c) => s + c.output, 0),
  cacheRead: calls.reduce((s, c) => s + c.cache_read, 0), cacheWrite: calls.reduce((s, c) => s + c.cache_write, 0), calls });

const request = (model: string, messages: Anthropic.MessageParam[], extra: Partial<Anthropic.MessageCreateParamsNonStreaming> = {}) => ({
  model, max_tokens: 1024, tools: TOOL_DEFS,
  system: [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }],
  messages, ...extra,
});

/**
 * Parse once. One call, forced to extract_order, returns the structured reading of the turn. Nothing is sent and
 * nothing is searched here: plan_order() decides what happens next. A reading that fails the contract comes back as null
 * with the reasons, and the turn falls back to the open-question loop.
 */
export async function extractOrder(client: ModelClient, model: string, input: TurnInput):
    Promise<{ intent: OrderIntent | null; errors?: unknown; usage: Usage; rejected?: unknown }> {
  // 4096: a long order read as a string inside `intent` was cut off at 1024 tokens on the live model (1.22, 13 Nov).
  const { res, call: timing } = await timedCall(client, request(model, [{ role: "user", content: JSON.stringify(input) }],
    { tool_choice: { type: "tool", name: "extract_order" }, max_tokens: 4096, output_config: { effort: READING_EFFORT } }), "reading");
  const usage = usageOf([timing]);
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "extract_order");
  if (!call) return { intent: null, errors: "no_extract_order_call", usage };
  // The fast model sometimes sends the reading as a JSON string inside `intent` (84 of 986 live eval runs, 13 Nov): read it.
  let raw = (call.input as { intent?: unknown } | null)?.intent;
  let note: string | undefined;
  if (typeof raw === "string") {
    const fixed = parseLooseJson(raw);
    if (fixed !== undefined) raw = fixed;
    else note = `string intent, stop_reason ${res.stop_reason}, ${(raw as string).length} chars`;   // never the text itself: it is the customer's
  } else if (raw === undefined && call.input && typeof call.input === "object" && "lines" in (call.input as object)) {
    raw = call.input;                                   // the reading itself, without the `intent` wrapper
  }
  const parsed = OrderIntent.safeParse(raw);
  // `rejected` is the reading that failed, for the eval (synthetic messages) to inspect. The turn never stores or logs it.
  return parsed.success ? { intent: parsed.data, usage }
                        : { intent: null, errors: note ? [note, ...parsed.error.issues.slice(0, 4)] : parsed.error.issues.slice(0, 5), usage, rejected: raw };
}

/**
 * The fast model sometimes writes the reading as a JSON string, and sometimes that string is not quite JSON: an escaped
 * apostrophe ("Kellogg\'s"), a trailing comma, one closing brace too many at the end (72 of 1,972 live runs on 13 Nov), or a
 * closing bracket left off. Repairs those and nothing else; anything else stays refused.
 */
export function parseLooseJson(text: string): unknown {
  const attempt = (t: string) => { try { return { ok: true as const, v: JSON.parse(t) as unknown }; } catch { return { ok: false as const }; } };
  let r = attempt(text);
  if (r.ok) return r.v;
  let t = text.replace(/\\'/g, "'").replace(/,\s*([}\]])/g, "$1").trim();
  r = attempt(t);
  if (r.ok) return r.v;
  // one closer too many at the end: the model closed its outer wrapper inside the string ("...]}}")
  for (let cut = 1; cut <= 2 && /[}\]]$/.test(t); cut++) {
    t = t.slice(0, -1).trimEnd();
    r = attempt(t);
    if (r.ok) return r.v;
  }
  t = text.replace(/\\'/g, "'").replace(/,\s*([}\]])/g, "$1").trim();
  // close what is open, outside strings
  const stack: string[] = []; let inStr = false, esc = false;
  for (const c of t) {
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{" || c === "[") stack.push(c); else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) return undefined;                       // cut inside a string: not repaired
  t += stack.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  r = attempt(t.replace(/,\s*([}\]])/g, "$1"));
  return r.ok ? r.v : undefined;
}

/**
 * The ask loop's output cap (SP2). At 1024 a call that thought for long stopped at max_tokens before any tool, and the turn
 * went to a person with nothing sent (M1's gate runs; staging, 14 Nov). Only the tokens produced are billed.
 */
export const ASK_MAX_TOKENS = 4096;
/** Said to the model when a step reached nobody: free text, or nothing (SP2). Only a tool call reaches the customer. */
export const ANSWER_NOW = "Nothing has reached the customer: only a tool call does, never free text. Answer now with reply: one short answer, " +
  "or one clear question (with buttons when they help). Use ask_location_pin, send_confirmation or show_catalog instead when that is the answer, " +
  "and handoff_human only if you truly cannot help.";
/** extract_order is offered in the ask loop only so both calls share one cached tool list; the reading is already done. */
const EXTRACT_ANSWER = { ok: true, note: "The reading is already recorded, in `reading` (null when it could not be read: then use the customer's own " +
  "words in `texts`). Do not call extract_order again. Answer the customer now with reply, or another tool that ends the turn." };

/**
 * The tool loop. It runs only when plan_order answered "ask": something is ambiguous, missing or unavailable and a
 * question has to be worded. The model can search, quote, ask and propose a card; the database still decides what is true.
 *
 * SP2: every turn ends with something the customer receives, or with a person told and alerted. A step "stalls" when it reaches
 * nobody: cut at max_tokens (its content is dropped and never run: a cut tool call is half written), free text or nothing with
 * no tool call, or only extract_order. After the first stall the next call thinks less (effort low); after the second, and on
 * the last step whatever happened before, the call is forced to `reply`. A handoff then means the model truly could not answer.
 */
export async function runAskLoop(client: ModelClient, model: string, input: AskInput, tools: ConciergeTools):
    Promise<{ outcome: "ok" | "handoff"; reason?: string; usage: Usage }> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: JSON.stringify(input) }];
  const timings: CallTiming[] = [];
  let usage: Usage = usageOf(timings);
  let stalls = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const forceReply = stalls >= 2 || step === MAX_STEPS - 1;
    const extra: Partial<Anthropic.MessageCreateParamsNonStreaming> = { max_tokens: ASK_MAX_TOKENS,
      ...(stalls > 0 || forceReply ? { output_config: { effort: "low" as const } } : {}),
      ...(forceReply ? { tool_choice: { type: "tool" as const, name: "reply" } } : {}) };
    const { res, call: timing } = await timedCall(client, request(model, messages, extra), "ask");
    timings.push(timing); usage = usageOf(timings);
    // Cut at the cap: nothing in it is run (a tool call may be half written). Ask the same step again, thinking less.
    if (res.stop_reason === "max_tokens") { stalls++; continue; }
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: res.content.length ? res.content : [{ type: "text", text: "(no answer)" }] });
    if (calls.length === 0) {
      // Free text is never sent to the customer: only tools speak. Say so, and ask again.
      stalls++;
      messages.push({ role: "user", content: ANSWER_NOW });
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let done: { handoff?: string } | null = null;
    for (const call of calls) {
      let out: unknown;
      if (call.name === "extract_order") {
        out = EXTRACT_ANSWER;
      } else {
        const fn = (tools as unknown as Record<string, (a: unknown) => Promise<unknown>>)[call.name];
        try { out = fn ? await fn(call.input) : { ok: false, error: "unknown_tool" }; }
        catch (err) { out = { ok: false, error: String(err instanceof Error ? err.message : err) }; }
        // A terminal tool ends the turn only if it actually reached the customer.
        if (TERMINAL.has(call.name) && (out as { ok?: boolean } | null)?.ok !== false) {
          done = call.name === "handoff_human" ? { handoff: String((call.input as { reason?: unknown } | null)?.reason ?? "model_handoff").slice(0, 200) } : (done ?? {});
        }
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
    if (done) return done.handoff ? { outcome: "handoff", reason: done.handoff, usage } : { outcome: "ok", usage };
    if (calls.every((c) => c.name === "extract_order")) stalls++;        // a step spent on the reading that is already done
  }
  await tools.handoff_human({ reason: "agent_did_not_finish" });   // fail closed, to a person (turn.ts alerts ops)
  return { outcome: "handoff", reason: "agent_did_not_finish", usage };
}
