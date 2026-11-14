// The Concierge: the only customer-facing model. It reads, searches, asks, and proposes. It never commits.
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
export interface Usage { input: number; output: number }

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
  const res = await client.messages.create(request(model, [{ role: "user", content: JSON.stringify(input) }],
    { tool_choice: { type: "tool", name: "extract_order" }, max_tokens: 4096 }));
  const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
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
 * The tool loop. It runs only when plan_order answered "ask": something is ambiguous, missing or unavailable and a
 * question has to be worded. The model can search, quote, ask and propose a card; the database still decides what is true.
 */
export async function runAskLoop(client: ModelClient, model: string, input: AskInput, tools: ConciergeTools) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: JSON.stringify(input) }];
  const usage: Usage = { input: 0, output: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create(request(model, messages));
    usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) break;                  // free text is never sent to the customer: only tools speak
    messages.push({ role: "assistant", content: res.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    let done = false;
    for (const call of calls) {
      let out: unknown;
      if (call.name === "extract_order") {
        out = { ok: true, note: "the reading for this turn is already recorded; it is in `reading`" };
      } else {
        const fn = (tools as unknown as Record<string, (a: unknown) => Promise<unknown>>)[call.name];
        try { out = fn ? await fn(call.input) : { ok: false, error: "unknown_tool" }; }
        catch (err) { out = { ok: false, error: String(err instanceof Error ? err.message : err) }; }
        // A terminal tool ends the turn only if it actually reached the customer.
        if (TERMINAL.has(call.name) && (out as { ok?: boolean } | null)?.ok !== false) done = true;
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
    if (done) return { outcome: "ok" as const, usage };
  }
  await tools.handoff_human({ reason: "agent_did_not_finish" });   // fail closed, to a person
  return { outcome: "handoff" as const, usage };
}
