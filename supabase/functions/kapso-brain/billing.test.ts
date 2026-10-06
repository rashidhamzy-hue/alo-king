import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isOutboundEvent, isStatusEvent, statusRows } from "./billing.ts";

const status = (st: string, extra: Record<string, unknown> = {}) => ({ id: "wamid.A1", status: st, timestamp: "1791224989", recipient_id: "9613956917", ...extra });
const evt = (statuses: any[], over: Record<string, unknown> = {}) => ({
  message: { id: "wamid.A1", timestamp: "1791224988", type: "interactive", to: "9613956917", interactive: { body: { text: "SECRET BODY TEXT" } }, kapso: { direction: "outbound", status: statuses.at(-1).status, statuses }, ...over },
  conversation: { phone_number: "9613956917", phone_number_id: "1384772384720496" }, phone_number_id: "1384772384720496",
});
const PRICED = { pricing: { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service" } };

describe("isStatusEvent", () => {
  it.each(["whatsapp.message.sent", "whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.message.failed"])("%s by header", (h) => expect(isStatusEvent(h, evt([status("sent")]))).toBe(true));
  it("whatsapp.message.received is never a status event", () => expect(isStatusEvent("whatsapp.message.received", { message: { from: "961", kapso: { direction: "inbound" } } })).toBe(false));
  it("without a header: an outbound message with a status history is one; an inbound message or a bare body is not", () => {
    expect(isStatusEvent(null, evt([status("sent")]))).toBe(true);
    expect(isStatusEvent(null, { message: { id: "x", from: "9613956917", type: "text", kapso: { direction: "inbound" } } })).toBe(false);
    expect(isStatusEvent(null, {})).toBe(false);
    expect(isStatusEvent(null, null)).toBe(false);
  });
  it("isOutboundEvent: anything we sent is outbound, a customer message is not", () => {
    expect(isOutboundEvent(evt([status("sent")]))).toBe(true);
    expect(isOutboundEvent({ message: { from: "961", kapso: { direction: "inbound" } } })).toBe(false);
    expect(isOutboundEvent({})).toBe(false); expect(isOutboundEvent(null)).toBe(false);
  });
  it("a batch of received messages is not a status event", () => expect(isStatusEvent(null, { batch: true, data: [{ message: { from: "1" } }] })).toBe(false));
});

describe("statusRows: what is stored per outbound message", () => {
  it("one row per status with the pricing fields, the error code and the recipient, and nothing else about the content", () => {
    const rows = statusRows(evt([status("sent", PRICED), status("delivered", PRICED)]));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ wamid: "wamid.A1", status: "delivered", phone_number_id: "1384772384720496", to_phone: "9613956917", message_type: "interactive", template_name: null,
      billable: false, pricing_type: "free_customer_service", pricing_category: "service", pricing_model: "PMP", error_code: null, status_at: new Date(1791224989 * 1000).toISOString() });
    expect(JSON.stringify(rows)).not.toContain("SECRET BODY TEXT"); // no message content, ever
  });
  it("billable true is kept as true; a missing pricing object gives nulls (not false)", () => {
    const [a] = statusRows(evt([status("sent", { pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" } })]));
    expect(a.billable).toBe(true); expect(a.pricing_category).toBe("marketing"); expect(a.pricing_type).toBe("regular");
    const [b] = statusRows(evt([status("failed", { errors: [{ code: 131049, title: "t", message: "SECRET ERROR TEXT" }] })]));
    expect(b.billable).toBeNull(); expect(b.pricing_category).toBeNull(); expect(b.error_code).toBe(131049);
    expect(JSON.stringify(b)).not.toContain("SECRET ERROR TEXT");
  });
  it("template messages keep the template name (not its content)", () => {
    const [r] = statusRows(evt([status("sent", PRICED)], { type: "template", template: { name: "alo_offer_ar", language: { code: "ar" }, components: [{ type: "body", parameters: [{ text: "PRIVATE OFFER TEXT" }] }] } }));
    expect(r.message_type).toBe("template"); expect(r.template_name).toBe("alo_offer_ar"); expect(JSON.stringify(r)).not.toContain("PRIVATE OFFER TEXT");
  });
  it("the recipient is digits only, from message.to, conversation or the status; unusable input gives no rows, never a throw", () => {
    expect(statusRows(evt([status("sent")], { to: "+961 3 956 917" }))[0].to_phone).toBe("9613956917");
    expect(statusRows({ message: { id: "w", kapso: { direction: "outbound", statuses: [status("sent")] } }, conversation: { phone_number: "9613956917" } })[0].to_phone).toBe("9613956917");
    for (const bad of [null, undefined, {}, { message: {} }, { message: { id: "w", kapso: { statuses: "nope" } } }, { message: { kapso: { statuses: [{}] } } }]) expect(() => statusRows(bad as any)).not.toThrow();
    expect(statusRows({ message: { id: "w", kapso: { direction: "outbound", statuses: [{ status: "sent" }, { id: "w" }, 5] } } }).map((r) => r.status)).toEqual(["sent"]); // the status without an id takes the message id; entries without a status or that are not objects are skipped
  });
  it("only outbound messages are recorded (an inbound event never writes billing rows)", () => {
    expect(statusRows({ message: { id: "w", from: "9613956917", kapso: { direction: "inbound", statuses: [status("read")] } } })).toEqual([]);
  });
});

const ROOT = resolve(__dirname, "../../..");
describe("wiring and storage", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  it("status webhooks are handled before the inbound pipeline and never reach handleEvent", () => {
    const iStatus = src.indexOf("isStatusEvent(");
    expect(iStatus).toBeGreaterThan(0);
    expect(iStatus).toBeLessThan(src.indexOf("await handleEvent(body, evt"));
    expect(src.slice(iStatus, iStatus + 700)).toMatch(/message_billing_log/);
  });
  it("per-event routing: batches of statuses are recorded, mixed batches keep only inbound events for the pipeline, and outbound events never start a turn", () => {
    const i = src.indexOf("const statusEvts = all.filter(");
    expect(i).toBeGreaterThan(0);
    const seg = src.slice(i, i + 900);
    expect(seg).toMatch(/isStatusEvent\(evHeader, e\) \|\| isOutboundEvent\(e\)/);
    expect(seg).toMatch(/events = all\.filter\(\(e: any\) => !statusEvts\.includes\(e\)\)/);
    expect(seg).toMatch(/flatMap\(\(e: any\) => statusRows\(e\)\)/);
  });
  it("'delete my data' and the 90-day retention clear the phone / the rows", () => {
    expect(src).toMatch(/message_billing_log"\)\.update\(\{ to_phone: null \}\)\.eq\("to_phone", phone\)/);
    expect(src).toMatch(/message_billing_log"\)\.delete\(\)\.lt\("created_at"/);
  });
  const mig = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => /message_billing_log/.test(f)).map((f) => readFileSync(resolve(ROOT, "supabase/migrations", f), "utf8")).join("\n");
  it("the migration exists, keeps RLS on with no anon/authenticated access, and stores no message content columns", () => {
    expect(mig).toMatch(/create table if not exists public\.message_billing_log/i);
    expect(mig).toMatch(/enable row level security/i);
    expect(mig).toMatch(/revoke all on .*message_billing_log.* from anon, authenticated/is);
    const cols = mig.slice(mig.search(/create table if not exists public\.message_billing_log/i), mig.indexOf(");", mig.search(/create table if not exists public\.message_billing_log/i)));
    expect(cols).not.toMatch(/\b(body|content|text_body|message_text|payload)\b/i);
  });
  it("the cost view reports counts from Meta's flags and only prices them with rates the owner entered (none are invented)", () => {
    expect(mig).toMatch(/create or replace view public\.message_cost_per_order/i);
    expect(mig).toMatch(/create table if not exists public\.meta_rates/i);
    expect(mig).not.toMatch(/insert into public\.meta_rates/i);
    expect(mig).toMatch(/message_cost_per_order with \(security_invoker = on\)/i);
    expect(mig).toMatch(/min\(status_at\) over \(partition by wamid\)/i); // the sent time decides the window, not a later read
    expect(mig).toMatch(/order by wamid, \(billable is null\)/i); // a row that carries pricing wins over one without
  });
});
