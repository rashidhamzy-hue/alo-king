// Outside WhatsApp's 24-hour window (DECISIONS §3, §39.8): the template that carries an outbox message, filled from the
// outbox row the same way the free-form message is. The database decides whether a template may be used
// (whatsapp_template_for: approved on the sending number's account, or a dry run for a simulator number); this file only
// fills it. Every quick-reply payload is one our handlers already read, so a tap lands where a tap on the free-form card
// would, and it reopens the window.

import {
  templateByName,
  templateLang,
  templateMessage,
  type TemplateLang,
} from "../_shared/whatsapp-templates.ts";
import { lbp, usd } from "../_shared/customer-cards.ts";

export type TemplateChoice = { name: string; lang: string; dry_run?: boolean };
type Row = {
  order_id: string | null;
  target: string | null;
  purpose: string;
  payload: Record<string, any>;
  card: Record<string, any> | null;
};

const MIN: Record<TemplateLang, string> = { ar: "د", en: "min", fr: "min" };
const SOMEONE: Record<TemplateLang, string> = {
  ar: "شخص من عيلتك",
  en: "Someone",
  fr: "Quelqu'un",
};

/** "$12.50 / 1,118,750 LBP": both currencies at the rate locked on the order (§13). */
// Both amounts or nothing: a blank total refuses the template rather than showing "$0.00".
const total = (u: unknown, l: unknown) =>
  u === undefined || u === null || l === undefined || l === null ? "" : `${usd(u)} / ${lbp(l)} LBP`;
const eta = (e: any, lang: TemplateLang) =>
  e?.min ? `${e.max && e.max !== e.min ? `${e.min}-${e.max}` : e.min} ${MIN[lang]}` : ""; // no ETA computed: the template is not filled (never a made-up time)
const items = (card: Record<string, any> | null) =>
  (Array.isArray(card?.items) ? card!.items : [])
    .slice(0, 8)
    .map((i: any) => `${Number(i.quantity ?? 1)} × ${String(i.name ?? i.name_en ?? "")}`)
    .join(", ");
const UUID = /^[0-9a-f-]{36}$/;
const ROLE: Record<string, Record<TemplateLang, string>> = {
  manager: { ar: "مدير", en: "manager", fr: "gérant" },
  cashier: { ar: "كاشير", en: "cashier", fr: "caissier" },
  kitchen: { ar: "مطبخ", en: "kitchen", fr: "cuisine" },
  driver: { ar: "سائق", en: "driver", fr: "livreur" },
};

/**
 * Template values and quick-reply payloads for one outbox row, or null when the row is not one the template covers. A
 * value the row lacks stays blank, and templateMessage refuses a blank variable: nothing is sent rather than a template
 * with a hole or an invented fact (an ETA the server never computed, a "-" for a name).
 */
export function templateFill(
  key: string,
  row: Row,
  lang: TemplateLang,
): { values: Record<string, unknown>; payloads: string[] } | null {
  const p = row.payload ?? {};
  const c = row.card ?? {};
  const oid = String(row.order_id ?? c.order_id ?? "");
  switch (key) {
    case "accepted":
      return c.code
        ? {
            values: {
              code: c.code,
              vendor: c.vendor_name ?? "",
              eta: eta(p.eta, lang),
              total: total(c.total_usd, c.total_lbp),
            },
            payloads: ["c:track"],
          }
        : null;
    case "on_the_way":
      return c.code
        ? { values: { code: c.code, eta: eta(p.eta, lang) }, payloads: ["c:track"] }
        : null;
    case "delivered":
      return c.code && UUID.test(oid)
        ? {
            values: { code: c.code, vendor: c.vendor_name ?? "" },
            payloads: [`rate:${oid}:f5`, `rate:${oid}:f3`, `rcv:${oid}:no`],
          }
        : null;
    case "gift_request":
      return UUID.test(String(p.gift_id ?? ""))
        ? {
            values: {
              sender: String(p.sender ?? "").trim() || SOMEONE[lang],
              vendor: (lang !== "ar" && p.vendor_en) || p.vendor || "",
              total: total(p.total_usd, p.total_lbp),
            },
            payloads: [`gft:${p.gift_id}:y`, `gft:${p.gift_id}:n`],
          }
        : null;
    case "gift_accepted":
      return p.code || c.code
        ? {
            values: {
              recipient: String(p.recipient_name ?? "").trim(),
              vendor: c.vendor_name ?? "",
              code: p.code ?? c.code,
              total: total(c.total_usd, c.total_lbp),
            },
            payloads: ["c:track"],
          }
        : null;
    case "support_reply":
      // The reply itself is held and shown when they tap "Read the reply" (support_pending).
      return { values: { name: String(p.name ?? "").trim() }, payloads: ["c:support"] };
    case "new_order":
      return c.code && UUID.test(oid)
        ? {
            values: { code: c.code, items: items(c), total: usd(c.total_usd) },
            payloads: [`acc:${oid}:15`, `acc:${oid}:30`, `rej:${oid}`],
          }
        : null;
    case "proposal":
      return UUID.test(String(p.proposal_id ?? "")) && p.summary
        ? {
            values: { shop: p.vendor_name ?? "Alo King", suggestion: p.summary },
            payloads: [`pyes:${p.proposal_id}`, `pno:${p.proposal_id}`],
          }
        : null;
    case "merchant_weekly":
      return p.kind === "merchant_weekly"
        ? {
            values: {
              shop: p.shop ?? "",
              orders: p.orders ?? "",
              delivered: p.delivered ?? "",
              sales: p.sales ?? "",
              rating: p.rating ?? "",
            },
            payloads: ["mcmd:week"],
          }
        : null;
    case "staff_welcome":
      return p.kind === "staff_welcome" && p.shop && ROLE[String(p.role)]
        ? { values: { shop: p.shop, role: ROLE[String(p.role)][lang] }, payloads: ["mcmd:help"] }
        : null;
    case "kitchen_full":
      return p.kind === "kitchen_full"
        ? {
            values: { shop: p.shop ?? "", queue: p.queue ?? "", max: p.max ?? "" },
            payloads: ["mcmd:open"],
          }
        : null;
    default:
      return null;
  }
}

/** The template key an outbox row would use outside the window (customer kind, or the merchant purpose). */
export function templateKey(row: Row): string | null {
  if (row.purpose === "customer_message") return String(row.payload?.kind ?? "") || null;
  if (row.purpose === "new_order" || row.purpose === "proposal") return row.purpose;
  if (
    row.purpose === "reply" &&
    ["merchant_weekly", "staff_welcome", "kitchen_full"].includes(row.payload?.kind)
  )
    return row.payload.kind;
  return null;
}

/** The send payload for a chosen template, or null when the registry or the row cannot fill it. */
export function templatePayload(
  choice: TemplateChoice,
  key: string,
  row: Row,
): Record<string, unknown> | null {
  const def = templateByName(choice.name);
  if (!def || !row.target) return null;
  const lang = templateLang(choice.lang);
  const fill = templateFill(key, row, lang);
  if (!fill) return null;
  try {
    return templateMessage(row.target, def, lang, fill.values, fill.payloads);
  } catch {
    return null;
  }
}
