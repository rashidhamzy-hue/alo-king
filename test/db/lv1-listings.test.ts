// Session LV1 (Chouf places listed before they sign), migrations 0224 and 0225, on the real migrations.
// Founder decision of 17 November (docs/DECISIONS.md, "Listings before they sign, 17 November 2026"). Written before the migrations: with
// 0224 and 0225 moved aside every test below fails.
//   1. A listing is a row of its own, loaded from supabase/seed/chouf_listings.csv; it is never orderable and never a merchant.
//   2. The website reads it through two functions (list, place); a hidden listing is gone from both at once.
//   3. "I want to order from here" is demand (log_demand, kind listing), once per anonymous session or signed-in customer.
//   4. "Remove this listing" hides at once, is logged with its time and request, and raises a staff case; only an ops lead or an admin
//      can restore it, with a reason, and a restore is logged.
//   5. "Claim <listing_id>" is read by code: a staff case with the listing and the sender; nothing is sent, nothing is changed.
// Invented people only; the listings are the founder's file, which holds no phone, rating, review count, menu, hours or photo.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, parseCsv, type TestDb } from "./harness";
import { findPhones } from "../../scripts/ci/no-personal-data.mjs";

let db: TestDb; let lead: string; let admin: string; let picker: string; let customer: string;
const csvPath = fileURLToPath(new URL("../../supabase/seed/chouf_listings.csv", import.meta.url));
const csv = parseCsv(readFileSync(csvPath, "utf8")).filter((r) => r.length > 1);
const header = csv[0]!; const rows = csv.slice(1);
const asWeb = async <T,>(fn: string, args: Record<string, unknown>) => {
  await db.pg.exec("set role web_channel");
  try { return await db.rpc<T>(fn, args); } finally { await db.pg.exec("reset role"); }
};
const newSession = async () => (await db.rpc<{ token: string }>("web_session_start", { p_device: "test" })).token;
const sessionRow = async (token: string) => (await db.one(`select id, party_id from web_sessions where token_hash = web_token_hash($1)`, [token]));
let seq = 0;
const newCustomer = async () => {
  seq++;
  const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`LV1 customer ${seq}`])).id;
  await db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-lv1-${seq}', '+96170000${String(100 + seq)}')`);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id;
  return { party, conv };
};
const pick = (kind?: string, village?: string) => rows.find((r) => (!kind || r[2]!.toLowerCase() === kind) && (village === undefined ? true : r[3] === village))!;
const listingId = (n: number) => rows[n]![0]!;

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead') returning id`)).id;
  admin = (await db.one(`insert into parties(role, display_name) values ('admin', 'Admin') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  customer = (await db.one(`insert into parties(role, display_name) values ('customer', 'Someone') returning id`)).id;
}, 120_000);

describe("the file and the table", () => {
  it("the file has the six columns and no phone, rating, review count, menu, hours or photo", () => {
    expect(header).toEqual(["listing_id", "name", "category", "village", "km_from_hub", "google_maps_url"]);
    expect(rows.length).toBe(460);
    for (const r of rows) expect(findPhones(r.join(" | ")), r[0]).toEqual([]);
  });

  it("holds every row of the file, once, with nothing hidden", async () => {
    const got = await db.all<any>(`select listing_id, name, kind, village, km_from_hub::text as km, maps_url, hidden_at from listings order by listing_id`);
    expect(got.length).toBe(460);
    const byId = new Map(got.map((g) => [g.listing_id, g]));
    for (const r of rows) {
      const g = byId.get(r[0]!)!;
      expect(g, r[0]).toBeTruthy();
      expect(g.name).toBe(r[1]);
      expect(g.kind).toBe(r[2]!.toLowerCase());
      expect(g.village).toBe(r[3] === "" ? null : r[3]);
      expect(Number(g.km)).toBe(Number(r[4]));
      expect(g.maps_url).toBe(r[5]);
      expect(g.hidden_at).toBeNull();
    }
    // The file's own six kinds, as words in the table.
    expect((await db.all<any>(`select distinct kind from listings order by 1`)).map((x) => x.kind)).toEqual(["bakery", "butcher", "cafe", "catering", "restaurant", "sweets"]);
  });

  it("has no column for a phone, a rating, a review count, a menu, hours or a photo, and no way to order", async () => {
    const cols = (await db.all<any>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'listings' order by ordinal_position`)).map((c) => c.column_name);
    expect(cols).toEqual(["listing_id", "name", "kind", "village", "km_from_hub", "maps_url", "hidden_at", "created_at"]);
    // Invariant 11: nothing ties a listing to a merchant, a source, an offer, a product or an order.
    const fks = await db.all<any>(`select c.conrelid::regclass::text as t, c.confrelid::regclass::text as ref from pg_constraint c
                                    where c.contype = 'f' and c.conrelid::regclass::text in ('listings', 'listing_log', 'listing_claims', 'listing_removal_requests')`);
    for (const f of fks) expect(["listings", "parties", "web_sessions", "conversations", "handoffs", "listing_removal_requests"], `${f.t} -> ${f.ref}`).toContain(f.ref);
    expect((await db.all<any>(`select 1 from pg_constraint where contype = 'f' and confrelid = 'listings'::regclass and conrelid::regclass::text not like 'listing_%'`))).toEqual([]);
  });

  it("is closed to the website and the public roles: only the functions open it", async () => {
    for (const sql of [`select 1 from listings limit 1`, `select 1 from listing_log limit 1`, `select 1 from listing_claims limit 1`, `select 1 from listing_removal_requests limit 1`]) {
      await db.pg.exec("set role web_channel");
      let err = "";
      try { await db.pg.exec(sql); } catch (e) { err = (e as Error).message; } finally { await db.pg.exec("reset role"); }
      expect(err, sql).toMatch(/permission denied/);
    }
    for (const fn of ["restore_listing", "keep_listing_hidden", "claim_listing", "listings_console", "listing_claims_console"]) {
      const ok = await db.one(`select has_function_privilege('web_channel', p.oid, 'execute') as ok from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn]);
      expect(ok?.ok, fn).toBe(false);
    }
    for (const fn of ["web_food_list", "web_food_place", "web_listing_want", "web_listing_remove"]) {
      const ok = await db.one(`select has_function_privilege('web_channel', p.oid, 'execute') as ok from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn]);
      expect(ok?.ok, fn).toBe(true);
    }
  });
});

