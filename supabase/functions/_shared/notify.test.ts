import { describe, expect, it } from "vitest";
import { notifyOrderStatus } from "./notify.ts";

// Minimal chainable fake of the Supabase client: records updates, answers maybeSingle from per-table rows.
function fake(rows: Record<string, any>, opts: { claim?: boolean } = {}) {
  const updates: { table: string; values: any }[] = [];
  const sb = { from(table: string) {
    const q: any = { _upd: false };
    for (const m of ["select", "eq", "neq", "or", "order", "limit", "is", "in"]) q[m] = () => q;
    q.update = (values: any) => { q._upd = true; updates.push({ table, values }); return q; };
    q.maybeSingle = async () => ({ data: rows[table] ?? null });
    q.then = (res: any) => res({ data: q._upd ? (opts.claim === false ? [] : [{ id: "x" }]) : null });
    return q;
  } };
  return { sb, updates };
}
const order = (status: string) => ({ id: "11111111-1111-1111-1111-111111111111", short_code: "AB12", vendor_id: "v", customer_phone: "96170000001", status, customer_notified_status: null });
const rows = (status: string) => ({ orders: order(status), customers: { last_inbound_at: new Date().toISOString(), language: "en" }, vendors: { name_en: "Al Tahouneh" }, vendor_profiles: { prep_time_min: 25 } });

describe("notifyOrderStatus: the deliberate set of status messages", () => {
  it("'preparing' sends nothing but is marked as handled, so the sweep does not come back for it", async () => {
    const { sb, updates } = fake(rows("preparing")); const sent: any[] = [];
    const r = await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111");
    expect(sent).toHaveLength(0);
    expect(r.sent).toBe(false); expect(r.reason).toMatch(/silent/);
    expect(updates.some((u) => u.table === "orders" && u.values.customer_notified_status === "preparing")).toBe(true);
  });
  it("accepted: exactly one text message with the ETA", async () => {
    const { sb } = fake(rows("accepted")); const sent: any[] = [];
    const r = await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111");
    expect(r.sent).toBe(true); expect(sent).toHaveLength(1); expect(sent[0].type).toBe("text"); expect(sent[0].text.body).toContain("25");
  });
  it("on the way: exactly one text message", async () => {
    const { sb } = fake(rows("out_for_delivery")); const sent: any[] = [];
    await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111", { trackBase: "https://t.example" });
    expect(sent).toHaveLength(1); expect(sent[0].text.body).toContain("https://t.example/");
  });
  it("on the way: the ETA comes from the restaurant and the customer's pin when both are known", async () => {
    const r = rows("out_for_delivery"); (r.orders as any).customer_lat = 33.7; (r.orders as any).customer_lng = 35.62; (r.vendors as any) = { name_en: "Al Tahouneh", latitude: 33.69, longitude: 35.55 };
    const { sb } = fake(r); const sent: any[] = [];
    await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111", { trackBase: "https://t.example" });
    expect(sent[0].text.body).toMatch(/about \d+ min/); expect(sent[0].text.body).toContain("https://t.example/");
  });
  it("on the way without any coordinates: still one message, no invented ETA", async () => {
    const { sb } = fake(rows("out_for_delivery")); const sent: any[] = [];
    await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111", { trackBase: "https://t.example" });
    expect(sent).toHaveLength(1); expect(sent[0].text.body).not.toMatch(/Arriving/);
  });
  it("delivered: exactly ONE message (the delivery text and the rating list together)", async () => {
    const { sb } = fake(rows("delivered")); const sent: any[] = [];
    const r = await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111");
    expect(r.sent).toBe(true); expect(sent).toHaveLength(1);
    expect(sent[0].interactive.type).toBe("list"); expect(sent[0].interactive.body.text).toMatch(/delivered/i);
  });
  it("a failed delivered send is released so it is retried (and nothing is half-sent)", async () => {
    const { sb, updates } = fake(rows("delivered")); const sent: any[] = [];
    const r = await notifyOrderStatus(sb, async (p) => { sent.push(p); return false; }, "11111111-1111-1111-1111-111111111111");
    expect(r.sent).toBe(false); expect(sent).toHaveLength(1);
    expect(updates.filter((u) => u.table === "orders").length).toBe(2); // claim + release
  });
  it("cancelled and rejected still send one message each", async () => {
    for (const st of ["cancelled", "rejected"]) { const { sb } = fake(rows(st)); const sent: any[] = []; await notifyOrderStatus(sb, async (p) => { sent.push(p); return true; }, "11111111-1111-1111-1111-111111111111"); expect(sent).toHaveLength(1); }
  });
});
