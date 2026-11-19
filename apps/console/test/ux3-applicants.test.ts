// UX3: the Riders page's Applicants tab. People who applied on /join/rider wait here for a person (an ops lead or an admin): accept creates the rider through
// accept_rider_application; decline needs a reason; both are logged (staff_actions and join_log). The application is not a rider: nothing here starts a shift,
// records terms or sends a message. No rating, score or rank of an applicant.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig; let seq = 0;
afterEach(() => vi.unstubAllGlobals());
const who = async (role: "ops_lead" | "picker" | "admin", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };
/** A page without its <script> or <style> blocks, found by a plain search (any letter case) and cut from the opening tag to the end of the closing one (as test/web/web2-pages.test.ts does). */
const dropBlocks = (html: string, tag: "script" | "style"): string => {
  let out = html;
  for (;;) {
    const low = out.toLowerCase();
    const from = low.indexOf(`<${tag}`);
    if (from < 0) return out;
    const close = low.indexOf(`</${tag}`, from);
    const end = close < 0 ? out.length : (low.indexOf(">", close) < 0 ? out.length : low.indexOf(">", close) + 1);
    out = out.slice(0, from) + " " + out.slice(end);
  }
};
/** Every tag out, repeated until none is left, then the entities. */
const untag = (html: string): string => { let out = html, prev = ""; while (out !== prev) { prev = out; out = out.replace(/<[^<>]*>/g, " "); } return out.replace(/[<>]/g, " "); };
const text = (h: string) => untag(dropBlocks(dropBlocks(h, "script"), "style")).replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/** An applicant the way the website makes one: a session, a code sent to the customer line, then the application. */
async function applicant(name: string, over: { licence?: boolean; village?: string; days?: string[]; shifts?: string[] } = {}) {
  seq++;
  const s = await r.db.rpc<{ token: string }>("web_session_start", { p_device: "test" });
  const code = await r.db.rpc<any>("web_join_code", { p_token: s.token, p_purpose: "rider" });
  const party = (await r.db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`UX3 applicant ${seq}`])).id;
  await r.db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-ux3c-${seq}', '+96170000${String(400 + seq)}')`);
  await r.db.pg.exec(`insert into conversations(line, party_id, last_inbound_at) values ('customer', '${party}', now())`);
  await r.db.rpc("claim_link_code", { p_party: party, p_code: code.code, p_wamid: `wamid-ux3c-${seq}` });
  const a = await r.db.rpc<any>("web_apply_rider", { p_token: s.token, p_name: name, p_village: over.village ?? "Baakline", p_vehicle: "motorbike", p_licence: over.licence ?? true,
    p_days: over.days ?? ["mon", "sat"], p_shifts: over.shifts ?? ["morning"] });
  return { id: a.id as string, party, phone: `+96170000${String(400 + seq)}` };
}
beforeAll(async () => { r = await rig(); }, 120_000);

describe("the tab", () => {
  it("Riders has two tabs, the roster and the applicants with how many wait; the roster is where it was", async () => {
    await applicant("Tab Test One");
    const lead = await who("ops_lead", "Maya");
    const t = (await lead.b.get("/riders")).text;
    expect(t).toMatch(/aria-label="Riders"[\s\S]*Roster[\s\S]*Applicants/);
    expect(t).toMatch(/href="\/riders\?tab=applicants"[^>]*>[\s\S]*Applicants[\s\S]*?<span class="ak-count"[^>]*>1<\/span>/);
    expect(t).toContain("Who rides, who is on shift");                                       // still the roster
  });

  it("lists each waiting applicant with what they wrote, their number (staff only), the case in the Inbox, and the two buttons; leads only", async () => {
    const a = await applicant("Nadim Applicant", { licence: false, village: "Somewhere Else", days: ["tue", "fri"], shifts: ["morning", "evening"] });
    const lead = await who("ops_lead", "Maya2");
    const t = (await lead.b.get("/riders?tab=applicants")).text;
    const flat = text(t);
    expect(flat).toContain("Nadim Applicant"); expect(flat).toContain("Somewhere Else"); expect(flat).toContain("Motorbike");
    expect(flat).toMatch(/Licence:\s*no/i);
    expect(flat).toContain("Tuesday"); expect(flat).toContain("Friday");
    expect(flat).toContain("Morning"); expect(flat).toContain("09:00–15:00"); expect(flat).toContain("Evening"); expect(flat).toContain("15:00–21:00");   // the shifts are settings.join's (0252)
    expect(flat).toContain(a.phone);
    const caseId = (await r.db.one(`select case_id from join_applications where id = $1`, [a.id])).case_id;
    expect(t).toContain(`href="/inbox/${caseId}"`);
    expect(t).toContain(`action="/riders/applicants/${a.id}/accept"`); expect(t).toContain(`action="/riders/applicants/${a.id}/decline"`);
    expect(t).toMatch(/name="reason"[^>]*required/);
    expect(flat).toMatch(/Applying does not make anyone a rider|not a rider yet/i);
    expect((await (await who("picker", "Pia")).b.get("/riders?tab=applicants")).status).toBe(403);
  });

  it("has no rating, score or ranking of an applicant", async () => {
    const lead = await who("ops_lead", "Maya3");
    const flat = text((await lead.b.get("/riders?tab=applicants")).text).replace(/Riders are never rated or scored here[^.]*\./, "").replace(/never rated, scored or ranked/g, "");
    expect(flat).not.toMatch(/\b(rating|rated|score|scored|ranking|ranked|stars|best|top)\b/i);
    expect(/\d(\.\d)?\s*\/\s*5|★|⭐/.test(flat)).toBe(false);
  });
});

