// What each exception kind is called, and the one page that deals with it (session D5). Used by Today's inbox and by the push
// alert, so a tap on either lands in the same place. A kind not listed still shows, as its own name, and opens the exceptions page.
import type { Lang } from "./i18n";

export interface ExceptionRow { id: string; kind: string; ref: string; detail: Record<string, unknown> | null }
type Info = { en: string; ar: string; href: (e: ExceptionRow) => string; cta: { en: string; ar: string } };

const orderRef = (e: ExceptionRow) => {
  const code = [e.ref, e.detail?.short_code, e.detail?.order].find((v) => typeof v === "string" && /^AK-\d+$/i.test(v)) as string | undefined;
  const id = typeof e.detail?.order_id === "string" ? e.detail.order_id : /^[0-9a-f-]{36}$/i.test(e.ref) ? e.ref : null;
  const to = code ?? id;
  return to ? `/orders/${encodeURIComponent(to)}` : "/orders";
};

export const KIND: Record<string, Info> = {
  payment_proof: { en: "A payment proof waits", ar: "إثبات دفع بالانتظار", href: () => "/payments", cta: { en: "Check the payment", ar: "راجع الدفعة" } },
  late_payment: { en: "A payment came late", ar: "دفعة متأخرة وصلت", href: () => "/payments", cta: { en: "Open payments", ar: "افتح المدفوعات" } },
  pick_empty: { en: "An order could not be picked", ar: "تعذّر تجهيز طلب", href: orderRef, cta: { en: "Open the order", ar: "افتح الطلب" } },
  delivery_problem: { en: "A delivery problem was reported", ar: "أُبلغ عن مشكلة في التوصيل", href: orderRef, cta: { en: "Open the order", ar: "افتح الطلب" } },
  rider_off: { en: "A rider cannot continue", ar: "مندوب لا يستطيع المتابعة", href: () => "/riders", cta: { en: "Open riders", ar: "افتح المناديب" } },
  allergen_complaint: { en: "Allergen complaint", ar: "شكوى حساسية", href: () => "/cases", cta: { en: "Open the case", ar: "افتح الحالة" } },
  scheduled_stock_short: { en: "A scheduled order is short of stock", ar: "طلب مجدول ينقصه مخزون", href: () => "/windows", cta: { en: "Open windows", ar: "افتح النوافذ" } },
  scheduled_day_changed: { en: "A delivery day changed", ar: "تغيّر يوم توصيل", href: () => "/windows", cta: { en: "Open windows", ar: "افتح النوافذ" } },
  count_needed: { en: "A shelf count is needed", ar: "مطلوب جرد رف", href: () => "/catalog", cta: { en: "Open the catalog", ar: "افتح الكتالوج" } },
  turn_failed: { en: "The assistant gave up on a message", ar: "تخلّى المساعد عن رسالة", href: () => "/exceptions", cta: { en: "Open chats", ar: "افتح المحادثات" } },
  agent_handoff: { en: "A chat was handed to a person", ar: "مُرّرت محادثة إلى شخص", href: () => "/exceptions", cta: { en: "Open chats", ar: "افتح المحادثات" } },
  model_capacity: { en: "The AI model was unavailable: a chat was handed to a person", ar: "نموذج الذكاء الاصطناعي غير متاح: مُرّرت محادثة إلى شخص", href: () => "/exceptions", cta: { en: "Open chats", ar: "افتح المحادثات" } },
  dead_letter: { en: "A customer message failed every retry", ar: "رسالة زبون فشلت كل المحاولات", href: () => "/exceptions", cta: { en: "Open exceptions", ar: "افتح الاستثناءات" } },
  "heartbeat:probe_stuck": { en: "The hourly test order is stuck", ar: "طلب التجربة كل ساعة واقف", href: () => "/exceptions", cta: { en: "Open exceptions", ar: "افتح الاستثناءات" } },
  "heartbeat:inbound_silent": { en: "No customer message for hours", ar: "ما وصلت رسالة زبون من ساعات", href: () => "/exceptions", cta: { en: "Open exceptions", ar: "افتح الاستثناءات" } },
  model_account: { en: "The AI provider refused calls", ar: "مزوّد الذكاء الاصطناعي رفض الطلبات", href: () => "/exceptions", cta: { en: "Open chats", ar: "افتح المحادثات" } },
  // HO1: the case ladder (0136) and the 2-minute alarm; each opens the Inbox.
  support_case: { en: "A customer is waiting for a person", ar: "زبون بانتظار شخص", href: () => "/inbox", cta: { en: "Open the Inbox", ar: "افتح الوارد" } },
  support_case_unclaimed: { en: "Nobody has claimed a customer for 3 minutes", ar: "زبون بلا مستلم من 3 دقائق", href: () => "/inbox", cta: { en: "Open the Inbox", ar: "افتح الوارد" } },
  support_case_founder: { en: "A customer has waited 5 minutes for a person", ar: "زبون ينتظر شخصاً من 5 دقائق", href: () => "/inbox", cta: { en: "Open the Inbox", ar: "افتح الوارد" } },
  customer_unanswered: { en: "A customer message got no reply for 2 minutes", ar: "رسالة زبون بلا رد من دقيقتين", href: () => "/inbox", cta: { en: "Open the Inbox", ar: "افتح الوارد" } },
  technical: { en: "A technical failure on the customer line", ar: "عطل تقني على خط الزبائن", href: () => "/exceptions", cta: { en: "Open exceptions", ar: "افتح الاستثناءات" } },
  // LV1: a Chouf food place listed before it signs was asked to be removed (its page is already hidden, or a limit left it up for a person to decide).
  listing_removal: { en: "A food place asked to be removed", ar: "مكان طعام طلب إزالة صفحته", href: () => "/listings?tab=hidden", cta: { en: "Open food places", ar: "افتح أماكن الطعام" } },
  // WH1a: the chilled zone's temperature log (0240) and an expired lot booked by a pick (0239).
  temperature_out_of_range: { en: "A fridge reading is out of range", ar: "قراءة برّاد خارج المدى", href: () => "/temperature", cta: { en: "Open the temperature log", ar: "افتح سجل الحرارة" } },
  temperature_missed: { en: "A fridge reading was missed", ar: "فاتت قراءة حرارة البرّاد", href: () => "/temperature", cta: { en: "Take the reading", ar: "سجّل القراءة" } },
  expired_lot_picked: { en: "An expired lot left the shelf in an order", ar: "خرجت دفعة منتهية الصلاحية في طلب", href: orderRef, cta: { en: "Open the order", ar: "افتح الطلب" } },
  // FIX1: the weekly size check (usage_size_check, 0241): storage at 600 MB or the database at 350 MB (the free plan holds 1 GB and 500 MB).
  usage_near_limit: { en: "The database or file storage is getting full", ar: "قاعدة البيانات أو مخزن الملفات يقترب من الامتلاء", href: () => "/exceptions", cta: { en: "Open exceptions", ar: "افتح الاستثناءات" } },
  probe_handoff_released: { en: "A test chat was handed back", ar: "أُعيدت محادثة اختبار", href: () => "/exceptions", cta: { en: "Open chats", ar: "افتح المحادثات" } },
};

export const kindName = (kind: string, lang: Lang) => KIND[kind]?.[lang] ?? kind.replace(/_/g, " ");
export const kindHref = (e: ExceptionRow) => (KIND[e.kind]?.href(e) ?? "/exceptions");
export const kindCta = (kind: string, lang: Lang) => KIND[kind]?.cta[lang] ?? (lang === "ar" ? "افتح" : "Open");
