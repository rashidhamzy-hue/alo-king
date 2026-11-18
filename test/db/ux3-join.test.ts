// Session UX3 (join pages: riders and vendors), migrations 0233 and 0234, on the real migrations. Written before them: with 0233 and 0234 moved aside every
// test below fails.
//   1. A rider application is made by a visitor whose number was confirmed the WEB2 way (a link code, sent to us first: invariant 17). It creates an
//      application and a staff case. It never creates a rider account, a driver party or a shift.
//   2. A vendor application does the same for a place; if the place is one of LV1's listings it links to it and counts as its claim. It never creates a
//      merchant (invariant 11: approve_merchant only).
//   3. Accepting a rider application (ops lead or admin) creates the rider through one function; declining needs a reason; both are logged.
//   4. The page's reads come from data (villages, shifts, cash caps, fees), never from the page.
// Invented people only.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let admin: string; let picker: string;
const asWeb = async <T,>(fn: string, args: Record<string, unknown>) => {
  await db.pg.exec("set role web_channel");
  try { return await db.rpc<T>(fn, args); } finally { await db.pg.exec("reset role"); }
};
const asWebError = async (fn: string, args: Record<string, unknown>) => {
  await db.pg.exec("set role web_channel");
  try { await db.rpc(fn, args); return null; } catch (e) { return (e as Error).message; } finally { await db.pg.exec("reset role"); }
};
let seq = 0;
/** A visitor with a session, who then messages the customer line with the code, as the turn would (claim_link_code, by code, before any model). */
async function confirmedVisitor(purpose: "rider" | "vendor" | "checkout" = "rider") {
  seq++;
  const s = await db.rpc<{ token: string }>("web_session_start", { p_device: "test" });
  const code = purpose === "checkout" ? await asWeb<any>("web_link_code", { p_token: s.token }) : await asWeb<any>("web_join_code", { p_token: s.token, p_purpose: purpose });
  const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`UX3 visitor ${seq}`])).id;
  await db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-ux3-${seq}', '+96170000${String(200 + seq)}')`);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id;
  const claim = await db.rpc<any>("claim_link_code", { p_party: party, p_code: code.code, p_wamid: `wamid-ux3-${seq}` });
  return { token: s.token, code, party, conv, claim };
}
const RIDER = { p_name: "Sami Test", p_village: "Baakleen", p_vehicle: "motorbike", p_licence: true, p_days: ["mon", "tue", "sat"], p_shifts: ["morning"] };
const applyRider = (token: string, over: Partial<typeof RIDER> = {}) => asWeb<any>("web_apply_rider", { p_token: token, ...RIDER, ...over });

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead') returning id`)).id;
  admin = (await db.one(`insert into parties(role, display_name) values ('admin', 'Admin') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
}, 120_000);

describe("what the join pages read comes from data", () => {
  it("web_join_options returns the villages, the shifts, the vehicles, the vendor kinds, the cash caps and the fee range from the database", async () => {
    const o = await asWeb<any>("web_join_options", {});
    const villages = await db.all<any>(`select name_en from villages`);
    expect(o.villages.length).toBe(villages.length);
    expect(o.villages.every((v: any) => typeof v.name_en === "string")).toBe(true);
    expect(o.shifts.map((s: any) => s.id)).toEqual(["morning", "evening"]);
    expect(o.vehicles).toEqual(["motorbike", "car", "bicycle"]);
    expect(o.vendor_kinds).toContain("bakery");
    const caps = await db.rpc<any>("setting", { p_key: "cash_cap" });
    expect(o.cash_cap).toEqual({ soft_usd: caps.soft_usd, hard_usd: caps.hard_usd });
    const fees = await db.one<any>(`select min(z.delivery_fee_usd)::float as lo, max(z.delivery_fee_usd)::float as hi from villages v join zones z on z.id = v.zone_id where v.is_served and z.is_active`);
    expect(o.fees).toEqual({ min_usd: fees.lo, max_usd: fees.hi });
    // a setting changed by a person changes the page: nothing is fixed in code (invariant 13)
    await db.pg.query(`update settings set value = jsonb_set(value, '{rider,shifts}', '[{"id":"night","from":"22:00","to":"04:00"}]') where key = 'join'`);
    expect((await asWeb<any>("web_join_options", {})).shifts.map((s: any) => s.id)).toEqual(["night"]);
    await db.pg.query(`update settings set value = jsonb_set(value, '{rider,shifts}', '[{"id":"morning","from":"08:00","to":"15:30"},{"id":"evening","from":"15:30","to":"23:00"}]') where key = 'join'`);
  });
});

describe("the number is confirmed the WEB2 way: they message us first", () => {
  it("a join code is a link code with a purpose; sending it links the session and records the consent with the purpose's own words", async () => {
    const v = await confirmedVisitor("rider");
    expect(v.code.ok).toBe(true); expect(v.code.code).toMatch(/^ALO-[23456789A-HJ-NP-Z]{6}$/);
    expect(v.claim).toMatchObject({ ok: true, status: "linked" });
    const s = await db.one<any>(`select party_id from web_sessions where token_hash = web_token_hash($1)`, [v.token]);
    expect(s.party_id).toBe(v.party);
    const c = await db.one<any>(`select source, wording, evidence_message_id from consent_events where party_id = $1 and source = 'web_link_code'`, [v.party]);
    expect(c.evidence_message_id).toMatch(/^wamid-ux3-/);
    expect(c.wording).toContain("طلب انضمامك كدليفري");                                // the rider's words (0235, read 18 Nov), not the checkout's "updates on your orders"
    const checkout = await confirmedVisitor("checkout");
    expect((await db.one<any>(`select wording from consent_events where party_id = $1`, [checkout.party])).wording).toContain("طلباتك");
    const vendor = await confirmedVisitor("vendor");
    expect((await db.one<any>(`select wording from consent_events where party_id = $1`, [vendor.party])).wording).toContain("محل");
  });

  it("web_join_state says whether the number is confirmed, and shows a waiting code only for its own purpose", async () => {
    const s = await db.rpc<{ token: string }>("web_session_start", { p_device: "test" });
    expect(await asWeb<any>("web_join_state", { p_token: s.token, p_purpose: "rider" })).toMatchObject({ valid: true, linked: false, code_waiting: null, application: null });
    const code = await asWeb<any>("web_join_code", { p_token: s.token, p_purpose: "rider" });
    expect((await asWeb<any>("web_join_state", { p_token: s.token, p_purpose: "rider" })).code_waiting.code).toBe(code.code);
    expect((await asWeb<any>("web_join_state", { p_token: s.token, p_purpose: "vendor" })).code_waiting).toBeNull();
    expect(await asWeb<any>("web_join_state", { p_token: "x".repeat(64), p_purpose: "rider" })).toMatchObject({ valid: false, linked: false });
  });

  it("a purpose that is not one is refused; a linked session needs no new code", async () => {
    const s = await db.rpc<{ token: string }>("web_session_start", { p_device: "test" });
    expect(await asWeb<any>("web_join_code", { p_token: s.token, p_purpose: "marketing" })).toMatchObject({ ok: false, error: "bad_purpose" });
    const v = await confirmedVisitor("rider");
    expect(await asWeb<any>("web_join_code", { p_token: v.token, p_purpose: "rider" })).toMatchObject({ ok: false, error: "already_linked" });
  });

  it("an application from a session whose number is not confirmed is refused and writes nothing", async () => {
    const s = await db.rpc<{ token: string }>("web_session_start", { p_device: "test" });
    const before = Number((await db.one<any>(`select count(*)::int as n from join_applications`)).n);
    expect(await applyRider(s.token)).toMatchObject({ ok: false, error: "not_confirmed" });
    expect(await asWeb<any>("web_apply_vendor", { p_token: s.token, p_name: "Test Oven", p_kind: "bakery", p_village: "Baakleen", p_listing: null })).toMatchObject({ ok: false, error: "not_confirmed" });
    expect(await applyRider("x".repeat(64))).toMatchObject({ ok: false, error: "no_session" });
    expect(Number((await db.one<any>(`select count(*)::int as n from join_applications`)).n)).toBe(before);
  });
});

describe("a rider application: an application and a staff case, never a rider", () => {
  it("is stored with what was asked (name, village, vehicle, licence, the days and shifts), opens a case in the Inbox, and creates no rider, shift or login", async () => {
    const v = await confirmedVisitor("rider");
    const drivers = Number((await db.one<any>(`select count(*)::int as n from parties where role = 'driver'`)).n);
    const r = await applyRider(v.token);
    expect(r).toMatchObject({ ok: true, again: false });
    const a = await db.one<any>(`select * from join_applications where id = $1`, [r.id]);
    expect(a).toMatchObject({ kind: "rider", status: "open", party_id: v.party, name: "Sami Test", village: "Baakleen", vehicle: "motorbike", licence: true, rider_party_id: null });
    expect(a.days).toEqual(["mon", "tue", "sat"]); expect(a.shifts).toEqual(["morning"]);
    expect(a.village_id).toBeTruthy();                                                   // Baakleen is a village we know
    const h = await db.one<any>(`select kind, state, topic, source, conversation_id from handoffs where id = $1`, [a.case_id]);
    expect(h).toMatchObject({ kind: "other", state: "open", source: "rider_application", conversation_id: v.conv });
    expect(h.topic).toContain("Rider application"); expect(h.topic).toContain("Sami Test");
    expect(Number((await db.one<any>(`select count(*)::int as n from parties where role = 'driver'`)).n)).toBe(drivers);
    expect(Number((await db.one<any>(`select count(*)::int as n from party_identities where line = 'ops' and party_id = $1`, [v.party])).n)).toBe(0);
    expect(Number((await db.one<any>(`select count(*)::int as n from driver_shifts`)).n)).toBe(0);
    expect((await db.one<any>(`select role from parties where id = $1`, [v.party])).role).toBe("customer");
    const log = await db.all<any>(`select action, by_party from join_log where application_id = $1`, [r.id]);
    expect(log.map((l) => l.action)).toEqual(["apply"]);
  });

  it("sent twice, it is one application and one case", async () => {
    const v = await confirmedVisitor("rider");
    const a = await applyRider(v.token); const b = await applyRider(v.token, { p_name: "Sami Again" });
    expect(b).toMatchObject({ ok: true, again: true, id: a.id });
    expect(Number((await db.one<any>(`select count(*)::int as n from join_applications where party_id = $1`, [v.party])).n)).toBe(1);
    expect((await db.one<any>(`select name from join_applications where id = $1`, [a.id])).name).toBe("Sami Test");
    expect(Number((await db.one<any>(`select count(*)::int as n from handoffs where conversation_id = $1`, [v.conv])).n)).toBe(1);
  });

  it("refuses what is not an answer: no name, an unknown vehicle, no licence answer, no days or shifts, a shift that is not in the settings", async () => {
    const v = await confirmedVisitor("rider");
    expect(await applyRider(v.token, { p_name: "  " })).toMatchObject({ ok: false, error: "bad_name" });
    expect(await applyRider(v.token, { p_vehicle: "helicopter" })).toMatchObject({ ok: false, error: "bad_vehicle" });
    expect(await asWeb<any>("web_apply_rider", { p_token: v.token, ...RIDER, p_licence: null })).toMatchObject({ ok: false, error: "bad_licence" });
    expect(await applyRider(v.token, { p_days: [] })).toMatchObject({ ok: false, error: "bad_hours" });
    expect(await applyRider(v.token, { p_shifts: [] })).toMatchObject({ ok: false, error: "bad_hours" });
    expect(await applyRider(v.token, { p_shifts: ["midnight"] })).toMatchObject({ ok: false, error: "bad_hours" });
    expect(await applyRider(v.token, { p_days: ["mon", "funday"] })).toMatchObject({ ok: false, error: "bad_hours" });
    expect(await applyRider(v.token, { p_village: "" })).toMatchObject({ ok: false, error: "bad_village" });
    expect(Number((await db.one<any>(`select count(*)::int as n from join_applications where party_id = $1`, [v.party])).n)).toBe(0);
  });

  it("a licence answer of no is accepted as an answer (staff decide), and a village we do not know is kept as written", async () => {
    const v = await confirmedVisitor("rider");
    const r = await applyRider(v.token, { p_licence: false, p_village: "Somewhere Else" });
    expect(r.ok).toBe(true);
    expect(await db.one<any>(`select licence, village, village_id from join_applications where id = $1`, [r.id])).toMatchObject({ licence: false, village: "Somewhere Else", village_id: null });
  });

  it("is limited per session a day, in settings", async () => {
    const cap = Number((await db.rpc<any>("setting", { p_key: "join" })).limits.per_session_day);
    expect(cap).toBeGreaterThan(0);
    const v = await confirmedVisitor("rider");
    await db.pg.query(`insert into join_applications(kind, status, party_id, session_id, name, village, vehicle, licence, days, shifts, decided_by, decided_at, decision_reason)
                       select 'rider', 'declined', $1, s.id, 'Old', 'X', 'car', true, '{mon}', '{morning}', $2, now(), 'older' from web_sessions s cross join generate_series(1, $4) where s.token_hash = web_token_hash($3)`,
                      [v.party, lead, v.token, cap]);
    expect(await applyRider(v.token)).toMatchObject({ ok: false, error: "limit" });
  });

  it("the web role may call the five join functions and nothing that reads or decides applications", async () => {
    const v = await confirmedVisitor("rider");
    for (const fn of ["join_applicants_console", "accept_rider_application", "decline_rider_application"]) {
      const m = await asWebError(fn, fn === "join_applicants_console" ? {} : { p_application: "00000000-0000-0000-0000-000000000000", p_by: lead });
      expect(m, fn).toMatch(/permission denied|does not exist|function .* not unique|could not find/i);
    }
    await db.pg.exec("set role web_channel");
    try { await expect(db.all(`select * from join_applications`)).rejects.toThrow(/permission denied/); } finally { await db.pg.exec("reset role"); }
    expect(v.party).toBeTruthy();
  });
});

describe("a vendor application: a staff case, and the claim of a listing; never a merchant", () => {
  it("without a listing: stored with the place's name, kind and village, one staff case, no merchant, no listing claim", async () => {
    const v = await confirmedVisitor("vendor");
    const merchants = Number((await db.one<any>(`select count(*)::int as n from sources where kind = 'merchant'`)).n);
    const r = await asWeb<any>("web_apply_vendor", { p_token: v.token, p_name: "Test Oven", p_kind: "bakery", p_village: "Baakleen", p_listing: null });
    expect(r).toMatchObject({ ok: true, again: false, listing: null });
    const a = await db.one<any>(`select * from join_applications where id = $1`, [r.id]);
    expect(a).toMatchObject({ kind: "vendor", status: "open", party_id: v.party, name: "Test Oven", place_kind: "bakery", village: "Baakleen", listing_id: null, vehicle: null, licence: null });
    const h = await db.one<any>(`select kind, topic, source from handoffs where id = $1`, [a.case_id]);
    expect(h).toMatchObject({ kind: "other", source: "vendor_application" }); expect(h.topic).toContain("Vendor application"); expect(h.topic).toContain("Test Oven");
    expect(Number((await db.one<any>(`select count(*)::int as n from sources where kind = 'merchant'`)).n)).toBe(merchants);
    expect(Number((await db.one<any>(`select count(*)::int as n from sources where kind = 'merchant' and is_open`)).n)).toBe(0);
    expect(Number((await db.one<any>(`select count(*)::int as n from listing_claims where party_id = $1`, [v.party])).n)).toBe(0);
  });

  it("for one of LV1's listings: it links to it and counts as its claim, on the same case, and the listing itself is unchanged", async () => {
    const v = await confirmedVisitor("vendor");
    const l = await db.one<any>(`select * from listings where kind = 'bakery' and hidden_at is null order by km_from_hub limit 1`);
    const r = await asWeb<any>("web_apply_vendor", { p_token: v.token, p_name: l.name, p_kind: "bakery", p_village: l.village ?? "", p_listing: l.listing_id });
    expect(r).toMatchObject({ ok: true, listing: l.listing_id });
    const a = await db.one<any>(`select listing_id, case_id from join_applications where id = $1`, [r.id]);
    expect(a.listing_id).toBe(l.listing_id);
    const claim = await db.one<any>(`select case_id, party_id from listing_claims where listing_id = $1 and party_id = $2`, [l.listing_id, v.party]);
    expect(claim.case_id).toBe(a.case_id);                                                // one case for both
    expect((await db.one<any>(`select topic from handoffs where id = $1`, [a.case_id])).topic).toMatch(/Claim:.*Vendor application|Vendor application.*Claim:/s);
    expect((await db.one<any>(`select count(*)::int as n from listing_log where listing_id = $1 and action = 'claim' and by_party = $2`, [l.listing_id, v.party])).n).toBe(1);
    expect(await db.one<any>(`select name, kind, hidden_at from listings where listing_id = $1`, [l.listing_id])).toMatchObject({ name: l.name, kind: l.kind, hidden_at: null });
  });

  it("a hidden or unknown listing is not linked (the application still stands, unlinked); a kind that is not in the settings is refused", async () => {
    const v = await confirmedVisitor("vendor");
    const hidden = await db.one<any>(`select listing_id from listings where hidden_at is null order by listing_id limit 1`);
    await db.pg.query(`update listings set hidden_at = now() where listing_id = $1`, [hidden.listing_id]);
    const r = await asWeb<any>("web_apply_vendor", { p_token: v.token, p_name: "Someone's Kitchen", p_kind: "restaurant", p_village: "", p_listing: hidden.listing_id });
    expect(r).toMatchObject({ ok: true, listing: null });
    await db.pg.query(`update listings set hidden_at = null where listing_id = $1`, [hidden.listing_id]);
    const w = await confirmedVisitor("vendor");
    expect(await asWeb<any>("web_apply_vendor", { p_token: w.token, p_name: "X Kitchen", p_kind: "arms_dealer", p_village: "", p_listing: null })).toMatchObject({ ok: false, error: "bad_kind" });
    expect(await asWeb<any>("web_apply_vendor", { p_token: w.token, p_name: " ", p_kind: "cafe", p_village: "", p_listing: null })).toMatchObject({ ok: false, error: "bad_name" });
  });

  it("no code path of the website or the console makes a merchant: approve_merchant is still the only door, and no function of 0233 or 0234 writes merchants", async () => {
    const src = (await db.all<any>(`select proname, prosrc from pg_proc where proname in ('web_apply_vendor','web_apply_rider','web_join_code','web_join_state','web_join_options','join_applicants_console','accept_rider_application','decline_rider_application')`));
    expect(src.length).toBe(8);
    for (const f of src) expect(f.prosrc, f.proname).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+(sources|orders|payments|stock_levels|ledger_entries|offers)\b/i);
  });
});

describe("deciding a rider application: ops lead or admin; accepting creates the rider through one function; declining needs a reason; both are logged", () => {
  it("accept creates the rider (a driver party on the ops line, from the confirmed number), marks the application, and logs it", async () => {
    const v = await confirmedVisitor("rider");
    const app = await applyRider(v.token, { p_name: "Nadim Test" });
    const r = await db.rpc<any>("accept_rider_application", { p_application: app.id, p_by: lead });
    expect(r).toMatchObject({ ok: true }); expect(r.rider_party_id).toBeTruthy();
    const rider = await db.one<any>(`select role, display_name, is_blocked from parties where id = $1`, [r.rider_party_id]);
    expect(rider).toMatchObject({ role: "driver", display_name: "Nadim Test", is_blocked: false });
    const ident = await db.one<any>(`select line, phone_e164, wa_user_id from party_identities where party_id = $1`, [r.rider_party_id]);
    const own = await db.one<any>(`select phone_e164, wa_user_id from party_identities where party_id = $1 and line = 'customer'`, [v.party]);
    expect(ident).toEqual({ line: "ops", phone_e164: own.phone_e164, wa_user_id: own.wa_user_id });
    expect(await db.one<any>(`select status, rider_party_id, decided_by from join_applications where id = $1`, [app.id])).toMatchObject({ status: "accepted", rider_party_id: r.rider_party_id, decided_by: lead });
    const log = await db.all<any>(`select action, by_party from join_log where application_id = $1 order by id`, [app.id]);
    expect(log.map((l) => l.action)).toEqual(["apply", "accept"]); expect(log[1].by_party).toBe(lead);
    // the ops line now knows the number: the rider can message the ops number; nothing was sent, and no shift or terms were made up
    expect((await db.rpc<any>("touch_conversation", { p_line: "ops", p_wa_user_id: ident.wa_user_id, p_phone: ident.phone_e164, p_name: null })).role).toBe("driver");
    expect(Number((await db.one<any>(`select count(*)::int as n from driver_shifts where driver_id = $1`, [r.rider_party_id])).n)).toBe(0);
    expect((await db.rpc<any[]>("rider_terms_on_file", {})).some((t) => t.driver_id === r.rider_party_id)).toBe(false);
    expect(Number((await db.one<any>(`select count(*)::int as n from outbox where party_id = $1`, [r.rider_party_id]).catch(() => ({ n: 0 }))).n)).toBe(0);
  });

  it("an admin may accept; a picker and a customer may not; nobody decides twice", async () => {
    const v = await confirmedVisitor("rider"); const app = await applyRider(v.token);
    await expect(db.rpc("accept_rider_application", { p_application: app.id, p_by: picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("accept_rider_application", { p_application: app.id, p_by: v.party })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("decline_rider_application", { p_application: app.id, p_by: picker, p_reason: "no reason" })).rejects.toThrow(/NOT_AUTHORISED/);
    expect((await db.rpc<any>("accept_rider_application", { p_application: app.id, p_by: admin })).ok).toBe(true);
    await expect(db.rpc("accept_rider_application", { p_application: app.id, p_by: lead })).rejects.toThrow(/ALREADY_DECIDED/);
    await expect(db.rpc("decline_rider_application", { p_application: app.id, p_by: lead, p_reason: "changed my mind" })).rejects.toThrow(/ALREADY_DECIDED/);
  });

  it("decline needs a reason, keeps it, makes no rider, and is logged with who and why", async () => {
    const v = await confirmedVisitor("rider"); const app = await applyRider(v.token);
    const drivers = Number((await db.one<any>(`select count(*)::int as n from parties where role = 'driver'`)).n);
    await expect(db.rpc("decline_rider_application", { p_application: app.id, p_by: lead, p_reason: "  " })).rejects.toThrow(/REASON_REQUIRED/);
    await expect(db.rpc("decline_rider_application", { p_application: app.id, p_by: lead, p_reason: "no" })).rejects.toThrow(/REASON_REQUIRED/);
    expect((await db.one<any>(`select status from join_applications where id = $1`, [app.id])).status).toBe("open");
    const r = await db.rpc<any>("decline_rider_application", { p_application: app.id, p_by: lead, p_reason: "No vehicle for the roads we cover" });
    expect(r.ok).toBe(true);
    expect(await db.one<any>(`select status, decision_reason, decided_by, rider_party_id from join_applications where id = $1`, [app.id])).toMatchObject({ status: "declined", decision_reason: "No vehicle for the roads we cover", decided_by: lead, rider_party_id: null });
    const log = await db.all<any>(`select action, by_party, reason from join_log where application_id = $1 order by id`, [app.id]);
    expect(log.map((l) => l.action)).toEqual(["apply", "decline"]); expect(log[1]).toMatchObject({ by_party: lead, reason: "No vehicle for the roads we cover" });
    expect(Number((await db.one<any>(`select count(*)::int as n from parties where role = 'driver'`)).n)).toBe(drivers);
    // someone declined may apply again: a new application
    expect((await applyRider(v.token)).again).toBe(false);
  });

  it("a number already on the ops line is refused (it is a rider or staff already), and a vendor application cannot be accepted as a rider", async () => {
    const v = await confirmedVisitor("rider"); const app = await applyRider(v.token);
    const own = await db.one<any>(`select phone_e164 from party_identities where party_id = $1 and line = 'customer'`, [v.party]);
    await db.pg.query(`insert into party_identities(party_id, line, phone_e164) values ($1, 'ops', $2)`, [picker, own.phone_e164]);
    await expect(db.rpc("accept_rider_application", { p_application: app.id, p_by: lead })).rejects.toThrow(/ALREADY_ON_OPS_LINE/);
    expect((await db.one<any>(`select status from join_applications where id = $1`, [app.id])).status).toBe("open");
    const w = await confirmedVisitor("vendor");
    const va = await asWeb<any>("web_apply_vendor", { p_token: w.token, p_name: "Vendor Place", p_kind: "cafe", p_village: "", p_listing: null });
    await expect(db.rpc("accept_rider_application", { p_application: va.id, p_by: lead })).rejects.toThrow(/NOT_A_RIDER_APPLICATION/);
  });

  it("the join log cannot be changed", async () => {
    await expect(db.pg.exec(`update join_log set reason = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.pg.exec(`delete from join_log`)).rejects.toThrow(/append-only/);
  });

  it("join_applicants_console lists applicants for staff with their number and case; a rider's application never carries a rating or a score", async () => {
    const rows = await db.rpc<any[]>("join_applicants_console", { p_kind: "rider", p_state: "open", p_limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    const x = rows[0]!;
    for (const k of ["id", "name", "village", "vehicle", "licence", "days", "shifts", "phone", "case_id", "case_state", "created_at", "status"]) expect(x, k).toHaveProperty(k);
    expect(Object.keys(x).join(" ")).not.toMatch(/rating|score|rank|stars/i);
    expect(x.phone).toMatch(/^\+9617000/);
    const done = await db.rpc<any[]>("join_applicants_console", { p_kind: "rider", p_state: "decided", p_limit: 50 });
    expect(done.every((d) => d.status !== "open")).toBe(true);
    expect(done.some((d) => d.status === "accepted" && d.decided_by_name === "Lead")).toBe(true);
  });
});
