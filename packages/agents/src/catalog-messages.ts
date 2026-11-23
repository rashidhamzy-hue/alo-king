// The WhatsApp catalog on the way out (1.21 step 4): the full catalog, one category as product lists, or one product.
// Every message is `interactive` (invariant 2: no new type) and goes through the gateway with the turn's dedupe key.
// Which products exist, their order and their sections come from the database (catalog_list, 0085); Meta's catalog shows the
// pictures, names and prices it read from our feed. Nothing here states a price, and nothing here confirms.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Outbound } from "@ak/wa/kapso";
import { ar, asLang, messages, type Lang } from "./messages";

/** Meta's limits for one product-list message: 30 products in all, 10 sections, 24 characters a section title, 60 the header. */
export const LIST_LIMITS = { products: 30, sections: 10, sectionTitle: 24, header: 60 } as const;
export interface CatalogSection { title: string; skus: string[] }

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * One category as product-list messages, never more than 30 products or 10 sections in one. A section longer than the room
 * left is split into numbered parts ("قهوة وشاي 1", "قهوة وشاي 2"); sections are never reordered.
 */
export function productListMessages(catalogId: string, header: string, body: string, sections: CatalogSection[],
                                    limits: { products: number; sections: number } = LIST_LIMITS): Outbound[] {
  const maxP = Math.min(limits.products, LIST_LIMITS.products), maxS = Math.min(limits.sections, LIST_LIMITS.sections);
  const parts: CatalogSection[] = [];
  for (const s of sections) {
    const skus = [...new Set(s.skus)];
    if (skus.length === 0) continue;
    const n = Math.ceil(skus.length / maxP);
    for (let i = 0; i < n; i++) {
      const suffix = n > 1 ? ` ${i + 1}` : "";
      parts.push({ title: cut(s.title, LIST_LIMITS.sectionTitle - suffix.length) + suffix, skus: skus.slice(i * maxP, (i + 1) * maxP) });
    }
  }
  const messages: CatalogSection[][] = [];
  let cur: CatalogSection[] = [], count = 0;
  for (const p of parts) {
    if (cur.length && (count + p.skus.length > maxP || cur.length >= maxS)) { messages.push(cur); cur = []; count = 0; }
    cur.push(p); count += p.skus.length;
  }
  if (cur.length) messages.push(cur);
  return messages.map((secs, i) => ({
    type: "interactive" as const,
    interactive: {
      type: "product_list",
      header: { type: "text", text: cut(messages.length > 1 ? `${header} (${i + 1}/${messages.length})` : header, LIST_LIMITS.header) },
      body: { text: body },
      action: { catalog_id: catalogId, sections: secs.map((s) => ({ title: s.title, product_items: s.skus.map((sku) => ({ product_retailer_id: sku })) })) },
    },
  }));
}

/** The whole catalog, as WhatsApp's own catalog view. */
export const catalogMessage = (body: string, thumbnailSku?: string | null): Outbound => ({
  type: "interactive",
  interactive: { type: "catalog_message", body: { text: body },
    action: { name: "catalog_message", ...(thumbnailSku ? { parameters: { thumbnail_product_retailer_id: thumbnailSku } } : {}) } },
});

/** One product, as WhatsApp's single-product message. */
export const productMessage = (catalogId: string, sku: string, body?: string): Outbound => ({
  type: "interactive",
  interactive: { type: "product", ...(body ? { body: { text: body } } : {}), action: { catalog_id: catalogId, product_retailer_id: sku } },
});

/** TEST1 (sim-test 45133515061, sim-020: a French customer's "Browse" tap got the Arabic line once the catalogue was connected): the words
 *  are in the customer's language, from the message packs (messages/{ar,en,fr}.ts, `catalog`). CATALOG_TEXT is the Arabic, as before. */
export const CATALOG_TEXT = { all: ar.catalog.all, list: ar.catalog.list, one: ar.catalog.one };

export interface CatalogSettings { catalog_id: string | null; list_max_products?: number; list_max_sections?: number }

/**
 * What to send for "show me the catalog", "what dairy do you have?" or one product. Refuses when the Meta catalog is not set
 * up yet, the category is unknown, or nothing in it has an approved picture (only those are in the catalog, 1.21 step 2).
 * More than two list messages for one category: the full catalog view instead (one turn sends at most two messages).
 */
