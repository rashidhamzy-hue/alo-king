// SIM1: the checks code runs on every turn (hard failures), as pure functions over what the customer received.
// The message rules are the nine rules of packages/agents/test/messages.rules.test.ts (M1), restated here because that file is a
// test and cannot be imported; a difference between the two is a bug in this file.
import type { Lang } from "./scenarios";

export interface Option { id: string; title: string; description?: string; /** The reference the simulated customer taps it by (b1, b2, ...). */ key?: string }
export interface BotMsg {
  kind: "text" | "buttons" | "list" | "location_request" | "template" | "catalog" | "location" | "other";
  text: string; options: Option[]; button?: string;
}

/** What the customer's phone shows for one recorded Kapso send. */
export function renderKapso(body: any): BotMsg {
  const t = body?.type;
  if (t === "text") return { kind: "text", text: String(body.text?.body ?? ""), options: [] };
  if (t === "interactive") {
    const i = body.interactive ?? {};
    const text = String(i.body?.text ?? "");
    if (i.type === "button") return { kind: "buttons", text, options: (i.action?.buttons ?? []).map((b: any) => ({ id: String(b.reply?.id), title: String(b.reply?.title) })) };
    if (i.type === "list") return { kind: "list", text, button: i.action?.button, options: (i.action?.sections ?? []).flatMap((s: any) => (s.rows ?? []).map((r: any) => ({ id: String(r.id), title: String(r.title), ...(r.description ? { description: String(r.description) } : {}) }))) };
    if (i.type === "location_request_message") return { kind: "location_request", text, options: [] };
    if (i.type === "product_list" || i.type === "product" || i.type === "catalog_message") {
      const items = (i.action?.sections ?? []).flatMap((s: any) => (s.product_items ?? []).map((p: any) => String(p.product_retailer_id)));
      return { kind: "catalog", text: `${text}${items.length ? ` [catalogue items: ${items.slice(0, 12).join(", ")}]` : " [a catalogue]"}`, options: [] };
    }
    return { kind: "other", text: `${text} [${i.type}]`, options: [] };
  }
  if (t === "template") {
    const params = (body.template?.components ?? []).flatMap((c: any) => (c.parameters ?? []).map((p: any) => p.text ?? "")).filter(Boolean);
    return { kind: "template", text: `[template ${body.template?.name}] ${params.join(" | ")}`, options: [] };
  }
  if (t === "location") return { kind: "location", text: `[a location: ${body.location?.name ?? ""}]`, options: [] };
  return { kind: "other", text: `[${t}]`, options: [] };
}

