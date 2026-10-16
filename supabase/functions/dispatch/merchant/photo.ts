// A merchant's own photo of an item, sent on the Merchant number (DECISIONS §39.15.4, §39.7). The merchant sends a photo
// captioned "photo <item>" (also "صورة <item>", "sora <item>", "photo de <item>"); any other caption, or none, is not an
// item photo and the message carries on to the menu import and the commands. The copilot runs the catalogue validator on
// the photo before anything is uploaded: when Meta would refuse it, the merchant hears why and how to fix it, in their
// language, and nothing is saved. A photo that passes is uploaded to a fresh pending path and the merchant gets a
// one-tap card naming the item it matched; only the tap records it as the item's own photo (replacing a demo photo or an
// earlier one), so a photo never lands on the wrong item unseen. A pending photo nobody taps expires
// (merchant_photo_pending_hours) and its file is deleted the next time any merchant photo or tap is handled. Only an
// owner or a manager changes the menu's photos; a demo shop's photos come from the demo pipeline. Zero model calls:
// what cannot be seen without a vision model (writing, a watermark, a collage) is left to Meta's review.

import {
  imageHeader,
  issuesText,
  validateCatalogItem,
  type CatalogLang,
} from "../../_shared/catalog-rules.ts";
import { isMenuCommand } from "../../_shared/menu-cards.ts";

/** Where merchant photos live (the private bucket menu-item-photos); index.ts writes through Storage. */
export type ItemPhotoStore = {
  put: (path: string, bytes: Uint8Array, mime: string) => Promise<boolean>;
  remove: (path: string) => Promise<void>;
};

export type ItemPhotoDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  fetchMedia:
    | ((m: {
        id: string;
        url: string | null;
      }) => Promise<{ bytes: Uint8Array; mime: string } | null>)
    | null;
  itemPhotos: ItemPhotoStore | null;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

type Member = { member_id: string; vendor_id: string; role: string };
type Media = { id: string; url: string | null; mime: string; caption?: string | null };

/** The bucket's file size limit (supabase/migrations, bucket menu-item-photos). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Expired pending photos cleared per merchant photo or tap. */
const SWEEP = 20;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TAP = new RegExp(`^IPH\\|(${UUID})$`, "i");

/** The pending photo a confirm tap names, or null. */
export const parseItemPhotoTap = (id: string | null | undefined): string | null =>
  TAP.exec(String(id ?? ""))?.[1]?.toLowerCase() ?? null;

