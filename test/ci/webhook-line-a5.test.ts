// G1-15 at the Worker's door: a signed message event that does not say which number it came to is refused (it used to pass).
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker, { type Env } from "../../apps/gateway/src/index";

const CUSTOMER = "1378974041965966", OPS = "597907523413541", SECRET = "s3cret";
const env = { KAPSO_WEBHOOK_SECRET_CUSTOMER: SECRET, KAPSO_WEBHOOK_SECRET_OPS: SECRET, PHONE_NUMBER_ID_CUSTOMER: CUSTOMER, PHONE_NUMBER_ID_OPS: OPS } as unknown as Env;
const fixture = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kapso/${p}`, import.meta.url)), "utf8")).body as Record<string, unknown>;
async function post(line: "customer" | "ops", event: string, body: unknown) {
  const raw = JSON.stringify(body);
  const res = await worker.fetch(new Request(`https://gw/webhooks/kapso/${line}`, { method: "POST", body: raw,
    headers: { "X-Webhook-Signature": createHmac("sha256", SECRET).update(raw).digest("hex"), "X-Webhook-Event": event, "X-Idempotency-Key": "k" } }), env, {} as ExecutionContext);
  return { status: res.status, text: await res.text() };
}

describe("the webhook's right-number check", () => {
  const base = fixture("whatsapp.message.received/api-text-01.json");
  const { phone_number_id: _drop, ...without } = base;
  it("refuses a signed message event with no phone_number_id", async () => {
    expect(await post("customer", "whatsapp.message.received", without)).toEqual({ status: 400, text: "no phone_number_id" });
    expect(await post("customer", "whatsapp.message.delivered", { ...without, phone_number_id: "" })).toEqual({ status: 400, text: "no phone_number_id" });
  });
  it("still refuses the other line's number, and a batch with one bad item", async () => {
    expect(await post("customer", "whatsapp.message.received", { ...base, phone_number_id: OPS })).toEqual({ status: 400, text: "wrong line" });
    expect(await post("ops", "whatsapp.message.received", { ...base, phone_number_id: CUSTOMER })).toEqual({ status: 400, text: "wrong line" });
    expect(await post("customer", "whatsapp.message.received", { batch: true, data: [{ ...base, phone_number_id: CUSTOMER }, without] })).toEqual({ status: 400, text: "no phone_number_id" });
  });
  it("an unsigned one is still a 401 before anything else", async () => {
    const res = await worker.fetch(new Request("https://gw/webhooks/kapso/customer", { method: "POST", body: JSON.stringify(without), headers: { "X-Webhook-Signature": "00" } }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });
});
