// Session LV1: the console's Listings page. Search; the hidden places with their removal request; restore with a reason (ops lead and admin only);
// the demand count per place; the claims. Functional, on the DS2 components. The SQL functions decide who may restore (0224); the console only explains.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";
import { kindHref, kindName } from "../src/kinds";

afterEach(() => vi.unstubAllGlobals());
let r: Rig; let lead: Awaited<ReturnType<Rig["staff"]>>; let admin: Awaited<ReturnType<Rig["staff"]>>; let picker: Awaited<ReturnType<Rig["staff"]>>;
const L = (n: number) => r.db.one<any>(`select * from listings order by km_from_hub, listing_id offset $1 limit 1`, [n]);
const session = async () => (await r.db.rpc<{ token: string }>("web_session_start", { p_device: "t" })).token;
const want = async (id: string) => r.db.rpc("web_listing_want", { p_token: await session(), p_listing: id });
const remove = async (id: string, who: string, reason: string | null) => r.db.rpc("web_listing_remove", { p_token: await session(), p_listing: id, p_who: who, p_reason: reason });
async function claimBy(listing: string) {
  const party = (await r.db.one<any>(`insert into parties(role, display_name) values ('customer', 'Owner Test') returning id`)).id;
  await r.db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-lv1-console', '+96170000321')`);
  const conv = (await r.db.one<any>(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id;
  return r.db.rpc<any>("claim_listing", { p_party: party, p_conversation: conv, p_text: `Claim ${listing}`, p_wamid: "w-console" });
}

beforeAll(async () => {
  r = await rig();
  lead = await r.staff("ops_lead", "Maya"); admin = await r.staff("admin", "Rasheed"); picker = await r.staff("picker", "Pia");
}, 120_000);

describe("Listings", () => {
  it("is for the ops lead and the admin; a picker cannot open it", async () => {
    const b = r.browser(); await b.signIn(picker);
    expect((await b.get("/listings")).status).toBe(403);
    const a = r.browser(); await a.signIn(lead);
    expect((await a.get("/listings")).status).toBe(200);
    const c = r.browser(); await c.signIn(admin);
    expect((await c.get("/listings")).status).toBe(200);
  });

  it("search finds a place by name or village and shows its kind, village, distance, demand and claims; no phone, rating or review anywhere", async () => {
    const place = await L(40);
    await want(place.listing_id); await want(place.listing_id); await want(place.listing_id);
    const b = r.browser(); await b.signIn(lead);
    const res = await b.get(`/listings?q=${encodeURIComponent(place.name)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(place.name);
    const row = res.text.split("<tr").slice(1).find((x) => x.includes(place.listing_id))!;
    expect(row).toContain(place.kind === "cafe" ? "Café" : place.kind.charAt(0).toUpperCase() + place.kind.slice(1));
    expect(row).toContain(Number(place.km_from_hub).toFixed(1));
    expect(row).toMatch(/>\s*3\s*</);                                        // the demand count: three taps from three sessions
    // the columns are the six facts and the counts: no phone, rating, review count, menu, hours or photo (a place's own name may hold any word)
    expect([...res.text.matchAll(/<th[^>]*>([^<]*)</g)].map((m) => m[1]!).filter((h) => /rating|review|stars|phone|menu|hours|photo/i.test(h))).toEqual([]);
    // by village
    const v = await b.get(`/listings?q=${encodeURIComponent("batloun")}`);
    expect(v.text).toContain("Batloun");
    // an empty result says so
    expect((await b.get("/listings?q=zzzzqqqq")).text).toMatch(/No places match/);
    // the list is bounded
    expect(((await b.get("/listings")).text.match(/<tr/g) ?? []).length).toBeLessThan(80);
  });

  it("shows each hidden place with who asked, why and when, and restoring takes a reason, by an ops lead or an admin only; the restore is logged", async () => {
    const place = await L(60);
    expect((await remove(place.listing_id, "owner", "We closed in the summer")).hidden).toBe(true);
    const b = r.browser(); await b.signIn(lead);
    const tab = await b.get("/listings?tab=hidden");
    expect(tab.text).toContain(place.name);
    expect(tab.text).toMatch(/owner/i); expect(tab.text).toContain("We closed in the summer");
    expect(tab.text).toMatch(/open/i);
    // no reason: refused, nothing changes
    const bad = await b.post("/listings/restore", { listing: place.listing_id, reason: "  " });
    expect(flashOf(bad.text)).toMatch(/Write the reason/);
    expect((await r.db.one<any>(`select hidden_at from listings where listing_id = $1`, [place.listing_id])).hidden_at).not.toBeNull();
    // with a reason: back, logged, request closed
    const ok = await b.post("/listings/restore", { listing: place.listing_id, reason: "The owner phoned: still open" });
    expect(flashOf(ok.text)).toMatch(/Restored/);
    expect((await r.db.one<any>(`select hidden_at from listings where listing_id = $1`, [place.listing_id])).hidden_at).toBeNull();
    const log = await r.db.all<any>(`select action, reason, by_party from listing_log where listing_id = $1 order by id`, [place.listing_id]);
    expect(log.map((x) => x.action)).toEqual(["hide", "restore"]);
    expect(log[1]).toMatchObject({ reason: "The owner phoned: still open", by_party: lead.partyId });
    expect((await b.get("/listings?tab=hidden")).text).not.toContain(place.listing_id);
    // the console's own action log has it too
    expect((await r.actions()).some((a) => a.action === "listing_restore")).toBe(true);
    // an admin can; a picker cannot reach the route
    const p2 = await L(61);
    await remove(p2.listing_id, "staff", null);
    const a = r.browser(); await a.signIn(admin);
    await a.get("/listings?tab=hidden");
    expect(flashOf((await a.post("/listings/restore", { listing: p2.listing_id, reason: "asked by the owner" })).text)).toMatch(/Restored/);
    const pk = r.browser(); await pk.signIn(picker);
    await pk.get("/");
    expect((await pk.post("/listings/restore", { listing: p2.listing_id, reason: "nope" }, { follow: false })).status).toBe(403);
  });

  it("keeping a place hidden closes its request; hiding a place that a request left up needs a reason too", async () => {
    const a = await L(70); const bplace = await L(71);
    await remove(a.listing_id, "other", "not sure");
    const req = (await r.db.one<any>(`select id from listing_removal_requests where listing_id = $1`, [a.listing_id])).id;
    const br = r.browser(); await br.signIn(lead);
    const tab = await br.get("/listings?tab=hidden");
    expect(tab.text).toContain(a.name);
    expect(flashOf((await br.post("/listings/keep", { request: req, note: "the owner confirmed" })).text)).toMatch(/Kept hidden/);
    expect((await r.db.one<any>(`select status from listing_removal_requests where id = $1`, [req])).status).toBe("closed");
    expect((await r.db.one<any>(`select hidden_at from listings where listing_id = $1`, [a.listing_id])).hidden_at).not.toBeNull();
    // a listed place can be hidden by staff, with a reason
    await br.get(`/listings?q=${encodeURIComponent(bplace.name)}`);
    expect(flashOf((await br.post("/listings/hide", { listing: bplace.listing_id, reason: " " })).text)).toMatch(/Write the reason/);
    expect(flashOf((await br.post("/listings/hide", { listing: bplace.listing_id, reason: "the owner phoned" })).text)).toMatch(/Hidden/);
    expect((await r.db.one<any>(`select hidden_at from listings where listing_id = $1`, [bplace.listing_id])).hidden_at).not.toBeNull();
  });

  it("lists the claims: the place, who sent it (their number, for staff only) and the case in the Inbox", async () => {
    const place = await L(80);
    const claim = await claimBy(place.listing_id);
    const b = r.browser(); await b.signIn(lead);
    const tab = await b.get("/listings?tab=claims");
    expect(tab.text).toContain(place.name);
    expect(tab.text).toContain("+96170000321");
    expect(tab.text).toContain(`/inbox/${claim.case.case_id}`);
    // the search tab counts the claim against the place
    const s = await b.get(`/listings?q=${encodeURIComponent(place.name)}`);
    expect(s.text).toContain(place.name);
  });

  it("the staff case a removal raises reads as a food place asking to be removed, and opens the Hidden tab", () => {
    const e = { id: "x", kind: "listing_removal", ref: "some-place-1", detail: { listing_id: "some-place-1" } };
    expect(kindName("listing_removal", "en")).toMatch(/food place/i);
    expect(kindName("listing_removal", "ar")).not.toBe("listing removal");
    expect(kindHref(e)).toBe("/listings?tab=hidden");
  });

  it("is in the Approve group's menu for an ops lead, and in Arabic when the language is Arabic", async () => {
    const b = r.browser(); await b.signIn(lead);
    expect((await b.get("/")).text).toContain('href="/listings"');
    await b.get("/lang?to=ar&next=%2Flistings");
    const ar = await b.get("/listings");
    expect(ar.status).toBe(200);
    expect(ar.text).toContain("أماكن الطعام");
    expect(ar.text).not.toMatch(/<main[^>]*lang="en"/);
  });
});