const KEYWORDS: [RegExp, CatalogLang][] = [
  [/^\s*(?:photo|image)\s+(?:de\s+la|de\s+l['’]|du|des|de)\s+(.+)$/i, "fr"],
  [/^\s*(?:photo|picture|pic|image|img)\b\s*(?:(?:of|for)\s+)?[:\-–]?\s*(.+)$/i, "en"],
  [/^\s*(?:صورة|صوره|صورت|تصوير)(?=[\s:\-–])(?:\s+(?:لـ|تبع))?\s*[:\-–]?\s*(.+)$/, "ar"],
  [
    /^\s*(?:sora|soura|sura|swra|soret|sourit)\b\s*(?:(?:la|l|ta3|tab3)\s+)?[:\-–]?\s*(.+)$/i,
    "arabizi",
  ],
];

/**
 * The item a photo's caption names, and the language the merchant wrote it in, when the caption says "photo …" in one
 * of the four languages; null for any other caption (a menu page, a plain word) or none.
 */
export function photoCaption(
  caption: string | null | undefined,
): { item: string; lang: CatalogLang } | null {
  const c = String(caption ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!c) return null;
  for (const [re, lang] of KEYWORDS) {
    const m = re.exec(c);
    if (m && m[1].trim()) return { item: m[1].trim().slice(0, 80), lang };
  }
  return null;
}

const W = (en: string, ar: string, fr: string, arabizi: string) => ({ ar, en, fr, arabizi });
const SAY = {
  notAllowed: W(
    "📷 Only the owner or a manager can change the menu's photos.",
    "📷 صور المنيو بيغيّرها صاحب المحل أو المدير بس.",
    "📷 Seuls le propriétaire ou un gérant peuvent changer les photos du menu.",
    "📷 Sowar el menu bighayyera sa7eb el ma7al aw el modir bas.",
  ),
  notFound: W(
    "📷 That item is no longer on your menu, so the photo was not saved.",
    "📷 هالصنف ما عاد بالمنيو، فما حفظنا الصورة.",
    "📷 Cet article n'est plus dans votre menu : la photo n'a pas été enregistrée.",
    "📷 Hal sanf ma 3ad bel menu, fa ma 7afazna el soura.",
  ),
  noFile: W(
    "📷 I couldn't open this photo. Send it again.",
    "📷 ما قدرت إفتح هالصورة. ابعتها مرة تانية.",
    "📷 Je n'ai pas pu ouvrir cette photo. Renvoyez-la.",
    "📷 Ma 2dirt efta7 hal soura. B3ata kamen marra.",
  ),
  refused: W(
    "📷 WhatsApp's catalogue would refuse this photo of “{name}”:\n{lines}\nNothing was saved.",
    "📷 كاتالوج واتساب رح يرفض هالصورة لـ «{name}»:\n{lines}\nما حفظنا شي.",
    "📷 Le catalogue WhatsApp refuserait cette photo de « {name} » :\n{lines}\nRien n'a été enregistré.",
    "📷 El catalogue tab3 WhatsApp ra7 yerfod hal soura la «{name}»:\n{lines}\nMa 7afazna shi.",
  ),
  tooBig: W(
    "📷 This file is too big (over 2 MB). Send it as a normal photo, not as a document.",
    "📷 هالملف كبير كتير (أكتر من 2 MB). ابعتها كصورة عادية، مش كملف.",
    "📷 Ce fichier est trop lourd (plus de 2 Mo). Envoyez-le comme une photo normale, pas comme un document.",
    "📷 Hal file kbir ktir (aktar men 2 MB). B3ata ka soura 3adiye, mish ka file.",
  ),
  demo: W(
    "📷 This is a demo shop: its photos come from the demo photos, not from the chat.",
    "📷 هيدا محل تجريبي: صورو بتجي من صور العرض، مش من المحادثة.",
    "📷 C'est un commerce de démonstration : ses photos viennent des photos de démo, pas de la discussion.",
    "📷 Hayda ma7al demo: sowaro btejé men sowar el demo, mish men el chat.",
  ),
  failed: W(
    "📷 Saving the photo failed. Send it again in a minute.",
    "📷 ما زبط حفظ الصورة. ابعتها كمان دقيقة.",
    "📷 L'enregistrement de la photo a échoué. Renvoyez-la dans une minute.",
    "📷 Ma zabat 7efz el soura. B3ata ba3d d2i2a.",
  ),
  confirm: W(
    "📷 Use this photo for “{name}”? It replaces the item's current photo, and WhatsApp's catalogue gets it at its next update.",
    "📷 نستعمل هالصورة لـ «{name}»؟ بتحلّ محل صورة الصنف هلّق، وكاتالوج واتساب بياخدها بأوّل تحديث.",
    "📷 Utiliser cette photo pour « {name} » ? Elle remplace la photo actuelle de l'article, et le catalogue WhatsApp la reçoit à sa prochaine mise à jour.",
    "📷 Nesta3mel hal soura la «{name}»? Btet7all ma7al soura el sanf halla2, w el catalogue tab3 WhatsApp byekhoda b awwal update.",
  ),
  button: W("✅ Use this photo", "✅ استعملها", "✅ Utiliser", "✅ Esta3mila"),
  saved: W(
    "📷 Saved as the photo of “{name}”. WhatsApp's catalogue gets it at its next update.",
    "📷 حفظناها صورة «{name}». كاتالوج واتساب بياخدها بأوّل تحديث.",
    "📷 Enregistrée comme photo de « {name} ». Le catalogue WhatsApp la reçoit à sa prochaine mise à jour.",
    "📷 7afaznaha soura «{name}». El catalogue tab3 WhatsApp byekhoda b awwal update.",
  ),
  expired: W(
    "📷 This photo waited too long and was not saved. Send it again with its caption.",
    "📷 هالصورة استنّت كتير وما انحفظت. ابعتها مرة تانية مع التعليق.",
    "📷 Cette photo a trop attendu et n'a pas été enregistrée. Renvoyez-la avec sa légende.",
    "📷 Hal soura stannet ktir w ma n7afazet. B3ata kamen marra ma3 el caption.",
  ),
};
type Say = keyof typeof SAY;
const say = (k: Say, lang: CatalogLang, vars: Record<string, string> = {}) =>
  SAY[k][lang].replace(/\{(\w+)\}/g, (m, v: string) => vars[v] ?? m);
const isLang = (x: unknown): x is CatalogLang =>
  x === "ar" || x === "en" || x === "fr" || x === "arabizi";

const textMsg = (to: string, body: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to.replace(/^\+/, ""),
  type: "text",
  text: { body },
});

/** The one-tap card that records a pending photo as the item's own (Meta limits: meta-limits.test.ts). */
export function itemPhotoCard(
  to: string,
  pendingId: string,
  itemName: string,
  lang: CatalogLang,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: say("confirm", lang, { name: itemName.slice(0, 200) }) },
      action: {
        buttons: [{ type: "reply", reply: { id: `IPH|${pendingId}`, title: SAY.button[lang] } }],
      },
    },
  };
}

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

