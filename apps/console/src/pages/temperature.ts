// WH1a: the temperature log by photo (docs/strategy/02-journeys.md, section 4, "Cold chain"; migration 0240). Twice a day someone photographs
// the chilled zone's thermometer and types what it shows. The photo is the proof, kept in the private media bucket under
// temperature/<hub>/<day>/ (shown only through a short-lived link); the number is typed by the person: no model reads it. The range and the
// reading times are data (settings.temperature_log). Out of range raises the staff alert at once; a reading time that passes with no
// reading raises one from the cron (temperature_log_check, run by the console's Worker every two minutes), and a late reading closes it.
import { flashRedirect, form, html, render, text, upload, UserError, type Ctx, type Section } from "../app";
import { when } from "../html";
import { pick, type Lang } from "../i18n";
import { ALL } from "../roles";
import { badge, button, input, select, type Tone } from "@ak/ui/components";
import { formKey, hubId, plain, zoneWord } from "./warehouse";
import { attempt } from "../app";

type Slot = { zone: string; slot: string; from: string; by: string; state: string; reading_c: number | string | null; in_range: boolean | null; taken_at: string | null };
type Reading = { reading_id: string; zone: string; reading_c: number | string; in_range: boolean; slot: string | null; taken_at: string; taken_by: string | null; note: string | null; photo_path: string };
type Day = { day: string; zones: Record<string, { min_c: number; max_c: number }>; slots: Slot[]; readings: Reading[] };

const STATE: Record<string, [string, string, Tone]> = { done: ["done", "تمّ", "ok"], late: ["late", "متأخّر", "warn"], missed: ["missed", "فات", "danger"], due: ["to do", "مطلوب", "neutral"], not_started: ["log not started", "السجل لم يبدأ", "neutral"] };
const SLOT: Record<string, [string, string]> = { morning: ["Morning", "الصباح"], evening: ["Evening", "المساء"] };
const slotWord = (L: Lang, s: string | null) => (s && SLOT[s] ? pick(L, SLOT[s]![0], SLOT[s]![1]) : s ?? "");
const deg = (v: number | string | null) => `${Number(v ?? 0)} °C`;
const range = (r: { min_c: number; max_c: number } | undefined) => (r ? `${Number(r.min_c)} to ${Number(r.max_c)} °C` : "");
const rangeAr = (r: { min_c: number; max_c: number } | undefined) => (r ? `من ${Number(r.min_c)} إلى ${Number(r.max_c)} °م` : "");

