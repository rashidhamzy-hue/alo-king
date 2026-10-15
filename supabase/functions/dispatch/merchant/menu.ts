// The smart menu on the Merchant number (DECISIONS §18.3, §32.3): "menu" → photos, a PDF or pasted text →
// a draft → one card per section (Approve / Skip) → the two nutrition questions → estimates → Confirm.
// Text menus are read by rules (no model). Photos and PDFs need the menu model (config `ai_menu_model`);
// without API credit (§32.7) they are kept for Rasheed instead. Every change is a server function that
// checks the member's role (owner or manager), and nothing reaches the menu without the merchant's tap.

import { clampInteractive } from "../../_shared/meta-limits.ts";
import {
  extractMenu,
  parseMenuText,
  pricedLineCount,
  type Draft,
  type MenuModel,
} from "../../_shared/menu-draft.ts";
import { parseMerchantCommand } from "../../_shared/merchant-commands.ts";
import { firstLink, htmlText } from "../../_shared/safe-fetch.ts";
import {
  draftSectionCard,
  estimateCard,
  extrasQuestion,
  isMenuCommand,
  menuImportHelp,
  parseMenuTap,
  portionQuestion,
  sectionAddedText,
  type SectionSummary,
} from "../../_shared/menu-cards.ts";

type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };

export type MenuDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  send: (payload: Record<string, unknown>) => Promise<SendResult>;
  /** The menu model, or null without a key or credit (§32.7). */
  menuModel: MenuModel | null;
  /** Downloads an inbound image or PDF (Kapso media), at most a few MB; null when it cannot. */
  fetchMedia:
    | ((m: {
        id: string;
        url: string | null;
      }) => Promise<{ bytes: Uint8Array; mime: string } | null>)
    | null;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
  /** Fetches a menu link (https only, capped; safe-fetch.ts); null when not wired. */
  fetchLink?: ((url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>) | null;
};

export type MenuInbound = {
  from: string;
  messageId: string;
  text: string | null;
  buttonId: string | null;
  media: { id: string; url: string | null; mime: string } | null;
};

type Member = { member_id: string; vendor_id: string; role: string };