describe("accept", () => {
  it("creates the rider through accept_rider_application, logs it twice, starts no shift, records no terms, sends nothing, and the roster shows them", async () => {
    const a = await applicant("Karim Accepted");
    const lead = await who("ops_lead", "Maya4");
    const drivers = Number((await r.db.one(`select count(*)::int as n from parties where role = 'driver'`)).n);
    await lead.b.get("/riders?tab=applicants");
    const res = await lead.b.post(`/riders/applicants/${a.id}/accept`);
    expect(flashOf(res.text)).toBe("Karim Accepted is now a rider. Next: record their written terms on the roster.");
    expect(Number((await r.db.one(`select count(*)::int as n from parties where role = 'driver'`)).n)).toBe(drivers + 1);
    const row = await r.db.one(`select status, rider_party_id, decided_by from join_applications where id = $1`, [a.id]);
    expect(row).toMatchObject({ status: "accepted", decided_by: lead.partyId });
    expect(Number((await r.db.one(`select count(*)::int as n from driver_shifts where driver_id = $1`, [row.rider_party_id])).n)).toBe(0);
    expect(Number((await r.db.one(`select count(*)::int as n from rider_terms where driver_id = $1`, [row.rider_party_id])).n)).toBe(0);
    const acts = (await r.actions()).filter((x: any) => x.action === "rider_applicant_accept").map((x: any) => x.phase);
    expect(acts).toEqual(expect.arrayContaining(["intent", "done"]));
    expect((await r.db.all(`select action from join_log where application_id = $1 order by id`, [a.id])).map((x: any) => x.action)).toEqual(["apply", "accept"]);
    const roster = text((await lead.b.get("/riders")).text);
    expect(roster).toContain("Karim Accepted"); expect(roster).toContain("not on file");
    const tab = text((await lead.b.get("/riders?tab=applicants")).text);
    expect(tab).toMatch(/Decided[\s\S]*Karim Accepted[\s\S]*Accepted/);
  });

  it("an admin may accept; a picker may not; a second decision is told plainly and changes nothing", async () => {
    const a = await applicant("Second Decision");
    const admin = await who("admin", "Adam");
    await admin.b.get("/riders?tab=applicants");
    expect(flashOf((await admin.b.post(`/riders/applicants/${a.id}/accept`)).text)).toContain("is now a rider");
    const lead = await who("ops_lead", "Maya5");
    await lead.b.get("/riders?tab=applicants");
    expect(flashOf((await lead.b.post(`/riders/applicants/${a.id}/accept`)).text)).toBe("Someone already decided this application.");
    expect(flashOf((await lead.b.post(`/riders/applicants/${a.id}/decline`, { reason: "too late" })).text)).toBe("Someone already decided this application.");
    expect((await (await who("picker", "Pia2")).b.post(`/riders/applicants/${a.id}/accept`, {}, { follow: false })).status).toBe(403);
  });

  it("a number already on the ops line is told in words, and the application stays open", async () => {
    const a = await applicant("Already Staff");
    await r.db.pg.query(`insert into party_identities(party_id, line, phone_e164) values ((select id from parties where role = 'ops_lead' limit 1), 'ops', $1)`, [a.phone]);
    const lead = await who("ops_lead", "Maya6");
    await lead.b.get("/riders?tab=applicants");
    expect(flashOf((await lead.b.post(`/riders/applicants/${a.id}/accept`)).text)).toBe("This number is already on the ops line, so they are a rider or staff already. Nothing was changed.");
    expect((await r.db.one(`select status from join_applications where id = $1`, [a.id])).status).toBe("open");
  });
});

describe("decline", () => {
  it("needs a reason, keeps it, makes no rider, and shows who declined and why under Decided", async () => {
    const a = await applicant("Dana Declined");
    const lead = await who("ops_lead", "Maya7");
    await lead.b.get("/riders?tab=applicants");
    expect(flashOf((await lead.b.post(`/riders/applicants/${a.id}/decline`, { reason: " " })).text)).toBe("Write the reason (at least 3 characters).");
    expect((await r.db.one(`select status from join_applications where id = $1`, [a.id])).status).toBe("open");
    const drivers = Number((await r.db.one(`select count(*)::int as n from parties where role = 'driver'`)).n);
    const res = await lead.b.post(`/riders/applicants/${a.id}/decline`, { reason: "No vehicle for the roads we cover" });
    expect(flashOf(res.text)).toBe("Declined. The reason is kept.");
    expect(Number((await r.db.one(`select count(*)::int as n from parties where role = 'driver'`)).n)).toBe(drivers);
    expect(await r.db.one(`select status, decision_reason, decided_by from join_applications where id = $1`, [a.id])).toMatchObject({ status: "declined", decision_reason: "No vehicle for the roads we cover", decided_by: lead.partyId });
    const flat = text((await lead.b.get("/riders?tab=applicants")).text);
    expect(flat).toMatch(/Decided[\s\S]*Dana Declined[\s\S]*Declined[\s\S]*Maya7[\s\S]*No vehicle for the roads we cover/);
    const acts = (await r.actions()).filter((x: any) => x.action === "rider_applicant_decline").map((x: any) => x.phase);
    expect(acts).toEqual(expect.arrayContaining(["intent", "done"]));
  });
});

describe("Arabic", () => {
  it("the tabs, the answers and the buttons are in Arabic, right to left, and the shifts keep their times", async () => {
    await applicant("Layla Applicant");
    const lead = await who("ops_lead", "Maya8", "ar");
    const t = (await lead.b.get("/riders?tab=applicants")).text;
    expect(t).toMatch(/<html lang="ar" dir="rtl">/);
    for (const w of ["المتقدّمون", "قبول", "رفض", "رخصة", "دراجة نارية"]) expect(t, w).toContain(w);
    expect(text(t)).toContain("09:00–15:00");
    expect(t).not.toContain("المركز");
  });
});
