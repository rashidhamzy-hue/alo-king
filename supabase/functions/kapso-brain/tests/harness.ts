// Persona test harness for kapso-brain. Runs against the staging copy (kapso-brain-test) in dry-run mode:
// replies come back as payloads instead of being sent, DB writes are real (test phones only: 961700000…).
// Needs: SELFTEST_TOKEN (live row of selftest_tokens). Never put real secrets in this folder.

export const FN = process.env.FN ?? "kapso-brain-test";
export const BASE = process.env.SUPABASE_URL ?? "https://hnjkietmwvkgbyrcnweq.supabase.co";
const URL_FN = `${BASE}/functions/v1/${FN}`;
export const LBP_RATE = 89_500;
export const DELIVERY_FEE = 2;

export type Btn = { id: string; title: string };
export type Turn = { input: string; msgs: any[] };
export type Status = "pass" | "fail" | "pending";
export type Result = { persona: string; name: string; status: Status; phase: number; detail?: string };

// Public anon read access to menu data (RLS allows it); used to recompute prices independently of the bot.
// The publishable key is public by design (shipped to browsers); read it from the frontend config.
import { readFileSync } from "node:fs";
const ANON = process.env.SUPABASE_ANON_KEY ?? (() => {
  try { return readFileSync(new URL("../../../../src/lib/config.ts", import.meta.url), "utf8").match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? ""; } catch { return ""; }
})();
export async function rest(path: string): Promise<any[]> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`);
  return res.json();
}

const token = () => { const t = process.env.SELFTEST_TOKEN; if (!t) throw new Error("set SELFTEST_TOKEN"); return t; };
let seq = 0;
const wamid = () => `wamid.persona.${Date.now()}.${seq++}.${Math.random().toString(36).slice(2, 8)}`;

export async function post(body: unknown, qs = ""): Promise<any> {
  const res = await fetch(`${URL_FN}${qs}`, { method: "POST", headers: { "x-selftest": token(), "content-type": "application/json" }, body: JSON.stringify(body) });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { throw new Error(`${FN} said ${res.status}: ${txt.slice(0, 200)}`); }
}

export const textOf = (m: any): string =>
  m.text?.body ?? m.interactive?.body?.text ?? (m.type === "template" ? `[template ${m.template?.name}]` : "");
export const buttonsOf = (m: any): Btn[] => {
  const i = m.interactive;
  if (!i) return [];
  if (i.type === "button") return (i.action?.buttons ?? []).map((b: any) => ({ id: b.reply.id, title: b.reply.title }));
  if (i.type === "list") return (i.action?.sections ?? []).flatMap((s: any) => s.rows.map((r: any) => ({ id: r.id, title: r.title })));
  return [];
};

export class Customer {
  turns: Turn[] = [];
  confirmations = 0; // CONFIRM taps + explicit "yes" turns the persona declared; orders may never exceed this
  constructor(public phone: string, public name: string) {}

  private async event(msg: any, label: string): Promise<any[]> {
    const r = await post({ message: { id: wamid(), from: this.phone, ...msg } });
    const msgs = (r.out ?? []).filter((o: any) => o.to === undefined || o.to === this.phone);
    this.turns.push({ input: label, msgs });
    return msgs;
  }
  say(text: string) { return this.event({ type: "text", text: { body: text } }, text); }
  yes(text = "yes") { this.confirmations++; return this.say(text); }
  tap(id: string, title = "") {
    if (id.startsWith("CONFIRM|")) this.confirmations++;
    return this.event({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }, `[tap ${id}]`);
  }
  tapList(id: string, title = "") { return this.event({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } }, `[list ${id}]`); }
  voice(transcript: string) { return this.event({ type: "audio", audio: { id: "fixture" }, kapso: { transcript_fixture: transcript } }, `[voice] ${transcript}`); }
  location(latitude: number, longitude: number, address?: string) { return this.event({ type: "location", location: { latitude, longitude, address } }, "[location pin]"); }

  get last(): any[] { return this.turns.at(-1)?.msgs ?? []; }
  lastText(): string { return this.last.map(textOf).join("\n"); }
  allText(): string { return this.turns.flatMap((t) => t.msgs.map(textOf)).join("\n"); }
  buttons(): Btn[] { return this.last.flatMap(buttonsOf); }
  /** Find a button/row in the last turn whose id or title matches. */
  find(re: RegExp): Btn | undefined { return this.buttons().find((b) => re.test(b.id) || re.test(b.title)); }
  /** Say `text` (retrying with `nudges`) until a button matching `re` shows up. */
  async until(re: RegExp, text: string, nudges: string[] = []): Promise<Btn | undefined> {
    await this.say(text);
    for (const n of nudges) { if (this.find(re)) break; await this.say(n); }
    return this.find(re);
  }
  async inspect(): Promise<{ customer: any; orders: any[]; carts: any[] }> {
    return post({}, `?job=inspect&phone=${this.phone}`).catch(() => ({ customer: null, orders: [], carts: [] }));
  }
}

// ---- universal per-persona checks (run on every persona) ----
const LEAK = /sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.|service_role|ANTHROPIC_API|KAPSO_API|SUPABASE_SERVICE|ADMIN_WHATSAPP|WATCHDOG_SECRET|selftest|you are alo king|CSYSTEM/i;
export const MSGS_PER_TURN_CAP = 3;
export const MSGS_PER_PERSONA_CAP = 25;

export function universal(c: Customer, maxOrders = c.confirmations): { name: string; ok: boolean; detail?: string }[] {
  const out: { name: string; ok: boolean; detail?: string }[] = [];
  const bad: string[] = [];
  for (const t of c.turns) for (const m of t.msgs) {
    const i = m.interactive; if (!i) continue;
    if (i.type === "button") {
      const bs = i.action?.buttons ?? [];
      if (bs.length > 3) bad.push(`>3 buttons (${bs.length})`);
      for (const b of bs) if (b.reply.title.length > 20) bad.push(`button title >20: "${b.reply.title}"`);
    }
    if (i.type === "list") {
      const rows = (i.action?.sections ?? []).flatMap((s: any) => s.rows);
      if (rows.length > 10) bad.push(`list >10 rows (${rows.length})`);
      for (const r of rows) { if (r.title.length > 24) bad.push(`row title >24: "${r.title}"`); if ((r.description ?? "").length > 72) bad.push(`row desc >72`); }
      if ((i.action?.button ?? "").length > 20) bad.push("list button label >20");
      if ((i.header?.text ?? "").length > 60) bad.push("list header >60");
    }
    if ((i.body?.text ?? "").length > 1024) bad.push("interactive body >1024");
  }
  out.push({ name: "button-limits", ok: !bad.length, detail: bad.slice(0, 3).join("; ") });

  const worst = Math.max(0, ...c.turns.map((t) => t.msgs.length));
  const total = c.turns.reduce((n, t) => n + t.msgs.length, 0);
  out.push({ name: `message-cap (≤${MSGS_PER_TURN_CAP}/turn, ≤${MSGS_PER_PERSONA_CAP} total)`, ok: worst <= MSGS_PER_TURN_CAP && total <= MSGS_PER_PERSONA_CAP, detail: `max ${worst}/turn, ${total} total` });

  const leak = c.allText().match(LEAK);
  out.push({ name: "no-secret-or-prompt-leak", ok: !leak, detail: leak?.[0] });

  const mono = c.turns.flatMap((t) => t.msgs.map(textOf)).filter((x) => /\$\s?\d/.test(x) && !/LBP|ل\.ل|ليرة/i.test(x));
  out.push({ name: "dual-currency", ok: !mono.length, detail: mono[0]?.slice(0, 80) });
  return out;
}

export async function orderChecks(c: Customer, maxOrders = c.confirmations): Promise<{ name: string; ok: boolean; detail?: string }[]> {
  const snap = await c.inspect();
  const res: { name: string; ok: boolean; detail?: string }[] = [];
  res.push({ name: "never-unconfirmed-order", ok: snap.orders.length <= maxOrders, detail: `${snap.orders.length} orders vs ${maxOrders} confirmations` });
  const prob: string[] = [];
  for (const o of snap.orders) {
    const items: any[] = Array.isArray(o.items) ? o.items : [];
    const ids = [...new Set(items.map((i) => i.item_id))];
    if (!ids.length || !ANON) continue;
    const rows = await rest(`menu_items?select=item_id,price_usd,customizations&vendor_id=eq.${o.vendor_id}&item_id=in.(${ids.map(encodeURIComponent).join(",")})`);
    const base = new Map(rows.map((r) => [r.item_id, Number(r.price_usd)]));
    let sub = 0;
    for (const i of items) { const p = base.get(i.item_id); if (p === undefined) { prob.push(`unknown item ${i.item_id}`); continue; } if (Number(i.unit_price_usd) + 1e-9 < p) prob.push(`${i.item_id} below DB price`); sub += Number(i.unit_price_usd) * Number(i.quantity ?? 1); }
    if (Math.abs(sub - Number(o.subtotal_usd)) > 0.011) prob.push(`subtotal ${o.subtotal_usd} != lines ${sub.toFixed(2)}`);
    if (Math.abs(Number(o.delivery_fee_usd) - DELIVERY_FEE) > 0.001) prob.push(`delivery fee ${o.delivery_fee_usd}`);
    if (Math.abs(Number(o.total_usd) - (Number(o.subtotal_usd) + DELIVERY_FEE)) > 0.011) prob.push("total != subtotal + fee");
  }
  res.push({ name: "price-from-database", ok: !prob.length, detail: prob.slice(0, 2).join("; ") });
  return res;
}

// Arabic detection used by language assertions: share of Arabic letters among letters in the bot's free text.
export function arabicShare(s: string): number {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  return letters.filter((ch) => /[؀-ۿ]/.test(ch)).length / letters.length;
}

export class Report {
  results: Result[] = [];
  constructor(public persona: string, public phase: number) {}
  /** `phase` = the roadmap item that makes this assertion required; before that it is reported as pending instead of fail. */
  check(name: string, ok: boolean, detail?: string, phase = 0) {
    this.results.push({ persona: this.persona, name, phase, status: ok ? "pass" : phase > this.phase ? "pending" : "fail", detail: ok ? undefined : detail });
  }
  addAll(list: { name: string; ok: boolean; detail?: string }[]) { for (const r of list) this.check(r.name, r.ok, r.detail); }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