// ---------- language ----------
const FR = /\b(je|vous|votre|nous|est|pas|merci|bonjour|commande|livraison|avec|pour|les|des|une|svp|oui|non|désolé|c'est|ça|il|elle|sont|quel|quelle)\b/giu;
const EN = /\b(the|you|your|is|are|order|delivery|please|thanks|with|for|and|what|which|we|it|can|sorry|yes|no|would|like|have)\b/giu;
export type Seen = "ar" | "arabizi" | "en" | "fr" | "unknown";
/** The language a message is written in, from its letters and its small words. Unknown when there is too little to tell. */
export function langOf(text: string): Seen {
  // B1b: only whole numbers are dropped. Dropping every digit cut Arabizi words in two («l2it» became "l it", read as English "it").
  const clean = text.replace(/\$\d+(\.\d+)?|(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])|https?:\S+|[*_~]/gu, " ");
  const arabic = (clean.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (clean.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (arabic + latin < 6) return "unknown";
  if (arabic >= latin) return "ar";
  const fr = (clean.match(FR) ?? []).length, en = (clean.match(EN) ?? []).length;
  if (fr === 0 && en === 0) return "arabizi";
  // Words written with the Arabizi digits (3, 7, 2, 5...) are Arabizi: more of them than English or French words decides it.
  const az = (clean.match(/(?<![\p{L}\d])(?:[a-z]*[235789][a-z]+|[a-z]+[235789][a-z]*|shu|sho|baddak|baddik|baddi|badde|ahlan|ahla|marhaba|tamam|yalla|halla2|hala2|kifak|kifik|ya3ni|hek|hayda|bas|kamen|kaman|ma3|w|el|fi|mesh|mish)(?![\p{L}\d])/giu) ?? []).length;
  if (az >= Math.max(fr, en)) return "arabizi";
  if (fr > en) return "fr";
  if (en > fr) return "en";
  return "unknown";
}
/** A reply in another language than the customer's: Arabic-script or Arabizi for ar/arabizi, English for en, French for fr. */
export function wrongLanguage(expected: Lang, text: string): Seen | null {
  if (expected === "mixed") return null;
  // A card or a list carries product names in their own language: judge the lines without an amount and without a product name.
  // B1b: a card's item lines («3 × Dolsi Vegas ...», «+ 1 × ...», «X: 3 → 2») are product names too, and so is a run of two or more
  // capitalised Latin words in a sentence ("Mentos Incredible Chew Strawberry"); an Arabic card was read as English for its names.
  const all = text.split("\n");
  // A price list's product line is followed by its amount line («Dolsi Vegas ...» then «$0.75»).
  const words = all.filter((l, i) => !/\$\d/.test(l) && !/^\s*\$\d/.test(all[i + 1] ?? "") && !/^\s*[+−-]?\s*\d+(?:\.\d+)?\s*[×x]\s/u.test(l) && !/→/u.test(l))
    .join("\n").replace(/(?:[A-Z][\p{L}\d'.&-]*\s+){1,}[A-Z\d][\p{L}\d'.&-]*/gu, (run) => (new RegExp(FR.source, "iu").test(run) || new RegExp(EN.source, "iu").test(run) ? run : " "));
  const seen = langOf(words);
  if (seen === "unknown") return null;
  if (expected === "ar" || expected === "arabizi") return seen === "ar" || seen === "arabizi" ? null : seen;
  if (expected === "en") return seen === "en" ? null : seen;
  return seen === "fr" ? null : seen;
}

// ---------- the message rules (M1) ----------
const ALLOWED = new Set(["📍", "🛒", "🛵", "✅", "💵", "🌙", "⚠️", "📦", "🏠", "🔢", "👑"]);
const MAX_LINE = 120, MAX_EMOJI = 3;
const AMOUNT = /-?\$\d+(?:\.\d{2})?|\d{1,3}(?:,\d{3})+ (?:ل\.ل|LBP)|\b\d+ (?:ل\.ل|LBP)/gu;
const EMOJI = /\p{Extended_Pictographic}️?/gu;
/** The rules test's problems() for one message (the greeting crown is allowed anywhere here: the run cannot tell a greeting). */
export function ruleProblems(m: BotMsg): string[] {
  if (m.kind === "template" || m.kind === "location") return [];
  const out: string[] = [];
  const lines = m.text.split("\n");
  lines.forEach((l, i) => { if (l.length > MAX_LINE) out.push(`rule 1: line ${i + 1} has ${l.length} characters`); });
  const emojis = (m.text.match(EMOJI) ?? []).map((e) => (e.replace("️", "") === "⚠" ? "⚠️" : e));
  for (const e of emojis) if (!ALLOWED.has(e)) out.push(`rule 4: emoji ${e} not allowed`);
  if (emojis.length > MAX_EMOJI) out.push(`rule 4: ${emojis.length} emojis`);
  if ((m.text.match(/\*/g) ?? []).length % 2) out.push("rule 5: an unmatched *");
  lines.forEach((l, i) => {
    for (const b of l.match(/\*[^*]+\*/g) ?? []) {
      const whole = l.trim() === b || (l.trim().endsWith(b) && l.trim().startsWith("🛒"));
      const total = /المجموع|Total|total/u.test(b);
      const heading = i === 0 || l.startsWith("🛒 ");
      if (!whole || (!heading && !total)) out.push(`rule 5: bold "${b}" is neither a heading nor the total`);
    }
  });
  if (/[٠-٩۰-۹]/u.test(m.text)) out.push("rule 7: Arabic-Indic digits");
  lines.forEach((l, i) => {
    const found = l.match(AMOUNT) ?? [];
    if (found.length > 1) out.push(`rule 7: line ${i + 1} has ${found.length} amounts`);
    if (found.length === 1 && !l.replace(/[*.]+$/u, "").trimEnd().endsWith(found[0]!)) out.push(`rule 7: the amount is not at the end of line ${i + 1}`);
  });
  for (const o of m.options) if (o.title.length > (m.kind === "list" ? 24 : 20)) out.push(`option title over the limit: ${o.title}`);
  return out;
}

// ---------- the order card ----------
/** The order a card is for and the total it shows (the bold total line), or null when the message is not a card. */
export function cardOf(m: BotMsg): { orderId: string; total: number | null; credit: number } | null {
  const confirm = m.options.find((o) => /^order:confirm:[0-9a-f-]{36}$/.test(o.id));
  if (!confirm) return null;
  const orderId = confirm.id.split(":")[2]!;
  const totalLine = m.text.split("\n").find((l) => /^\*.*\$\d/.test(l.trim()) && /المجموع|Total|total/u.test(l));
  const amt = totalLine?.match(/-?\$(\d+(?:\.\d+)?)/g)?.pop();
  const credit = m.text.split("\n").map((l) => l.match(/-\$(\d+(?:\.\d+)?)/)).filter(Boolean).reduce((s, x) => s + Number(x![1]), 0);
  return { orderId, total: amt ? Number(amt.replace(/[^\d.]/g, "")) : null, credit };
}

/** A card total that differs from the database (a credit line on the card may be counted either way). */
export function totalMismatch(card: { total: number | null; credit: number }, dbTotal: number): string | null {
  if (card.total === null) return "no total line on the card";
  const ok = [dbTotal, dbTotal - card.credit].some((t) => Math.abs(t - card.total!) < 0.005);
  return ok ? null : `card ${card.total.toFixed(2)} vs database ${dbTotal.toFixed(2)}`;
}

/** Severity of each hard failure (3: the customer is harmed, stranded, or gets a wrong product or amount). */
export const HARD_SEVERITY: Record<string, 1 | 2 | 3> = {
  no_reply: 3, silence_after_handoff: 3, confirmed_without_tap: 3, card_total_mismatch: 3, invented_price: 3, turn_error: 3,
  sent_after_opt_out: 3, wrong_language: 2, message_rules: 1, harness_note: 1,
};
/** Recorded beside the failures but never a failure: something the harness could not do. */
export const NOTE_CODES = new Set(["harness_note"]);