/** How many estimated items the card lists, and so how many one Confirm tap verifies. */
export const ESTIMATE_CARD_ITEMS = 8;

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Handles the message when it belongs to the smart menu; false lets the merchant commands run. */
export async function handleMerchantMenu(
  deps: MenuDeps,
  m: MenuInbound,
  members: Member[],
): Promise<boolean> {
  const tap = parseMenuTap(m.buttonId);
  const session = await deps.rpc("onboarding_session_get", { p_phone: m.from });
  const inImport = session?.step === "menu_import";
  // The membership that may edit a given vendor's menu (owner or manager); chains have several (§18.1 F).
  const editorFor = (vendorId?: string | null) =>
    members.find(
      (x) =>
        (x.role === "owner" || x.role === "manager") && (!vendorId || x.vendor_id === vendorId),
    );
  const editor = editorFor(inImport ? session?.data?.vendor_id : null);
  // During an import, text counts as a menu only with 2+ priced lines and when it is not a merchant command
  // ("change closing time to 11" stays a command).
  const textMenu =
    !!m.text && pricedLineCount(m.text) >= 2 && !parseMerchantCommand(m.text, new Date());
  // A link to the menu (a web page or a PDF, §39.7) during an import.
  const link = inImport && !textMenu ? firstLink(m.text) : null;
  if (!tap && !isMenuCommand(m.text) && !(inImport && (m.media || textMenu || link))) return false;
  const out: Record<string, unknown>[] = [];
  const reply = (p: Record<string, unknown>) => out.push(p);
  const text = (body: string) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: m.from.replace(/^\+/, ""),
    type: "text",
    text: { body },
  });
  const safe = async (fn: string, args: Record<string, unknown>) => {
    try {
      return await deps.rpc(fn, args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not allowed/.test(msg)) return { status: "not_allowed" };
      if (/at most|1-60 sections|draft has/.test(msg)) return { status: "too_big", error: msg };
      throw e;
    }
  };

  if (tap) {
    await handleTap(deps, tap, editorFor, session, m, reply, text, safe);
  } else if (!editor) {
    reply(
      text(
        "المنيو والأسعار بيغيّرها صاحب المحل أو المدير بس. / Only the owner or a manager can change the menu.",
      ),
    );
  } else if (isMenuCommand(m.text)) {
    await deps.rpc("onboarding_session_set", {
      p_phone: m.from,
      p_step: "menu_import",
      p_data: { vendor_id: editor.vendor_id, member_id: editor.member_id },
      p_lang: null,
    });
    reply(menuImportHelp(m.from, !!deps.menuModel));
  } else {
    // A photo, PDF or pasted text during import.
    const vendorId = session.data?.vendor_id ?? editor.vendor_id;
    const memberId = session.data?.member_id ?? editor.member_id;
    let draft: Draft | null = null;
    let source = "text";
    if (link) {
      // A broken or hostile page never fails the event (it would be retried, fetching the link again).
      const file = deps.fetchLink ? await deps.fetchLink(link).catch(() => null) : null;
      if (file && file.mime === "application/pdf") {
        source = "pdf";
        if (deps.menuModel && file.bytes.length <= 5_000_000) {
          try {
            draft = await extractMenu(deps.menuModel, [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: b64(file.bytes) },
              },
            ]);
          } catch (e) {
            deps.log?.("menu model failed", { error: String(e).slice(0, 120) });
          }
        }
      } else if (file) {
        source = "link";
        // The page's text through the same rules as pasted text (no model, §32.7).
        try {
          draft = parseMenuText(htmlText(new TextDecoder().decode(file.bytes)));
        } catch (e) {
          deps.log?.("menu link unreadable", { error: String(e).slice(0, 120) });
          draft = { sections: [], warnings: [] };
        }
      } else {
        reply(
          text(
            "ما قدرت إفتح هالرابط. ابعت صور المنيو أو PDF أو الصق المنيو كنص. / I couldn't open that link; send photos, a PDF or paste the menu as text.",
          ),
        );
        draft = { sections: [], warnings: ["quota"] };
      }
    } else if (m.text) {
      draft = parseMenuText(m.text);
    } else if (
      m.media &&
      deps.menuModel &&
      deps.fetchMedia &&
      !(await deps.rpc("menu_model_take", { p_vendor_id: vendorId, p_member_id: memberId }))
    ) {
      // Checked before the call, so the daily cap bounds model spend.
      reply(
        text(
          "وصلت للحد اليومي لقراءة صور المنيو. كمّل بكرا أو الصق المنيو كنص. / Today's limit for reading menu photos is reached; continue tomorrow or paste the menu as text.",
        ),
      );
      draft = { sections: [], warnings: ["quota"] };
    } else if (m.media && deps.menuModel && deps.fetchMedia) {
      const file = await deps.fetchMedia(m.media);
      const pdf = (file?.mime ?? m.media.mime) === "application/pdf";
      source = pdf ? "pdf" : "photo";
      if (file && file.bytes.length <= 5_000_000) {
        try {
          draft = await extractMenu(deps.menuModel, [
            pdf
              ? {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: b64(file.bytes) },
                }
              : {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: file.mime || "image/jpeg",
                    data: b64(file.bytes),
                  },
                },
          ]);
        } catch (e) {
          deps.log?.("menu model failed", { error: String(e).slice(0, 120) });
        }
      }
    }
    if (!draft) {
      // No model (no credit, §32.7) or the file could not be read: Rasheed helps, nothing is guessed.
      await deps.rpc("merchant_menu_help", {
        p_vendor_id: vendorId,
        p_member_id: memberId,
        p_media_ref: m.media ? `wa-media:${m.media.id}` : null,
      });
      reply(
        text(
          "📋 وصلت الصورة. رشيد من Alo King رح يساعدك تحطّ المنيو. فيك كمان تلصق المنيو كنص هون. / Got it. Rasheed will help you set up the menu; you can also paste it here as text.",
        ),
      );
    } else if (draft.warnings.includes("quota")) {
      // already answered
    } else if (!draft.sections.length) {
      reply(
        text(
          "ما قدرت إقرا أصناف بأسعار. جرّب سطر لكل صنف مع سعره، مثلا «شاورما دجاج 4$». / I couldn't read items with prices. Try one line per item with its price, e.g. “Chicken shawarma 4$”.",
        ),
      );
    } else {
      const r = await safe("menu_draft_create", {
        p_vendor_id: vendorId,
        p_source: source,
        p_sections: draft.sections,
        p_warnings: draft.warnings,
        p_model: source === "text" || source === "link" ? "rules" : "menu_model",
        p_member_id: memberId,
      });
      if (r?.status === "not_allowed") reply(text("مش مسموح. / Not allowed."));
      else if (r?.status === "too_big")
        reply(
          text(
            "المنيو كبير كتير لمرة وحدة؛ ابعتو على دفعات. / Too large at once; send it in parts.",
          ),
        );
      else {
        const sections: SectionSummary[] = r?.sections ?? [];
        if (sections[0]) reply(draftSectionCard(m.from, r.draft_id, sections[0], sections.length));
      }
    }
  }
  for (const p of out) {
    const res = await deps.send(clampInteractive(p));
    if (!res.ok) deps.log?.("menu send failed", { error: res.error.slice(0, 120) });
  }
  return true;
}