describe("the Food page's read", () => {
  it("lists by distance, then name, with the village in Arabic where the village list knows it", async () => {
    const r = await asWeb<any>("web_food_list", {});
    expect(r.ok).toBe(true);
    expect(r.total).toBe(460);
    expect(r.rows.length).toBe(24);
    const km = r.rows.map((x: any) => Number(x.km_from_hub));
    expect([...km].sort((a, b) => a - b)).toEqual(km);
    expect(Object.keys(r.rows[0]).sort()).toEqual(["kind", "km_from_hub", "listing_id", "name", "village", "village_ar"]);
    const b = await asWeb<any>("web_food_list", { p_village: "Baakleen", p_limit: 5 });
    expect(b.rows[0].village_ar).toBe("بعقلين");
    expect(b.total).toBe(73);
  });

  it("filters by kind and by village, counts what is left, and a village of '-' is the places with none", async () => {
    const r = await asWeb<any>("web_food_list", { p_kind: "bakery", p_village: "Baakleen", p_limit: 100 });
    expect(r.rows.every((x: any) => x.kind === "bakery" && x.village === "Baakleen")).toBe(true);
    expect(r.total).toBe(rows.filter((x) => x[2] === "Bakery" && x[3] === "Baakleen").length);
    const none = await asWeb<any>("web_food_list", { p_village: "-", p_limit: 100 });
    expect(none.total).toBe(34);
    expect(none.rows.every((x: any) => x.village === null)).toBe(true);
    const nothing = await asWeb<any>("web_food_list", { p_kind: "hotel" });
    expect(nothing.total).toBe(0);
    expect(nothing.rows).toEqual([]);
    // The kinds and the villages to choose from, with how many each holds.
    expect(r.kinds.find((k: any) => k.kind === "restaurant").count).toBe(194);
    expect(r.villages.find((v: any) => v.village === "Boqaata").count).toBe(54);
  });

  it("sorts by name only when asked, and by distance for anything else (nothing else is a sort)", async () => {
    const byName = await asWeb<any>("web_food_list", { p_sort: "name", p_limit: 100 });
    const names = byName.rows.map((x: any) => x.name.toLowerCase());
    expect([...names].sort()).toEqual(names);
    for (const bad of ["rating", "popular", "price", "", null]) {
      const r = await asWeb<any>("web_food_list", { p_sort: bad, p_limit: 10 });
      const km = r.rows.map((x: any) => Number(x.km_from_hub));
      expect([...km].sort((a, b) => a - b), String(bad)).toEqual(km);
    }
  });

  it("pages: an offset moves on, and a limit is capped", async () => {
    const a = await asWeb<any>("web_food_list", { p_limit: 10, p_offset: 0 });
    const b = await asWeb<any>("web_food_list", { p_limit: 10, p_offset: 10 });
    expect(a.rows.map((x: any) => x.listing_id)).not.toEqual(b.rows.map((x: any) => x.listing_id));
    expect((await asWeb<any>("web_food_list", { p_limit: 100000 })).rows.length).toBeLessThanOrEqual(60);
  });

  it("one place: its six facts and the chat's address, nothing else", async () => {
    const id = listingId(5);
    const r = await asWeb<any>("web_food_place", { p_id: id });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.listing).sort()).toEqual(["kind", "km_from_hub", "listing_id", "maps_url", "name", "village", "village_ar"]);
    expect(r.listing.listing_id).toBe(id);
    expect(Object.keys(r).sort()).toEqual(["listing", "ok", "whatsapp"]);
    expect((await asWeb<any>("web_food_place", { p_id: "no-such-place-1" })).error).toBe("unknown_listing");
  });
});