export async function catalogMessages(db: SupabaseClient, args: { category?: string | null; product_id?: string | null; lang?: Lang | null }):
    Promise<{ ok: true; messages: Outbound[]; summary: string } | { ok: false; error: string; categories?: unknown }> {
  const settings = ((await db.rpc("setting", { p_key: "catalog" })).data ?? {}) as CatalogSettings;
  const catalogId = settings.catalog_id;
  if (!catalogId) return { ok: false, error: "catalog_not_ready" };
  const lang = asLang(args.lang), C = messages(lang).catalog;
  const named = (x: { ar: string; en: string }) => (lang === "ar" ? x.ar : x.en || x.ar);
  if (args.product_id) {
    const feed = ((await db.rpc("catalog_feed")).data ?? []) as { product_id: string; sku: string }[];
    const row = feed.find((r) => r.product_id === args.product_id);
    if (!row) return { ok: false, error: "product_not_in_catalog" };
    return { ok: true, messages: [productMessage(catalogId, row.sku, C.one)], summary: `[catalog product ${row.sku}]` };
  }
  if (!args.category) return { ok: true, messages: [catalogMessage(C.all)], summary: "[catalog]" };
  const list = (await db.rpc("catalog_list", { p_category: args.category })).data as
    { ok: boolean; error?: string; categories?: unknown; category?: { code: string; name_ar: string; name_en: string }; sections?: { title_ar: string; title_en?: string | null; skus: string[] }[] } | null;
  if (!list?.ok || !list.category) return { ok: false, error: list?.error ?? "unknown_category", categories: list?.categories };
  const sections = (list.sections ?? []).map((s) => ({ title: named({ ar: s.title_ar, en: s.title_en ?? "" }), skus: s.skus }));
  if (!sections.some((s) => s.skus.length)) return { ok: false, error: "no_products_with_pictures_in_category" };
  const category = named({ ar: list.category.name_ar, en: list.category.name_en });
  const msgs = productListMessages(catalogId, category, C.list(category), sections,
    { products: settings.list_max_products ?? LIST_LIMITS.products, sections: settings.list_max_sections ?? LIST_LIMITS.sections });
  if (msgs.length > 2) return { ok: true, messages: [catalogMessage(C.all)], summary: `[catalog, for ${list.category.code}]` };
  return { ok: true, messages: msgs, summary: `[catalog list ${list.category.code}]` };
}

// ---------- VOICE1: the catalogue's button, offered and asked for ----------
// Meta shows no cart icon in the chat header for Cloud API numbers, and the shop icon comes late, so the welcome (and, in the friends'
// test, a tester's first reply) carries WhatsApp's own "View catalog" button: the catalog_message. And the words «بدي شوف الكتالوج», "show
// me the catalogue", «le catalogue» send it by code, with no model.

/** True when the catalogue can be shown (settings.catalog.catalog_id is set). */
export async function catalogReady(db: SupabaseClient): Promise<boolean> {
  return !!(((await db.rpc("setting", { p_key: "catalog" })).data ?? {}) as CatalogSettings).catalog_id;
}

/** The catalogue's button with its line, in the customer's language; null when the catalogue is not connected. */
export async function catalogOffer(db: SupabaseClient, lang: Lang | string | null | undefined): Promise<{ msg: Outbound; text: string } | null> {
  if (!(await catalogReady(db).catch(() => false))) return null;
  const text = messages(asLang(lang)).catalogOffer;
  return { msg: catalogMessage(text), text };
}

const CATALOG_WORD = /^(?:ال|لل|بال|عال)?(?:كتالوج|كتالوغ|كتالوك|كاتالوج|كاتالوغ|كاتالوك|كتلوج|كاتلوج)$|^(?:catalog|catalogue|catalogo|katalog|katalogue)s?$/u;
const CATALOG_FILLER = new Set(["بدي", "بدنا", "شوف", "اشوف", "نشوف", "فرجيني", "وريني", "ورجيني", "ابعتلي", "ابعت", "ابعتو", "بعتلي", "عطيني", "افتح",
  "فتحلي", "ممكن", "لو", "سمحت", "بليز", "من", "فضلك", "وين", "في", "عندكن", "عندكم", "هو", "تبعكن", "تبعكم", "الصور", "بالصور", "يا", "مرحبا",
  "show", "me", "the", "your", "see", "send", "open", "want", "i", "to", "can", "please", "pls", "plz", "a", "look", "at", "view", "browse", "do", "you",
  "have", "is", "there", "where", "s", "bade", "baddi", "bde", "bdi", "shouf", "chouf", "l", "el", "ma3", "lal",
  "le", "la", "les", "votre", "voir", "je", "veux", "voudrais", "montrez", "moi", "envoyez", "svp", "stp", "s'il", "vous", "plaît", "plait", "ouvrir",
  "bonjour", "salut", "hi", "hello", "marhaba"]);

/** True when the message only asks to see the catalogue (any language), never when it names a category or an item. */
export function catalogueAsked(text: string): boolean {
  const words = text.toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8 || !words.some((w) => CATALOG_WORD.test(w))) return false;
  return words.every((w) => CATALOG_WORD.test(w) || CATALOG_FILLER.has(w));
}
