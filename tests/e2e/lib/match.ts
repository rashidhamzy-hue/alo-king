// Pure matching: sim_outbox rows -> Out, expectations -> failures, DB values -> expectations. Unit-tested.
import type { Expect, Out } from "./types";

type Row = {
  id: number | string;
  to_phone: string;
  kind: string;
  body: string | null;
  payload: any;
};

export function toOut(r: Row): Out {
  const p = r.payload ?? {};
  const i = p.interactive ?? {};
  const options: { id: string; title: string }[] = [];
  for (const b of i.action?.buttons ?? [])
    if (b?.reply?.id) options.push({ id: String(b.reply.id), title: String(b.reply.title ?? "") });
  for (const s of i.action?.sections ?? [])
    for (const row of s?.rows ?? [])
      if (row?.id) options.push({ id: String(row.id), title: String(row.title ?? "") });
  if (i.action?.parameters?.display_text)
    options.push({ id: "url", title: String(i.action.parameters.display_text) });
  return {
    id: Number(r.id),
    to: r.to_phone,
    kind: r.kind,
    text: r.body ?? "",
    header: String(i.header?.text ?? ""),
    options,
    raw: p,
  };
}

const lower = (s: string) => s.toLowerCase();
const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : [v].flat());
const ARABIC = /[؀-ۿ]/;
const FRENCH_MARK =
  /[àâçéèêëîïôûùüœ]|\b(le|la|les|un|une|des|vous|votre|pour|avec|commande|commander|choisir|choisissez|panier|livraison|merci)\b/i;

export function kindMatches(want: string | undefined, got: string): boolean {
  if (!want || want === "any") return true;
  if (want === "button") return got === "interactive:button";
  if (want === "list") return got === "interactive:list";
  return got === want;
}

export function langOf(text: string): "ar" | "fr" | "en" {
  if (ARABIC.test(text)) return "ar";
  return FRENCH_MARK.test(text) ? "fr" : "en";
}

export function optionMatches(o: { id: string; title: string }, want: string): boolean {
  return o.id === want || o.id.startsWith(want) || lower(o.title).includes(lower(want));
}

/** Why `m` does not satisfy `e` ("" when it does). `to` is checked by the caller, which knows the persona phones. */
export function mismatch(e: Expect, m: Out): string {
  if (!kindMatches(e.kind, m.kind)) return `kind ${m.kind}, wanted ${e.kind}`;
  const hay = lower(`${m.header}\n${m.text}`);
  for (const t of list(e.text)) if (!hay.includes(lower(t))) return `text lacks "${t}"`;
  if (e.text_any && !e.text_any.some((t) => hay.includes(lower(t))))
    return `text has none of ${JSON.stringify(e.text_any)}`;
  if (e.text_re && !new RegExp(e.text_re, "iu").test(`${m.header}\n${m.text}`))
    return `text does not match /${e.text_re}/`;
  for (const t of list(e.not_text)) if (hay.includes(lower(t))) return `text has "${t}"`;
  if (e.lang && langOf(`${m.header}\n${m.text}`) !== e.lang)
    return `language ${langOf(`${m.header}\n${m.text}`)}, wanted ${e.lang}`;
  for (const b of e.buttons ?? [])
    if (!m.options.some((o) => optionMatches(o, b))) return `no option "${b}"`;
  return "";
}

/** Compares one database value with an expectation: null, number, boolean, text, ~regex, >=, >, <=, <. */
export function valueMatches(actual: unknown, want: unknown): boolean {
  if (want === null) return actual === null || actual === undefined;
  if (typeof want === "string") {
    const cmp = /^(>=|<=|>|<)\s*(-?[\d.]+)$/.exec(want);
    if (cmp) {
      const a = Number(actual);
      const n = Number(cmp[2]);
      return cmp[1] === ">=" ? a >= n : cmp[1] === "<=" ? a <= n : cmp[1] === ">" ? a > n : a < n;
    }
    if (want.startsWith("~")) return new RegExp(want.slice(1), "u").test(String(actual ?? ""));
  }
  if (typeof want === "number") return Number(actual) === want;
  if (typeof want === "boolean") return actual === want;
  return String(actual) === String(want);
}

export function render(template: string, scope: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    let v: any = scope;
    for (const k of path.split(".")) v = v?.[k];
    if (v === undefined || v === null) throw new Error(`template {{${path}}} has no value`);
    return String(v);
  });
}
