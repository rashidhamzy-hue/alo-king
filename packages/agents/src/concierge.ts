// The Concierge: the only customer-facing model. It reads, searches, asks, and proposes. It never commits.
import Anthropic from "@anthropic-ai/sdk";
import { OrderIntent } from "./schemas";
import systemPrompt from "./prompts/concierge.md";

type ToolResult = Promise<unknown>;
export interface ConciergeTools {
  search_catalog(args: { query: string; source_hint?: string | null }): ToolResult;
  resolve_place(args: { village?: string | null; landmark?: string | null; verbatim?: string | null }): ToolResult;
  quote_order(args: { lines: { product_id: string; qty: number; modifiers?: string[]; note?: string | null; source_id?: string | null }[]; pickup?: boolean }): ToolResult;
  ask_location_pin(args: { text: string }): ToolResult;
  /** Creates the order from the last quote, moves it to awaiting_confirmation and sends the card. */
  send_confirmation(args: { payment_method?: "cod" | "whish" | "omt"; change_for_usd?: number | null; notes?: string | null }): ToolResult;
  reply(args: { text: string; buttons?: { id: string; title: string }[] }): ToolResult;
  handoff_human(args: { reason: string }): ToolResult;
}

const str = { type: "string" } as const, nstr = { type: ["string", "null"] } as const;
const TOOL_DEFS: Anthropic.Tool[] = [
  { name: "extract_order", description: "Record the structured reading of the customer's message (the OrderIntent contract). Always call this first.",
    input_schema: { type: "object", properties: { intent: { type: "object" } }, required: ["intent"] } },
  { name: "search_catalog", description: "Search products and merchant menus by what the customer said. Returns product_id, source_id, names, price, in_stock. reason is 'no_match' or 'merchant_not_onboarded' when nothing is found.",
    input_schema: { type: "object", properties: { query: str, source_hint: nstr }, required: ["query"] } },
  { name: "resolve_place", description: "Match a spoken village and landmark, and list the customer's saved places. Sets the delivery village for quote_order when it is recognised and served.",
    input_schema: { type: "object", properties: { village: nstr, landmark: nstr, verbatim: nstr } } },
  { name: "quote_order", description: "Price the order from the database: line totals, delivery fee, total in USD and LBP, ETA, and issues (out_of_stock with substitutes, below_minimum, closed, no_delivery_village, village_not_served). Pass product_id and source_id exactly as search_catalog returned them.",
    input_schema: { type: "object", properties: {
      lines: { type: "array", items: { type: "object", properties: { product_id: str, source_id: nstr, qty: { type: "number" }, modifiers: { type: "array", items: str }, note: nstr }, required: ["product_id", "qty"] } },
      pickup: { type: "boolean" } }, required: ["lines"] } },
  { name: "ask_location_pin", description: "Send WhatsApp's location request button. Use for a first-time address or when resolve_place says needs_pin. Ends your turn.",
    input_schema: { type: "object", properties: { text: str }, required: ["text"] } },
  { name: "send_confirmation", description: "Create the order from the last quote_order result and send the order card with Confirm / Edit / Cancel buttons. Only works when that quote has ok=true. Ends your turn.",
    input_schema: { type: "object", properties: { payment_method: { type: "string", enum: ["cod", "whish", "omt"] }, change_for_usd: { type: ["number", "null"] }, notes: nstr } } },
  { name: "reply", description: "Send one text message, optionally with up to three buttons. Ends your turn.",
    input_schema: { type: "object", properties: { text: str, buttons: { type: "array", items: { type: "object", properties: { id: str, title: str }, required: ["id", "title"] } } }, required: ["text"] } },
  { name: "handoff_human", description: "Pass the conversation to the operations lead. Ends your turn.",
    input_schema: { type: "object", properties: { reason: str }, required: ["reason"] } },
];
const TERMINAL = new Set(["send_confirmation", "reply", "handoff_human", "ask_location_pin"]);
const MAX_STEPS = 6;

export interface TurnInput {
  texts: string[];                                  // buffered messages of this turn, oldest first
  transcripts: { primary: string; secondary?: string }[];
  state: unknown;                                   // delivery village, open quote, recent exchange
}
/** The slice of the Anthropic client the loop uses. Lets tests script the model. */
export interface ModelClient { messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } }

export async function runConcierge(client: ModelClient, model: string, input: TurnInput, tools: ConciergeTools) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: JSON.stringify(input) }];
  let intent: OrderIntent | undefined;
  const usage = { input: 0, output: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model, max_tokens: 1024, tools: TOOL_DEFS,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
    });
    usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) break;                  // free text is never sent to the customer: only tools speak
    messages.push({ role: "assistant", content: res.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    let done = false;
    for (const call of calls) {
      let out: unknown;
      if (call.name === "extract_order") {
        const parsed = OrderIntent.safeParse((call.input as { intent: unknown }).intent);
        intent = parsed.success ? parsed.data : intent;
        out = parsed.success ? { ok: true } : { ok: false, errors: parsed.error.issues.slice(0, 5) };
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
    if (done) return { outcome: "ok" as const, intent, usage };
  }
  await tools.handoff_human({ reason: "agent_did_not_finish" });   // fail closed, to a person
  return { outcome: "handoff" as const, intent, usage };
}