async function handleTap(
  deps: MenuDeps,
  tap: NonNullable<ReturnType<typeof parseMenuTap>>,
  editorFor: (vendorId?: string | null) => Member | undefined,
  session: { step?: string; data?: Record<string, any> } | null,
  m: MenuInbound,
  reply: (p: Record<string, unknown>) => void,
  text: (body: string) => Record<string, unknown>,
  safe: (fn: string, args: Record<string, unknown>) => Promise<any>,
) {
  const notAllowed = () =>
    reply(
      text(
        "المنيو والأسعار بيغيّرها صاحب المحل أو المدير بس. / Only the owner or a manager can change the menu.",
      ),
    );
  switch (tap.a) {
    case "approve":
    case "skip": {
      const before = await deps.rpc("menu_draft_summary", { p_draft_id: tap.draftId });
      const editor = editorFor(before?.vendor_id);
      if (!before?.vendor_id || !editor) return notAllowed();
      if (tap.a === "approve") {
        const r = await safe("menu_draft_approve_section", {
          p_draft_id: tap.draftId,
          p_index: tap.index,
          p_member_id: editor.member_id,
        });
        if (r?.status === "not_allowed") return notAllowed();
        if (r?.status === "approved")
          reply(sectionAddedText(m.from, r.inserted ?? 0, r.needs_price ?? []));
      }
      // The next section still waiting, else the nutrition questions.
      const sum = await deps.rpc("menu_draft_summary", { p_draft_id: tap.draftId });
      const sections: (SectionSummary & { approved: boolean })[] = sum?.sections ?? [];
      const next = sections.find((s) => !s.approved && s.index > tap.index);
      if (next) return reply(draftSectionCard(m.from, tap.draftId, next, sections.length));
      await deps.rpc("onboarding_session_set", {
        p_phone: m.from,
        p_step: null,
        p_data: {},
        p_lang: null,
      });
      return reply(portionQuestion(m.from, before.vendor_id));
    }
    case "size":
      if (!editorFor(tap.vendorId)) return notAllowed();
      return reply(extrasQuestion(m.from, tap.vendorId, tap.size));
    case "extras": {
      const editor = editorFor(tap.vendorId);
      if (!editor) return notAllowed();
      const r = await safe("menu_nutrition_estimate", {
        p_vendor_id: tap.vendorId,
        p_size: tap.size,
        p_extras:
          tap.extra === "oil"
            ? { extra_oil_g: 10 }
            : tap.extra === "sauce"
              ? { extra_sauce_g: 20 }
              : {},
        p_member_id: editor.member_id,
      });
      if (r?.status === "not_allowed") return reply(text("مش مسموح. / Not allowed."));
      if (!r?.estimated)
        return reply(
          text(
            "ما لقينا أصناف من الوصفات المعروفة. فيك تزيد الأرقام من لوحة التحكم. / No items matched our standard recipes; add values on the dashboard.",
          ),
        );
      // Confirm covers exactly the items the card shows; the rest stay "estimated" until checked.
      const shown = (r.items ?? []).slice(0, ESTIMATE_CARD_ITEMS);
      await deps.rpc("onboarding_session_set", {
        p_phone: m.from,
        p_step: "nutrition_confirm",
        p_data: {
          vendor_id: tap.vendorId,
          item_ids: shown.map((i: { item_id: string }) => i.item_id),
        },
        p_lang: null,
      });
      return reply(estimateCard(m.from, tap.vendorId, { ...r, items: shown }));
    }
    case "confirm": {
      const editor = editorFor(tap.vendorId);
      if (!editor) return notAllowed();
      const ids: string[] =
        session?.step === "nutrition_confirm" && session.data?.vendor_id === tap.vendorId
          ? (session.data.item_ids ?? [])
          : [];
      if (!ids.length)
        return reply(
          text("انتهت صلاحية هالبطاقة. / This card has expired; run the estimate again."),
        );
      const r = await safe("menu_nutrition_confirm", {
        p_vendor_id: tap.vendorId,
        p_item_ids: ids,
        p_member_id: editor.member_id,
      });
      await deps.rpc("onboarding_session_set", {
        p_phone: m.from,
        p_step: null,
        p_data: {},
        p_lang: null,
      });
      if (r?.status === "not_allowed") return reply(text("مش مسموح. / Not allowed."));
      return reply(
        text(`✅ أكّدنا ${r?.confirmed ?? 0} صنف. / Confirmed ${r?.confirmed ?? 0} items.`),
      );
    }
    case "later":
      return reply(
        text(
          "تمام، الأرقام بتبقى «تقدير» لحتى تأكّدها. / OK, the numbers stay “estimated” until you confirm.",
        ),
      );
  }
}