/** Deletes the files of pending photos nobody tapped in time (their rows are gone when this returns). */
async function sweepExpired(deps: ItemPhotoDeps) {
  if (!deps.itemPhotos) return;
  const paths: string[] =
    (await deps.rpc("merchant_item_photo_pending_expired", { p_limit: SWEEP }).catch(() => null)) ??
    [];
  for (const p of paths)
    await deps.itemPhotos.remove(p).catch(() => deps.log?.("item photo: stale file not removed"));
}

const removeQuietly = (deps: ItemPhotoDeps, path: unknown) =>
  typeof path === "string" && path && deps.itemPhotos
    ? deps.itemPhotos
        .remove(path)
        .catch((e: unknown) =>
          deps.log?.("item photo: old file not removed", { error: String(e).slice(0, 120) }),
        )
    : Promise.resolve();

/**
 * What to send for an item photo or its confirm tap, or null when the message is neither (no image, a caption that is
 * not "photo …", a menu command, no clear item), so the menu import and the commands carry on as before. During a menu
 * import the item is looked up only in the shop being imported.
 */
export async function handleItemPhoto(
  deps: ItemPhotoDeps,
  m: { from: string; buttonId: string | null; media: Media | null },
  members: Member[],
  importing: { vendorId: string | null } | null,
): Promise<Record<string, unknown>[] | null> {
  const editors = members.filter((x) => x.role === "owner" || x.role === "manager");
  const tapped = parseItemPhotoTap(m.buttonId);
  if (tapped) {
    await sweepExpired(deps);
    const r = await deps.rpc("merchant_item_photo_confirm", {
      p_pending_id: tapped,
      p_member_ids: editors.map((e) => e.member_id),
    });
    const lang: CatalogLang = isLang(r?.lang) ? r.lang : "ar";
    const status = String(r?.status ?? "");
    if (status === "ok") {
      if (r.previous) await removeQuietly(deps, r.previous);
      return [textMsg(m.from, say("saved", lang, { name: String(r.item_name ?? "") }))];
    }
    // A refused tap whose photo can no longer be used: its file goes with it.
    if (r?.path) await removeQuietly(deps, r.path);
    const k: Say =
      status === "expired" || status === "not_found"
        ? "expired"
        : status === "demo_shop"
          ? "demo"
          : status === "no_item"
            ? "notFound"
            : status === "not_allowed"
              ? "notAllowed"
              : "failed";
    return [textMsg(m.from, say(k, lang))];
  }

  const media = m.media;
  if (!media || !/^image\/[a-z0-9.+-]+$/i.test(media.mime ?? "")) return null;
  const cap = photoCaption(media.caption);
  if (!cap || isMenuCommand(cap.item) || isMenuCommand(media.caption)) return null;
  const lang = cap.lang;
  const shops = importing?.vendorId
    ? editors.filter((e) => e.vendor_id === importing.vendorId)
    : editors;
  if (!shops.length) return members.length ? [textMsg(m.from, say("notAllowed", lang))] : null;
  // The item, by the same clear-winner rule as every copilot command (a chain tries each of its branches).
  let item: { item_id: string; name: string } | null = null;
  let editor: Member | null = null;
  for (const e of shops) {
    const rows: { item_id: string; name: string; score: number }[] =
      (await deps.rpc("menu_item_match", {
        p_vendor_id: e.vendor_id,
        p_query: cap.item,
        p_limit: 3,
      })) ?? [];
    const best = rows[0];
    if (best && best.score >= 0.3 && (!rows[1] || best.score - rows[1].score >= 0.1)) {
      item = best;
      editor = e;
      break;
    }
  }
  if (!item || !editor) return null;
  const file = deps.fetchMedia ? await deps.fetchMedia(media).catch(() => null) : null;
  if (!file?.bytes?.length) return [textMsg(m.from, say("noFile", lang))];
  const sha = hex(await crypto.subtle.digest("SHA-256", new Uint8Array(file.bytes)));
  // What Meta would refuse, before anything is uploaded (§39.15.4).
  const issues = validateCatalogItem({}, { bytes: file.bytes, sha256: sha });
  if (issues.length)
    return [
      textMsg(m.from, say("refused", lang, { name: item.name, lines: issuesText(issues, lang) })),
    ];
  if (file.bytes.length > MAX_PHOTO_BYTES) return [textMsg(m.from, say("tooBig", lang))];
  // The validator read the header, so the format and the size are known.
  const head = imageHeader(file.bytes)!;
  const ext = head.format === "jpeg" ? "jpg" : head.format;
  await sweepExpired(deps);
  const where = await deps.rpc("merchant_item_photo_path", {
    p_member_id: editor.member_id,
    p_item_id: item.item_id,
    p_ext: ext,
  });
  const refusal = (status: string): Say =>
    status === "not_allowed"
      ? "notAllowed"
      : status === "demo_shop"
        ? "demo"
        : status === "no_item"
          ? "notFound"
          : "failed";
  if (where?.status !== "ok")
    return [textMsg(m.from, say(refusal(String(where?.status ?? "")), lang))];
  if (!deps.itemPhotos) {
    deps.log?.("item photo: no store wired");
    return [textMsg(m.from, say("failed", lang))];
  }
  const stored = await deps.itemPhotos
    .put(where.path, file.bytes, `image/${head.format}`)
    .catch(() => false);
  if (!stored) return [textMsg(m.from, say("failed", lang))];
  const rec = await deps.rpc("merchant_item_photo_pending", {
    p_member_id: editor.member_id,
    p_pending_id: where.pending_id,
    p_item_id: item.item_id,
    p_storage_path: where.path,
    p_origin_hash: sha,
    p_width: head.width,
    p_height: head.height,
    p_bytes: file.bytes.length,
    p_lang: lang,
  });
  if (rec?.status !== "ok") {
    await removeQuietly(deps, where.path);
    return [textMsg(m.from, say(refusal(String(rec?.status ?? "")), lang))];
  }
  // A photo of the same item still waiting for its tap is replaced: its file goes.
  if (rec.replaced) await removeQuietly(deps, rec.replaced);
  return [itemPhotoCard(m.from, String(where.pending_id), item.name, lang)];
}
