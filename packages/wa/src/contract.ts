// CAT2: the shapes Kapso's Meta proxy accepts, for every interactive type we send. Source: Kapso's OpenAPI
// (api/meta/whatsapp/openapi-whatsapp.yaml, InteractiveMessage and its examples), read 24 November 2026.
// Kapso validates the payload before Meta sees it and answers 422 {"error":"Invalid message payload"} to a shape it does not know.
// On 23 and 24 November every catalog_message we sent was refused that way: Kapso wants action.parameters.thumbnail_product_retailer_id
// (Meta calls it optional). The gateway checks every interactive message against these shapes before it is sent (preflight), and the
// contract tests (packages/wa/test/contract.test.ts) check every builder against them, so a shape Kapso refuses fails CI first.
import type { Outbound } from "./kapso";

/** The interactive types the gateway lets out. Anything else is refused before Kapso (invariant 2 keeps the outer types). */
export const INTERACTIVE_TYPES = ["button", "list", "cta_url", "catalog_message", "product", "product_list", "location_request_message"] as const;
export type InteractiveType = (typeof INTERACTIVE_TYPES)[number];

/** Meta's limits, counted in characters (code points), as Kapso's schema states them. */
export const LIMITS = { body: 1024, header: 60, footer: 60, buttonTitle: 20, buttonId: 256, buttons: 3, listButton: 20, listRows: 10,
  listSections: 10, sectionTitle: 24, rowTitle: 24, rowId: 200, rowDescription: 72, ctaText: 20, products: 30 } as const;

/** Cut to at most n characters without splitting an emoji (a UTF-16 slice can leave half a surrogate pair, which Meta refuses). */
export const cutChars = (s: string, n: number): string => { const a = Array.from(s); return a.length > n ? a.slice(0, n).join("") : s; };
const len = (s: unknown) => (typeof s === "string" ? Array.from(s).length : -1);
const text = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && len(s) <= max;
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** Null when Kapso accepts the interactive message's shape; otherwise why not (a short code). Non-interactive messages pass. */
export function checkInteractive(msg: Outbound): string | null {
  if (msg.type !== "interactive") return null;
  const i = obj(msg.interactive);
  if (!i) return "no_interactive";
  const type = i.type as string;
  if (!(INTERACTIVE_TYPES as readonly string[]).includes(type)) return `type_${String(type)}`;
  const a = obj(i.action);
  if (!a) return "no_action";
  const body = obj(i.body);
  if (type !== "location_request_message" && type !== "product" && !body) return "no_body";
  if (body && !text(body.text, LIMITS.body)) return "body_text";
  if (i.header !== undefined) {
    const h = obj(i.header);
    if (!h || h.type !== "text" || !text(h.text, LIMITS.header)) return "header";
  }
  if (i.footer !== undefined && !text(obj(i.footer)?.text, LIMITS.footer)) return "footer";
  switch (type) {
    case "button": {
      const b = a.buttons;
      if (!Array.isArray(b) || b.length < 1 || b.length > LIMITS.buttons) return "buttons_count";
      const ids = new Set<string>();
      for (const x of b) {
        const r = obj(obj(x)?.reply);
        if (obj(x)?.type !== "reply" || !r || !text(r.id, LIMITS.buttonId) || !text(r.title, LIMITS.buttonTitle)) return "button_shape";
        if (ids.has(r.id as string)) return "button_id_twice";
        ids.add(r.id as string);
      }
      return null;
    }
    case "list": {
      if (!text(a.button, LIMITS.listButton)) return "list_button";
      const s = a.sections;
      if (!Array.isArray(s) || s.length < 1 || s.length > LIMITS.listSections) return "list_sections";
      let rows = 0;
      const ids = new Set<string>();
      for (const sec of s) {
        const o = obj(sec);
        if (!o || !Array.isArray(o.rows) || o.rows.length < 1) return "list_rows";
        if (o.title !== undefined && !text(o.title, LIMITS.sectionTitle)) return "list_section_title";
        if (s.length > 1 && o.title === undefined) return "list_section_title";
        for (const r of o.rows) {
          const x = obj(r);
          if (!x || !text(x.id, LIMITS.rowId) || !text(x.title, LIMITS.rowTitle)) return "list_row";
          if (x.description !== undefined && !text(x.description, LIMITS.rowDescription)) return "list_row_description";
          if (ids.has(x.id as string)) return "list_row_id_twice";
          ids.add(x.id as string);
          rows++;
        }
      }
      return rows > LIMITS.listRows ? "list_rows_count" : null;
    }
    case "cta_url": {
      const p = obj(a.parameters);
      if (a.name !== "cta_url" || !p || !text(p.display_text, LIMITS.ctaText)) return "cta_shape";
      return typeof p.url === "string" && /^https:\/\/\S+$/.test(p.url) ? null : "cta_url";
    }
    case "catalog_message": {
      const p = obj(a.parameters);
      if (a.name !== "catalog_message") return "catalog_name";
      return p && text(p.thumbnail_product_retailer_id, 100) ? null : "catalog_thumbnail";
    }
    case "product":
      return text(a.catalog_id, 100) && text(a.product_retailer_id, 100) ? null : "product_shape";
    case "product_list": {
      if (!text(a.catalog_id, 100)) return "product_list_catalog";
      if (!i.header) return "product_list_header";
      const s = a.sections;
      if (!Array.isArray(s) || s.length < 1 || s.length > LIMITS.listSections) return "product_list_sections";
      let n = 0;
      for (const sec of s) {
        const o = obj(sec);
        if (!o || !text(o.title, LIMITS.sectionTitle) || !Array.isArray(o.product_items) || o.product_items.length < 1) return "product_list_section";
        for (const p of o.product_items) { if (!text(obj(p)?.product_retailer_id, 100)) return "product_list_item"; n++; }
      }
      return n > LIMITS.products ? "product_list_count" : null;
    }
    case "location_request_message":
      return a.name === "send_location" ? null : "location_request_name";
  }
  return null;
}

/**
 * The same words as plain text, for when an interactive message is refused (CAT2: never silent). The caller's own words win (they are
 * in the customer's language); otherwise the body, the header, then each choice on its own line (a customer can type it back), and the
 * link of a cta_url. A catalogue message without the caller's words keeps its body only: the link comes from the caller.
 */
export function plainOf(msg: Outbound): string | null {
  if (msg.type !== "interactive") return null;
  const i = obj(msg.interactive) ?? {};
  const a = obj(i.action) ?? {};
  const parts: string[] = [];
  const h = obj(i.header)?.text, b = obj(i.body)?.text;
  if (typeof h === "string" && h.trim()) parts.push(`*${h.trim()}*`);
  if (typeof b === "string" && b.trim()) parts.push(b.trim());
  const choices: string[] = [];
  if (Array.isArray(a.buttons)) for (const x of a.buttons) { const t = obj(obj(x)?.reply)?.title; if (typeof t === "string") choices.push(t); }
  if (Array.isArray(a.sections)) for (const s of a.sections) for (const r of (obj(s)?.rows as unknown[] | undefined) ?? []) {
    const x = obj(r); if (typeof x?.title === "string") choices.push(typeof x.description === "string" && x.description ? `${x.title} · ${x.description}` : x.title);
  }
  if (choices.length) parts.push(choices.map((c) => `▫️ ${c}`).join("\n"));
  const p = obj(a.parameters);
  if (i.type === "cta_url" && typeof p?.url === "string") parts.push(typeof p.display_text === "string" ? `${p.display_text}: ${p.url}` : p.url);
  const out = parts.join("\n\n").trim();
  return out ? cutChars(out, 4096) : null;
}
