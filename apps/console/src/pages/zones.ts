// 3.9 Zones and fees: which villages are served, their zone, and each zone's delivery fee and ETA. All of it is data
// (invariant 13); nothing here names a village or a fee. Edits are the admin's, with a reason, through set_zone() and
// set_village() (0045). The delivery fee is the rider's (invariant 10).
import { act, can, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { form, Raw, usd } from "../html";
import { ADMIN, LEADS } from "../roles";

type Zone = { id: string; name: string; delivery_fee_usd: number | string; base_eta_minutes: number; is_active: boolean };
type Village = { id: string; name_en: string; name_ar: string | null; zone_id: string | null; is_served: boolean };
const checked = (b: boolean) => new Raw(b ? " checked" : "");

async function page(c: Ctx) {
  const { db } = c.deps;
  const [zones, villages, hubVillage, ready] = await Promise.all([
    db.rows<Zone>("zones", { select: "id,name,delivery_fee_usd,base_eta_minutes,is_active", order: [{ col: "name" }] }),
    db.rows<Village>("villages", { select: "id,name_en,name_ar,zone_id,is_served", order: [{ col: "name_en" }], limit: 2000 }),
    db.rpc<string | null>("hub_village", {}),
    db.hasFunction("set_zone"),
  ]);
  const edit = ready && can(c, ADMIN);
  const zoneName = (z: string | null) => zones.find((x) => x.id === z)?.name ?? "—";
  return render(c, "Zones and fees", html`
<p id="hub">Hub village: <strong>${villages.find((v) => v.id === hubVillage)?.name_en ?? "not set"}</strong>. The hub is not final: moving it is a data change (see BUILD_PLAN "Hub and zones").
Served villages: ${villages.filter((v) => v.is_served).length} of ${villages.length}.</p>
${!ready ? html`<p class="note">Editing needs set_zone() and set_village(), not in the database yet (see docs/HANDOFF.md, Console).</p>`
  : !can(c, ADMIN) ? html`<p class="muted">Only the admin changes zones and fees.</p>` : ""}
<h2>Zones</h2>
<table><tr><th>Zone</th><th>Delivery fee (the rider's)</th><th>ETA, minutes</th><th>Active</th>${edit ? html`<th>Change, with a reason</th>` : ""}</tr>
${zones.map((z) => html`<tr><td>${z.name}</td><td>${usd(z.delivery_fee_usd)}</td><td>${z.base_eta_minutes}</td><td>${z.is_active ? "yes" : "no"}</td>
${edit ? html`<td>${form(c.f, `/zones/${z.id}`, html`<input type="number" name="fee_usd" step="0.25" min="0" value="${Number(z.delivery_fee_usd).toFixed(2)}">
<input type="number" name="eta_minutes" min="5" max="480" value="${z.base_eta_minutes}"> <label><input type="checkbox" name="active" value="1"${checked(z.is_active)}> active</label>
<input name="reason" minlength="3" maxlength="200" placeholder="reason" required> <button>Save</button>`, { cls: "inline" })}</td>` : ""}</tr>`)}</table>
<h2>Villages</h2>
<table><tr><th>Village</th><th>Zone</th><th>Served</th>${edit ? html`<th>Change, with a reason</th>` : ""}</tr>
${villages.map((v) => html`<tr><td>${v.name_en}${v.name_ar ? html` <span class="muted">${v.name_ar}</span>` : ""}</td><td>${zoneName(v.zone_id)}</td><td>${v.is_served ? "yes" : "no"}</td>
${edit ? html`<td>${form(c.f, `/villages/${v.id}`, html`<select name="zone">${zones.map((z) => html`<option value="${z.id}"${new Raw(z.id === v.zone_id ? " selected" : "")}>${z.name}</option>`)}</select>
<label><input type="checkbox" name="served" value="1"${checked(v.is_served)}> served</label>
<input name="reason" minlength="3" maxlength="200" placeholder="reason" required> <button>Save</button>`, { cls: "inline" })}</td>` : ""}</tr>`)}</table>`);
}

function reason(c: Ctx) {
  const r = text(c, "reason", 200);
  if (r.length < 3) throw new UserError("Write the reason for the change.");
  return r;
}

async function saveZone(c: Ctx) {
  const zone = id(c, "zone");
  const fee = num(c, "fee_usd", { min: 0, max: 100 })!;
  const eta = num(c, "eta_minutes", { min: 5, max: 480 })!;
  const active = c.form.active === "1";
  const why = reason(c);
  return act(c, "zone_change", { zone, fee_usd: fee, eta_minutes: eta, active, reason: why }, async () => {
    const r = await c.deps.db.rpc<{ before: { delivery_fee_usd: number | string; base_eta_minutes: number; is_active: boolean } }>("set_zone", {
      p_zone: zone, p_fee_usd: fee, p_eta_minutes: Math.round(eta), p_active: active, p_by: c.staff.partyId, p_reason: why,
    });
    return `Zone saved: fee ${usd(fee)}, ETA ${Math.round(eta)} min${active ? "" : ", inactive"} (was ${usd(r.before.delivery_fee_usd)}, ${r.before.base_eta_minutes} min).`;
  }, "/zones");
}

async function saveVillage(c: Ctx) {
  const village = id(c, "village");
  const zone = (c.form.zone ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(zone)) throw new UserError("Pick a zone.");
  const served = c.form.served === "1";
  const why = reason(c);
  return act(c, "village_change", { village, zone, served, reason: why }, async () => {
    await c.deps.db.rpc("set_village", { p_village: village, p_zone: zone, p_served: served, p_by: c.staff.partyId, p_reason: why });
    return served ? "Village saved: served." : "Village saved: not served.";
  }, "/zones");
}

export const zonesSection: Section = {
  nav: { href: "/zones", label: "Zones and fees", roles: LEADS },
  routes: [
    { method: "GET", path: "/zones", roles: LEADS, handler: page },
    { method: "POST", path: "/zones/:zone", roles: ADMIN, handler: saveZone },
    { method: "POST", path: "/villages/:village", roles: ADMIN, handler: saveVillage },
  ],
};
