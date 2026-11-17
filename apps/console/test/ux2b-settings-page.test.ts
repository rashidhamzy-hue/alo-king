// UX2b: the Settings page. Admin only; every change through change_setting() (0231), logged with who, when and why; the two-person rules wait for
// a second person on the Approve page; the page can change only what the database lists as editable.
import { beforeAll, describe, expect, it } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
const who = async (role: "admin" | "ops_lead" | "picker", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };
const setting = async (k: string) => (await r.db.one(`select setting($1) as v`, [k])).v;
beforeAll(async () => { r = await rig(); }, 120_000);

describe("who", () => {
  it("is for the admin only: an ops lead and a picker are refused the page and the post; it is in the admin's menu only", async () => {
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia"); const admin = await who("admin", "Rasheed");
    for (const x of [lead, picker]) {
      expect((await x.b.get("/settings")).status).toBe(403);
      expect((await x.b.post("/settings/change", { key: "timers", field: "draft_min", value: "50", reason: "no" }, { follow: false })).status).toBe(403);
      expect((await x.b.get("/")).text).not.toContain('href="/settings"');
    }
    expect((await admin.b.get("/settings")).status).toBe(200);
    expect((await admin.b.get("/")).text).toContain('href="/settings"');
  });
});

describe("the page", () => {
  it("groups hours, fees, timers, cash caps, pickup place, escalation steps, two-person limits and switches, with each value", async () => {
    const admin = await who("admin", "Rasheed2");
    const t = (await admin.b.get("/settings")).text;
    for (const g of ["Hours and minimum order", "Fees", "Timers", "Cash caps", "Pickup place", "Escalation steps", "Two-person limits", "Switches"]) expect(t, g).toContain(g);
    expect(t).toContain("A packaged item is sold only after its label is read and approved");
    expect(t).toContain("Search by meaning (embeddings)");
    expect(t).toMatch(/Soft cap: warn above[\s\S]*?\$100\.00/); expect(t).toMatch(/Hard cap: no new cash order above[\s\S]*?\$150\.00/);
    expect(t).toMatch(/Opens[\s\S]*?08:00/); expect(t).toMatch(/Step 2: the founder is alerted after[\s\S]*?5/);
    expect(t).toContain('href="/staff"'); expect(t).toContain('href="/zones"'); expect(t).toContain('href="/windows"');
    expect(t).not.toMatch(/<script(?![^>]*\bsrc=)|<style|\sstyle="/);
  });
  it("says which are two-person, and has no field for the marketing switch or anything off the list", async () => {
    const admin = await who("admin", "Rasheed3");
    const t = (await admin.b.get("/settings")).text;
    expect(t).toContain("two-person");
    expect(t).not.toContain('name="key" value="marketing"');
    expect(t).not.toContain('value="sim_monthly_cap_usd"');
  });
});

describe("changing a setting", () => {
  it("saves a plain one at once, logs who and when, and shows it in the log and on the setting", async () => {
    const admin = await who("admin", "Rasheed4");
    await admin.b.get("/settings");
    const res = await admin.b.post("/settings/change", { key: "timers", field: "draft_min", value: "75", reason: "longer drafts for the pilot" });
    expect(flashOf(res.text)).toBe("Saved: A draft is dropped after is now 75 min.");
    expect((await setting("timers")).draft_min).toBe(75);
    expect(res.text).toMatch(/Last changed by Rasheed4, /);
    expect(res.text).toMatch(/<td>Rasheed4<\/td>[\s\S]*longer drafts for the pilot/);
    const log = await r.db.rpc("settings_log", { p_limit: 1 });
    expect(log[0]).toMatchObject({ key: "timers", field: "draft_min", by_name: "Rasheed4", reason: "longer drafts for the pilot" });
    const logged = (await r.actions()).filter((a: any) => a.action === "setting_change").map((a: any) => a.phase);
    expect(logged).toEqual(["intent", "done"]);                                          // the action log first, then the outcome
  });
  it("changes hours, the minimum, the pickup place and the escalation steps by their own types", async () => {
    const admin = await who("admin", "Rasheed5");
    await admin.b.get("/settings");
    expect(flashOf((await admin.b.post("/settings/change", { key: "hours", field: "open", value: "07:30", reason: "earlier opening" })).text)).toBe("Saved: Opens is now 07:30.");
    expect(flashOf((await admin.b.post("/settings/change", { key: "min_order_usd", field: "", value: "6.5", reason: "pilot minimum" })).text)).toBe("Saved: Minimum order is now $6.50.");
    expect(flashOf((await admin.b.post("/settings/change", { key: "pickup", field: "place_en", value: "Hub counter, Baakline", reason: "where pickup is" })).text)).toBe("Saved: Pickup place (English) is now Hub counter, Baakline.");
    expect(flashOf((await admin.b.post("/settings/change", { key: "support", field: "claim_alert_min", value: "4", reason: "slower first alert" })).text)).toBe("Saved: Step 1: the ops lead is alerted after is now 4 min.");
    expect((await setting("hours")).open).toBe("07:30"); expect(Number(await setting("min_order_usd"))).toBe(6.5);
    expect((await setting("pickup")).place_en).toBe("Hub counter, Baakline"); expect((await setting("support")).claim_alert_min).toBe(4);
    expect(flashOf((await admin.b.post("/settings/change", { key: "hours", field: "open", value: "07:30", reason: "the same again" })).text)).toBe("Nothing changed: Opens already is 07:30.");
  });
  it("refuses a missing reason, a value out of bounds, an unknown setting and the marketing lock", async () => {
    const admin = await who("admin", "Rasheed6");
    await admin.b.get("/settings");
    expect(flashOf((await admin.b.post("/settings/change", { key: "timers", field: "draft_min", value: "80", reason: "" })).text)).toBe("Write why: the reason is logged with your name.");
    expect(flashOf((await admin.b.post("/settings/change", { key: "timers", field: "draft_min", value: "0", reason: "too low" })).text)).toMatch(/^The database refused: VALUE_INVALID/);
    expect(flashOf((await admin.b.post("/settings/change", { key: "timers", field: "draft_min", value: "abc", reason: "not a number" })).text)).toBe("Type a number.");
    expect(flashOf((await admin.b.post("/settings/change", { key: "marketing", field: "enabled", value: "true", reason: "turn promotions on" })).text)).toBe("That is not a setting this page changes.");
    expect(flashOf((await admin.b.post("/settings/change", { key: "sim_monthly_cap_usd", field: "default_usd", value: "999", reason: "more simulations" })).text)).toBe("That is not a setting this page changes.");
    expect((await setting("marketing")).enabled).toBe(false);
  });
});

describe("the two-person rules", () => {
  it("an approval limit waits for a second person, shown on the setting and on the Approve page; approving makes the change and the log names both", async () => {
    const admin = await who("admin", "Rasheed7"); const lead = await who("ops_lead", "Hussein");
    await admin.b.get("/settings");
    const res = await admin.b.post("/settings/change", { key: "approvals", field: "refund_usd", value: "25", reason: "the first month is quiet" });
    expect(flashOf(res.text)).toBe("Waiting for a second person: A refund above this needs a second person changes when another ops lead or admin approves it on the Approve page.");
    expect((await setting("approvals")).refund_usd).toBe(10);
    expect(res.text).toMatch(/Waiting for a second person:<\/strong> \$25\.00 \(asked by Rasheed7/);
    const card = (await lead.b.get("/approve?tab=money")).text;
    expect(card).toContain("Asked by Rasheed7"); expect(card).toContain("Needs you as the second person.");
    const pend = (await r.db.one(`select id from pending_approvals where kind = 'setting' and status = 'pending'`)).id;
    expect(flashOf((await admin.b.post(`/approvals/${pend}/approve`)).text)).toBe("You asked for this change: a second person must approve it.");
    expect(flashOf((await lead.b.post(`/approvals/${pend}/approve`, { return_to: "/approve?tab=money" })).text)).toBe("Approved: the change is made.");
    expect((await setting("approvals")).refund_usd).toBe(25);
    const t = (await admin.b.get("/settings")).text;
    expect(t).toMatch(/Rasheed7<\/td>[\s\S]*approved by Hussein[\s\S]*Hussein<\/td>/);
  });
  it("selling-requires-a-label: on needs a second person, off is at once; the Intake page shows it and changes nothing", async () => {
    const admin = await who("admin", "Rasheed8"); const lead = await who("ops_lead", "Hussein2");
    await admin.b.get("/settings");
    expect(flashOf((await admin.b.post("/settings/change", { key: "sell_requires_label", field: "enabled", value: "true", reason: "label day is done" })).text)).toMatch(/^Waiting for a second person/);
    expect((await setting("sell_requires_label")).enabled).toBe(false);
    expect((await lead.b.get("/intake")).text).toMatch(/Off<\/span>|>Off</);
    const pend = (await r.db.one(`select id from pending_approvals where kind = 'setting' and status = 'pending'`)).id;
    await lead.b.post(`/approvals/${pend}/approve`);
    expect((await setting("sell_requires_label")).enabled).toBe(true);
    expect((await lead.b.get("/intake")).text).toMatch(/On<\/span>|>On</);
    expect(flashOf((await admin.b.post("/settings/change", { key: "sell_requires_label", field: "enabled", value: "false", reason: "back to selling everything" })).text)).toBe("Saved: A packaged item is sold only after its label is read and approved is now Off.");
    expect((await setting("sell_requires_label")).enabled).toBe(false);
  });
  it("the cash caps keep soft at or below hard, and a change needs a second person", async () => {
    const admin = await who("admin", "Rasheed9");
    await admin.b.get("/settings");
    expect(flashOf((await admin.b.post("/settings/change", { key: "cash_cap", field: "hard_usd", value: "50", reason: "too tight" })).text)).toMatch(/^The database refused: CAP_ORDER/);
    expect(flashOf((await admin.b.post("/settings/change", { key: "cash_cap", field: "hard_usd", value: "175", reason: "weekend rush" })).text)).toMatch(/^Waiting for a second person/);
    expect((await setting("cash_cap")).hard_usd).toBe(150);
  });
  it("embeddings cannot be switched on until the vectors are in the database", async () => {
    const admin = await who("admin", "Rasheed10");
    await admin.b.get("/settings");
    expect(flashOf((await admin.b.post("/settings/change", { key: "search", field: "embeddings", value: "on", reason: "try meaning search" })).text)).toMatch(/^The database refused: EMBEDDINGS_NOT_READY/);
    expect((await setting("search")).embeddings).toBe("off");
  });
});

describe("Arabic", () => {
  it("the groups, the names, the buttons and the messages are in Arabic, right to left", async () => {
    const admin = await who("admin", "Rasheed11", "ar");
    const t = (await admin.b.get("/settings")).text;
    expect(t).toMatch(/<html lang="ar" dir="rtl">/);
    for (const w of ["ساعات العمل والحد الأدنى للطلب", "الرسوم", "المؤقتات", "سقوف النقد", "مكان الاستلام", "خطوات التصعيد", "حدود الشخصين", "المفاتيح", "سجل التغييرات", "شخصان"]) expect(t, w).toContain(w);
    await admin.b.get("/settings");
    expect(flashOf((await admin.b.post("/settings/change", { key: "timers", field: "draft_min", value: "61", reason: "تجربة" })).text)).toBe("تم الحفظ: «تُترك المسودة بعد» الآن 61 د.");
  });
});