async function page(c: Ctx) {
  const L = c.lang;
  const src = await hubId(c);
  const [today, recent] = await Promise.all([
    c.deps.db.rpc<Day>("temperature_log_day", { p_source: src, p_day: null }),
    c.deps.db.rpc<Day[]>("temperature_log_recent", { p_source: src, p_days: 14 }),
  ]);
  const zones = Object.keys(today.zones);
  const links = await Promise.all(today.readings.map((r) => c.deps.media.sign(r.photo_path, 600).catch(() => null)));
  const slotCard = (s: Slot) => { const w = STATE[s.state] ?? [s.state, s.state, "neutral" as Tone];
    return html`<li data-state="${s.state === "missed" ? "late" : s.state === "done" ? "done" : ""}"><div class="head"><strong>${zoneWord(L, s.zone)} · ${slotWord(L, s.slot)}</strong>${badge(pick(L, w[0], w[1]), w[2], s.state === "missed" ? "alert" : s.state === "due" ? "clock" : "check")}</div>
<p class="muted">${pick(L, `from ${s.from}, by ${s.by}`, `من ${s.from} حتى ${s.by}`)}${s.reading_c !== null ? html` · <strong>${deg(s.reading_c)}</strong>${s.in_range === false ? html` ${badge(pick(L, "out of range", "خارج المدى"), "danger", "warn")}` : ""}` : ""}</p></li>`; };
  return render(c, pick(L, "Temperature log", "سجل الحرارة"), html`
<p class="muted">${zones.map((z) => pick(L, `${zoneWord(L, z)}: ${range(today.zones[z])}.`, `${zoneWord(L, z)}: ${rangeAr(today.zones[z])}.`)).join(" ")} ${pick(L, "Twice a day: photograph the thermometer and type what it shows.", "مرّتان في اليوم: صوّر ميزان الحرارة واكتب ما يظهره.")}</p>
<h2>${pick(L, `Today, ${today.day}`, `اليوم، ${today.day}`)}</h2>
<ul class="ak-rows">${today.slots.map(slotCard)}</ul>
<h2>${pick(L, "Take a reading", "سجّل قراءة")}</h2>
${form(c.f, "/temperature", html`<div class="ak-money-fields">
${zones.length > 1 ? select({ name: "zone", label: pick(L, "Zone", "المنطقة"), options: zones.map((z) => ({ value: z, label: zoneWord(L, z) })) }) : html`<input type="hidden" name="zone" value="${zones[0] ?? "chilled"}">`}
${input({ name: "reading_c", label: pick(L, "The thermometer shows (°C)", "ميزان الحرارة يظهر (°م)"), type: "number", required: true, attrs: { step: "0.1", min: "-40", max: "60", inputmode: "decimal" } })}
<label class="ak-field"><span>${pick(L, "Photo of the thermometer", "صورة ميزان الحرارة")}</span><input class="ak-input" type="file" name="photo" accept="image/*" capture="environment" required></label>
${input({ name: "note", label: pick(L, "Note (what you did, if out of range)", "ملاحظة (ما فعلت إن كانت خارج المدى)"), maxlength: 200 })}</div>
<div class="actions-row">${button({ label: pick(L, "Save the reading", "احفظ القراءة"), icon: "camera", variant: "primary" })}</div>`, { files: true })}
${today.readings.length ? html`<h2>${pick(L, "Today's readings", "قراءات اليوم")}</h2><ul class="ak-rows">${today.readings.map((r, i) => html`<li${r.in_range ? "" : html` data-state="late"`}><div class="head"><strong>${deg(r.reading_c)} · ${zoneWord(L, r.zone)}</strong>${r.in_range ? badge(pick(L, "in range", "ضمن المدى"), "ok", "check") : badge(pick(L, "out of range", "خارج المدى"), "danger", "warn")}</div>
<p class="muted">${when(r.taken_at)} · ${r.taken_by ?? ""}${r.slot ? html` · ${slotWord(L, r.slot)}` : ""}${links[i] ? html` · <a href="${links[i]!}" rel="noopener">${pick(L, "the photo", "الصورة")}</a>` : ""}</p>${r.note ? html`<p>${r.note}</p>` : ""}</li>`)}</ul>` : ""}
<h2>${pick(L, "The last 14 days", "آخر 14 يوماً")}</h2>
<div class="ak-table-wrap"><table class="ak-table"><thead><tr><th>${pick(L, "Day", "اليوم")}</th>${today.slots.map((s) => html`<th>${zoneWord(L, s.zone)} · ${slotWord(L, s.slot)}</th>`)}</tr></thead>
<tbody>${recent.map((d) => html`<tr><td><bdi>${d.day}</bdi></td>${d.slots.map((s) => { const w = STATE[s.state] ?? [s.state, s.state, "neutral" as Tone]; return html`<td>${s.reading_c !== null ? html`<bdi>${deg(s.reading_c)}</bdi> ` : ""}${badge(pick(L, w[0], w[1]), s.in_range === false ? "danger" : w[2])}</td>`; })}</tr>`)}</tbody></table></div>`, { translated: true });
}

async function record(c: Ctx) {
  const L = c.lang;
  const src = await hubId(c);
  const zone = (c.form.zone ?? "chilled").trim();
  const raw = (c.form.reading_c ?? "").trim().replace(",", ".");
  const reading = Number(raw);
  if (raw === "" || !Number.isFinite(reading)) throw new UserError(pick(L, "Type the number the thermometer shows.", "اكتب الرقم الذي يظهره ميزان الحرارة."));
  const note = text(c, "note", 200) || null;
  if (!c.files.photo) throw new UserError(pick(L, "Take the photo of the thermometer first.", "التقط صورة ميزان الحرارة أولاً."));
  const r = await attempt(c, "temperature_reading", { zone, reading, note }, async () => {
    try {
      const photo = await upload(c, "photo", `temperature/${src}`);
      const x = await c.deps.db.rpc<{ duplicate: boolean; in_range: boolean; min_c: number; max_c: number }>("record_temperature", {
        p_source: src, p_zone: zone, p_reading_c: reading, p_photo: photo, p_by: c.staff.partyId, p_note: note, p_key: formKey(c) });
      if (x.duplicate) return pick(L, "That reading was already saved.", "حُفظت هذه القراءة بالفعل.");
      const rg = { min_c: x.min_c, max_c: x.max_c };
      return x.in_range ? pick(L, `Saved: ${deg(reading)}, in range.`, `حُفظت: ${deg(reading)}، ضمن المدى.`)
        : pick(L, `Saved: ${deg(reading)}, OUT OF RANGE (${range(rg)}). The staff alert was raised: move the chilled goods to a working fridge, or hold them.`,
               `حُفظت: ${deg(reading)}، خارج المدى (${rangeAr(rg)}). أُطلق تنبيه الفريق: انقل المبرّدات إلى برّاد يعمل، أو أوقف بيعها.`);
    } catch (e) { throw plain(L, e); }
  });
  return flashRedirect(c.deps, "/temperature", r.logged ? r.msg : { err: pick(L, "Not done: the action log could not be written. Try again in a minute.", "لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة.") });
}

export const temperatureSection: Section = {
  nav: { href: "/temperature", label: "Temperature log", roles: ALL },
  routes: [
    { method: "GET", path: "/temperature", roles: ALL, handler: page },
    { method: "POST", path: "/temperature", roles: ALL, handler: record },
  ],
};