describe("I want to order from here", () => {
  it("is demand: one row per anonymous session and place, none for a repeat, one more for another session", async () => {
    const id = listingId(10);
    const s1 = await newSession(); const s2 = await newSession();
    const first = await asWeb<any>("web_listing_want", { p_token: s1, p_listing: id });
    expect(first).toMatchObject({ ok: true, counted: true });
    expect(await asWeb<any>("web_listing_want", { p_token: s1, p_listing: id })).toMatchObject({ ok: true, counted: false });
    expect(await asWeb<any>("web_listing_want", { p_token: s2, p_listing: id })).toMatchObject({ ok: true, counted: true });
    const d = await db.all<any>(`select kind, origin, subject, party_id, query from demand_signals where kind = 'listing' and subject = $1`, [id]);
    expect(d.length).toBe(2);
    expect(d[0]).toMatchObject({ kind: "listing", origin: "web_listing", subject: id, party_id: null, query: rows[10]![1] });
  });

  it("counts a signed-in customer once, from whichever of their devices", async () => {
    const id = listingId(11);
    const c = await newCustomer();
    const s1 = await newSession(); const s2 = await newSession();
    for (const t of [s1, s2]) await db.pg.exec(`update web_sessions set party_id = '${c.party}', linked_at = now() where id = '${(await sessionRow(t)).id}'`);
    expect(await asWeb<any>("web_listing_want", { p_token: s1, p_listing: id })).toMatchObject({ counted: true });
    expect(await asWeb<any>("web_listing_want", { p_token: s2, p_listing: id })).toMatchObject({ counted: false });
    const d = await db.all<any>(`select party_id from demand_signals where kind = 'listing' and subject = $1`, [id]);
    expect(d).toEqual([{ party_id: c.party }]);
  });

  it("asks for no contact detail: the function takes a session and a place, nothing else", async () => {
    const f = await db.one(`select pg_get_function_arguments(p.oid) as a from pg_proc p where p.proname = 'web_listing_want' and p.pronamespace = 'public'::regnamespace`);
    expect(f.a).toBe("p_token text, p_listing text");
  });

  it("needs a live session; an unknown or hidden place counts nothing", async () => {
    const before = Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing'`)).n);
    expect(await asWeb<any>("web_listing_want", { p_token: "x".repeat(40), p_listing: listingId(12) })).toMatchObject({ ok: false, error: "no_session" });
    const s = await newSession();
    expect(await asWeb<any>("web_listing_want", { p_token: s, p_listing: "no-such-place-1" })).toMatchObject({ ok: false, error: "unknown_listing" });
    await db.pg.exec(`update listings set hidden_at = now() where listing_id = '${listingId(12)}'`);
    expect(await asWeb<any>("web_listing_want", { p_token: s, p_listing: listingId(12) })).toMatchObject({ ok: false, error: "unknown_listing" });
    await db.pg.exec(`update listings set hidden_at = null where listing_id = '${listingId(12)}'`);
    expect(Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing'`)).n)).toBe(before);
  });

  it("one session cannot fill the log: past the hourly cap it counts nothing more", async () => {
    await db.pg.exec(`update settings set value = value || '{"want_per_session_hour": 3}'::jsonb where key = 'listings'`);
    const s = await newSession();
    const out: boolean[] = [];
    for (let i = 20; i < 26; i++) out.push((await asWeb<any>("web_listing_want", { p_token: s, p_listing: listingId(i) })).counted);
    expect(out).toEqual([true, true, true, false, false, false]);
    await db.pg.exec(`update settings set value = value || '{"want_per_session_hour": 30}'::jsonb where key = 'listings'`);
  });

  it("the console's count per place is the demand rows of that place", async () => {
    const id = listingId(10);
    const r = await db.rpc<any>("listings_console", { p_q: rows[10]![1], p_state: "all", p_limit: 5 });
    expect(r.find((x: any) => x.listing_id === id).wants).toBe(2);
  });
});

describe("Remove this listing", () => {
  it("hides at once, logs the request with who asked and when, and raises a staff case", async () => {
    const id = listingId(30);
    const s = await newSession();
    expect((await asWeb<any>("web_food_place", { p_id: id })).ok).toBe(true);
    const r = await asWeb<any>("web_listing_remove", { p_token: s, p_listing: id, p_who: "owner", p_reason: "We closed last year" });
    expect(r).toMatchObject({ ok: true, hidden: true });
    // gone from the page and the list at once
    expect((await asWeb<any>("web_food_place", { p_id: id })).error).toBe("unknown_listing");
    const list = await asWeb<any>("web_food_list", { p_limit: 60, p_offset: 0, p_village: rows[30]![3] || "-" });
    expect(list.rows.some((x: any) => x.listing_id === id)).toBe(false);
    expect(list.total).toBe(rows.filter((x) => x[3] === rows[30]![3]).length - 1);
    // the request, the log and the case
    const q = await db.one(`select who, reason, status, hidden, requested_at, listing_id from listing_removal_requests where listing_id = $1`, [id]);
    expect(q).toMatchObject({ who: "owner", reason: "We closed last year", status: "open", hidden: true, listing_id: id });
    expect(q.requested_at).toBeTruthy();
    const lg = await db.one(`select action, by_party, request_id, at from listing_log where listing_id = $1`, [id]);
    expect(lg).toMatchObject({ action: "hide", by_party: null });
    expect(lg.request_id).toBeTruthy();
    const ex = await db.one(`select kind, ref, status, detail from ops_exceptions where kind = 'listing_removal' and ref = $1`, [id]);
    expect(ex).toMatchObject({ status: "open" });
    expect(ex.detail).toMatchObject({ listing_id: id, who: "owner" });
  });

  it("asks who the person is (owner, manager, staff, someone else) and takes a reason or none", async () => {
    const s = await newSession();
    expect(await asWeb<any>("web_listing_remove", { p_token: s, p_listing: listingId(31), p_who: "competitor", p_reason: null })).toMatchObject({ ok: false, error: "bad_who" });
    expect((await asWeb<any>("web_food_place", { p_id: listingId(31) })).ok).toBe(true);
    for (const [i, who] of ["manager", "staff", "other"].entries()) {
      const r = await asWeb<any>("web_listing_remove", { p_token: await newSession(), p_listing: listingId(32 + i), p_who: who, p_reason: null });
      expect(r, who).toMatchObject({ ok: true, hidden: true });
    }
    const long = await asWeb<any>("web_listing_remove", { p_token: await newSession(), p_listing: listingId(36), p_who: "owner", p_reason: "x".repeat(900) });
    expect(long.ok).toBe(true);
    expect((await db.one(`select length(reason)::int as n from listing_removal_requests where listing_id = $1`, [listingId(36)])).n).toBe(500);
  });

  it("a second request for a hidden page is the same request; no session, no hide; an unknown place is refused", async () => {
    const id = listingId(40);
    const s = await newSession();
    await asWeb("web_listing_remove", { p_token: s, p_listing: id, p_who: "owner", p_reason: null });
    const again = await asWeb<any>("web_listing_remove", { p_token: await newSession(), p_listing: id, p_who: "staff", p_reason: null });
    expect(again).toMatchObject({ ok: true, hidden: true, already: true });
    expect(Number((await db.one(`select count(*)::int as n from ops_exceptions where kind = 'listing_removal' and ref = $1 and status <> 'resolved'`, [id])).n)).toBe(1);
    expect(await asWeb<any>("web_listing_remove", { p_token: "y".repeat(40), p_listing: listingId(41), p_who: "owner", p_reason: null })).toMatchObject({ ok: false, error: "no_session" });
    expect((await asWeb<any>("web_food_place", { p_id: listingId(41) })).ok).toBe(true);
    expect(await asWeb<any>("web_listing_remove", { p_token: s, p_listing: "no-such-place-1", p_who: "owner", p_reason: null })).toMatchObject({ ok: false, error: "unknown_listing" });
  });

  it("is rate limited so a script cannot hide the map: past a session's cap a request is recorded and told to staff, not hidden", async () => {
    await db.pg.exec(`update settings set value = value || '{"removal_per_session_day": 2, "removal_per_hour": 1000}'::jsonb where key = 'listings'`);
    const s = await newSession();
    const res: any[] = [];
    for (let i = 50; i < 54; i++) res.push(await asWeb<any>("web_listing_remove", { p_token: s, p_listing: listingId(i), p_who: "other", p_reason: null }));
    expect(res.map((r) => r.hidden)).toEqual([true, true, false, false]);
    expect(res.every((r) => r.ok)).toBe(true);
    // the two over the cap are recorded for staff to look at, and their pages stay up
    expect((await asWeb<any>("web_food_place", { p_id: listingId(52) })).ok).toBe(true);
    expect(Number((await db.one(`select count(*)::int as n from listing_removal_requests where listing_id = any($1)`, [[listingId(52), listingId(53)]])).n)).toBe(2);
    expect(Number((await db.one(`select count(*)::int as n from ops_exceptions where kind = 'listing_removal' and ref = any($1)`, [[listingId(52), listingId(53)]])).n)).toBe(2);
    await db.pg.exec(`update settings set value = value || '{"removal_per_session_day": 5, "removal_per_hour": 20}'::jsonb where key = 'listings'`);
  });

  it("and so is everyone together: past the hourly cap a request is recorded, not hidden", async () => {
    const used = Number((await db.one(`select count(*)::int as n from listing_removal_requests where hidden and requested_at > now() - interval '1 hour'`)).n);
    await db.pg.exec(`update settings set value = value || '{"removal_per_hour": ${used + 2}}'::jsonb where key = 'listings'`);
    const out: boolean[] = [];
    for (const i of [60, 61, 62]) out.push((await asWeb<any>("web_listing_remove", { p_token: await newSession(), p_listing: listingId(i), p_who: "owner", p_reason: null })).hidden);
    expect(out).toEqual([true, true, false]);
    await db.pg.exec(`update settings set value = value || '{"removal_per_hour": 20}'::jsonb where key = 'listings'`);
  });

  it("is in the console's hidden list with its request", async () => {
    const r = await db.rpc<any[]>("listings_console", { p_q: "", p_state: "hidden", p_limit: 100 });
    const row = r.find((x) => x.listing_id === listingId(30))!;
    expect(row.hidden_at).toBeTruthy();
    expect(row.request).toMatchObject({ who: "owner", reason: "We closed last year", status: "open" });
    expect(r.every((x) => x.hidden_at)).toBe(true);
  });
});

describe("Restore", () => {
  it("only an ops lead or an admin can, with a reason; the page is back and the restore is logged", async () => {
    const id = listingId(30);
    for (const [who, why] of [[picker, "ok by me"], [customer, "please"]] as const) {
      await expect(db.rpc("restore_listing", { p_listing: id, p_by: who, p_reason: why })).rejects.toThrow(/NOT_AUTHORISED/);
    }
    await expect(db.rpc("restore_listing", { p_listing: id, p_by: lead, p_reason: "  " })).rejects.toThrow(/REASON_REQUIRED/);
    expect((await asWeb<any>("web_food_place", { p_id: id })).ok).toBe(false);
    const r = await db.rpc<any>("restore_listing", { p_listing: id, p_by: lead, p_reason: "The owner phoned: still open" });
    expect(r).toMatchObject({ ok: true });
    expect((await asWeb<any>("web_food_place", { p_id: id })).ok).toBe(true);
    const lg = await db.all<any>(`select action, by_party, reason from listing_log where listing_id = $1 order by id`, [id]);
    expect(lg.map((x) => x.action)).toEqual(["hide", "restore"]);
    expect(lg[1]).toMatchObject({ by_party: lead, reason: "The owner phoned: still open" });
    // the request and the staff case are closed with it
    expect((await db.one(`select status from listing_removal_requests where listing_id = $1`, [id])).status).toBe("closed");
    expect((await db.one(`select status from ops_exceptions where kind = 'listing_removal' and ref = $1`, [id])).status).toBe("resolved");
    // restoring a page that is not hidden is refused
    await expect(db.rpc("restore_listing", { p_listing: id, p_by: admin, p_reason: "again" })).rejects.toThrow(/NOT_HIDDEN/);
    await expect(db.rpc("restore_listing", { p_listing: "no-such-place-1", p_by: admin, p_reason: "again" })).rejects.toThrow(/UNKNOWN_LISTING/);
  });

  it("an admin can too; and the same place can be hidden and restored again, each time logged", async () => {
    const id = listingId(32);
    await db.rpc("restore_listing", { p_listing: id, p_by: admin, p_reason: "asked by the owner" });
    await asWeb("web_listing_remove", { p_token: await newSession(), p_listing: id, p_who: "owner", p_reason: "second time" });
    await db.rpc("restore_listing", { p_listing: id, p_by: lead, p_reason: "second restore" });
    expect((await db.all<any>(`select action from listing_log where listing_id = $1 order by id`, [id])).map((x) => x.action)).toEqual(["hide", "restore", "hide", "restore"]);
  });

  it("keeping a page hidden closes the request and the case without restoring, and is logged", async () => {
    const id = listingId(33);
    const req = (await db.one(`select id from listing_removal_requests where listing_id = $1`, [id])).id;
    await expect(db.rpc("keep_listing_hidden", { p_request: req, p_by: picker, p_note: "fine" })).rejects.toThrow(/NOT_AUTHORISED/);
    await db.rpc("keep_listing_hidden", { p_request: req, p_by: lead, p_note: "the owner confirmed by phone" });
    expect((await asWeb<any>("web_food_place", { p_id: id })).ok).toBe(false);
    expect((await db.one(`select status from listing_removal_requests where id = $1`, [req])).status).toBe("closed");
    expect((await db.one(`select status from ops_exceptions where kind = 'listing_removal' and ref = $1`, [id])).status).toBe("resolved");
    expect((await db.all<any>(`select action, reason from listing_log where listing_id = $1 order by id`, [id])).map((x) => x.action)).toEqual(["hide", "keep_hidden"]);
  });

  it("staff can hide a page themselves, with a reason: it is the way to act on a request that was over the cap", async () => {
    const id = listingId(52);                                   // a request over the session cap left this page up
    await expect(db.rpc("hide_listing", { p_listing: id, p_by: picker, p_reason: "asked by the owner" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("hide_listing", { p_listing: id, p_by: lead, p_reason: " " })).rejects.toThrow(/REASON_REQUIRED/);
    expect((await db.rpc<any>("hide_listing", { p_listing: id, p_by: lead, p_reason: "the owner confirmed by phone" })).ok).toBe(true);
    expect((await asWeb<any>("web_food_place", { p_id: id })).ok).toBe(false);
    expect((await db.all<any>(`select action, by_party from listing_log where listing_id = $1 order by id`, [id])).map((x) => x.action)).toEqual(["removal_request", "hide"]);
    expect((await db.one(`select status from listing_removal_requests where listing_id = $1`, [id])).status).toBe("closed");
    await db.rpc("restore_listing", { p_listing: id, p_by: lead, p_reason: "put back for the next test" });
  });

  it("the log cannot be edited or deleted", async () => {
    await expect(db.pg.exec(`update listing_log set reason = 'x'`)).rejects.toThrow(/append-only/i);
    await expect(db.pg.exec(`delete from listing_log`)).rejects.toThrow(/append-only/i);
  });
});

describe("Is this your place? Claim it", () => {
  it("is recognised by code: a staff case with the listing and the sender, and nothing is changed or sent", async () => {
    const id = listingId(70);
    const c = await newCustomer();
    const sentBefore = Number((await db.one(`select count(*)::int as n from wa_outbox`)).n);
    const r = await db.rpc<any>("claim_listing", { p_party: c.party, p_conversation: c.conv, p_text: `Claim ${id}`, p_wamid: "wamid.lv1-1" });
    expect(r).toMatchObject({ ok: true, status: "claimed", again: false, listing_id: id, name: rows[70]![1] });
    expect(r.case.case_id).toBeTruthy();
    const h = await db.one(`select kind, topic, state, conversation_id from handoffs where id = $1`, [r.case.case_id]);
    expect(h).toMatchObject({ kind: "other", state: "open", conversation_id: c.conv });
    expect(h.topic).toContain(id);
    const cl = await db.one(`select listing_id, party_id, conversation_id, case_id, wamid from listing_claims where listing_id = $1`, [id]);
    expect(cl).toMatchObject({ listing_id: id, party_id: c.party, conversation_id: c.conv, wamid: "wamid.lv1-1" });
    // a claim changes nothing about the listing and sends nothing (the reply is the turn's, through the gateway)
    expect((await db.one(`select hidden_at from listings where listing_id = $1`, [id])).hidden_at).toBeNull();
    expect(Number((await db.one(`select count(*)::int as n from wa_outbox`)).n)).toBe(sentBefore);
    expect((await db.one(`select action from listing_log where listing_id = $1 order by id desc limit 1`, [id])).action).toBe("claim");
  });

  it("the same person claiming again is the same claim; a second place by the same person adds to the open case", async () => {
    const id = listingId(71); const id2 = listingId(72);
    const c = await newCustomer();
    const a = await db.rpc<any>("claim_listing", { p_party: c.party, p_conversation: c.conv, p_text: `claim ${id}`, p_wamid: "w1" });
    const b = await db.rpc<any>("claim_listing", { p_party: c.party, p_conversation: c.conv, p_text: `  CLAIM   ${id}  `, p_wamid: "w2" });
    expect(b).toMatchObject({ ok: true, status: "claimed", again: true });
    expect(b.case.case_id).toBe(a.case.case_id);
    expect(Number((await db.one(`select count(*)::int as n from listing_claims where listing_id = $1`, [id])).n)).toBe(1);
    const d = await db.rpc<any>("claim_listing", { p_party: c.party, p_conversation: c.conv, p_text: `Claim ${id2}`, p_wamid: "w3" });
    expect(d.status).toBe("claimed");
    expect(d.case.case_id).toBe(a.case.case_id);
    expect((await db.one(`select topic from handoffs where id = $1`, [a.case.case_id])).topic).toContain(id2);
    // two people may each claim the same place: staff sort it out; nothing is decided by arriving first
    const c2 = await newCustomer();
    expect((await db.rpc<any>("claim_listing", { p_party: c2.party, p_conversation: c2.conv, p_text: `Claim ${id}`, p_wamid: "w4" })).status).toBe("claimed");
    expect(Number((await db.one(`select count(*)::int as n from listing_claims where listing_id = $1`, [id])).n)).toBe(2);
  });

  it("anything that is not 'Claim' and a known listing is not a claim, and costs nothing", async () => {
    const c = await newCustomer();
    for (const text of ["Claim my refund please", "I want to claim a refund", "Claim", `Claim ${listingId(73)} please`, "claim no-such-place-1", "hello", ""]) {
      const r = await db.rpc<any>("claim_listing", { p_party: c.party, p_conversation: c.conv, p_text: text, p_wamid: "w" });
      expect(r.ok, text).toBe(false);
      expect(["not_a_claim", "unknown"], text).toContain(r.status);
    }
    expect(Number((await db.one(`select count(*)::int as n from listing_claims where party_id = $1`, [c.party])).n)).toBe(0);
    expect(Number((await db.one(`select count(*)::int as n from handoffs where conversation_id = $1`, [c.conv])).n)).toBe(0);
  });

  it("is for the customer line only, and never reachable from the website", async () => {
    const staffConv = (await db.one(`insert into conversations(line, party_id) values ('ops', $1) returning id`, [lead])).id;
    await expect(db.rpc("claim_listing", { p_party: lead, p_conversation: staffConv, p_text: `Claim ${listingId(74)}`, p_wamid: "w" })).rejects.toThrow();
  });

  it("is in the console's claims list with the sender's number and the case", async () => {
    const r = await db.rpc<any[]>("listing_claims_console", { p_limit: 50 });
    const row = r.find((x) => x.listing_id === listingId(70))!;
    expect(row).toMatchObject({ name: rows[70]![1], state: "open" });
    expect(row.phone).toMatch(/^\+96170000/);
    expect(row.case_id).toBeTruthy();
  });
});

describe("a listing is never a merchant", () => {
  it("nothing here opens a restaurant: the merchants table and approve_merchant are untouched by the listings", async () => {
    // invariant 11: approve_merchant() is the only way; no function of 0224 writes merchants, sources, offers, products or orders
    const src = readFileSync(fileURLToPath(new URL("../../supabase/migrations/0224_listings.sql", import.meta.url)), "utf8").replace(/--.*$/gm, "");
    expect(src).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+(merchants|sources|offers|products|orders|order_items|stock_levels|payments|ledger_entries)\b/i);
    expect(src).not.toMatch(/approve_merchant/i);
  });
});
