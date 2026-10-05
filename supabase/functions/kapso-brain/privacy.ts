// Pure helpers for "delete my data" / "forget my address" (privacy, Law 81/2018 spirit): command detection in English, Arabic and Arabizi,
// the one-line privacy notice, and the confirmation of what was deleted. No I/O; the deletion itself lives in index.ts.

export type ForgetScope = "all" | "address";

// Arabic: drop diacritics/tatweel and unify alef / ta marbuta / alef maqsura so "إحذف" == "احذف".
const normArabic = (s: string) => s.replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const norm = (s: string) => normArabic(String(s ?? "")).toLowerCase().replace(/[.,!?؟،"'`]+/g, " ").replace(/\s+/g, " ").trim();

const EN_VERB = "(?:delete|erase|remove|forget|wipe|clear)";
const EN_POLITE = "(?:please |pls |kindly )?";
const EN_DATA = "(?:data|information|info|details|account|profile|history)";
const EN_ADDR = "(?:address|addresses|location|locations|pin|pins)";
const EN_ALL = new RegExp(`^${EN_POLITE}(?:${EN_VERB} (?:all )?(?:of )?(?:my |the )?(?:personal |saved )?${EN_DATA}|${EN_VERB} me|forget about me)(?: please| pls)?$`);
const EN_ADDRESS = new RegExp(`^${EN_POLITE}${EN_VERB} (?:all )?(?:of )?(?:my )?(?:saved |stored )?${EN_ADDR}(?: please| pls)?$`);

const AR_VERB = "(?:احذف|امسح|ازل|شيل|انسي|انسا|انسى|الغي)";
const AR_POLITE = "(?:(?:لو سمحت|من فضلك|رجاء|ياريت) )?";
const AR_ALL = new RegExp(`^${AR_POLITE}(?:${AR_VERB} (?:كل )?(?:بياناتي|معلوماتي|حسابي)|احذفني|انسني|امسحني)(?: لو سمحت| من فضلك)?$`);
const AR_ADDRESS = new RegExp(`^${AR_POLITE}${AR_VERB} (?:كل )?(?:عنواني|عناويني|موقعي|مواقعي)(?: لو سمحت| من فضلك)?$`);

// Arabizi (digits for Arabic letters: 7 ح, 3 ع, ...): e7zef / emsa7 / nsa / shil + bayanati / ma3lomati (data) or 3enwani (address)
const AZ_VERB = "(?:e7zef|a7zef|7ezef|ehzef|ahzef|emsa7|emse7|amsa7|msa7|emsah|emsa7li|shil|sheel|nsa|insa|ensa|ensi|nsi)";
const AZ_ALL = new RegExp(`^(?:${AZ_VERB} (?:kel |kol )?(?:bayanati|bayanet|bayanat|ma3lomati|ma3loumati|ma3lumati|ma3lomat)|e7zefni|a7zefni|ensani|nsini|emsa7ni|emse7ni)$`);
const AZ_ADDRESS = new RegExp(`^${AZ_VERB} (?:kel |kol )?(?:3enwani|3enwane|3enwan|3anwani|3anwane|mawke3i|mawqe3i|mawke3)$`);

/** "all": delete my data / forget me. "address": forget my address / location. Whole-message matches only, so ordinary sentences never trigger it. */
export function forgetScope(text: string): ForgetScope | null {
  const t = norm(text);
  if (!t) return null;
  if (EN_ADDRESS.test(t) || AR_ADDRESS.test(t) || AZ_ADDRESS.test(t)) return "address";
  if (EN_ALL.test(t) || AR_ALL.test(t) || AZ_ALL.test(t)) return "all";
  return null;
}

export const privacyNotice = (ar: boolean) =>
  ar ? "🔒 بحفظ عنوانك لسهّل طلبك الجاي. ابعت *احذف بياناتي* بأي وقت وبمسحها." : "🔒 I keep your delivery address to speed up your next order. Send *delete my data* anytime and I'll erase it.";

export type DeletionCounts = { addresses: number; pins: number; name: boolean; baskets: number; voice: number; chats: number; carts: number; ordersAnonymised: number; openOrders: number; offersOff: boolean };

export function deletionConfirmation(scope: ForgetScope, n: DeletionCounts, ar: boolean): string {
  const gone: string[] = [];
  const en = !ar;
  if (n.addresses) gone.push(en ? `${n.addresses} saved address${n.addresses > 1 ? "es" : ""}` : `${n.addresses} عنوان محفوظ`);
  if (n.pins) gone.push(en ? `${n.pins} location pin${n.pins > 1 ? "s" : ""}` : `${n.pins} موقع محفوظ`);
  if (scope === "address") gone.push(en ? "your current delivery address" : "عنوان التوصيل الحالي");
  if (scope === "all") {
    if (n.name) gone.push(en ? "your name" : "اسمك");
    if (n.baskets) gone.push(en ? `${n.baskets} saved basket${n.baskets > 1 ? "s" : ""}` : `${n.baskets} سلة محفوظة`);
    if (n.voice) gone.push(en ? "voice-note transcripts" : "نصوص الرسائل الصوتية");
    if (n.chats) gone.push(en ? "our chat history" : "سجل المحادثة");
    if (n.carts) gone.push(en ? "unconfirmed order summaries" : "ملخصات الطلبات غير المؤكدة");
    if (n.offersOff) gone.push(en ? "offers turned off" : "إيقاف العروض");
  }
  const nothing = !n.addresses && !n.pins && !n.name && !n.baskets && !n.voice && !n.chats && !n.carts && scope === "address";
  const head = en
    ? (nothing ? "✅ Done. I had no saved address for you, and your current delivery address is cleared." : `✅ Deleted: ${gone.join(", ")}.`)
    : (nothing ? "✅ تم. ما كان عندي عنوان محفوظ إلك، وتم مسح عنوان التوصيل الحالي." : `✅ تم الحذف: ${gone.join("، ")}.`);
  const kept: string[] = [];
  if (scope === "all" && n.ordersAnonymised) kept.push(en ? `${n.ordersAnonymised} past order${n.ordersAnonymised > 1 ? "s" : ""} are kept only as accounting records (items, totals and dates; your name and address are removed)` : `${n.ordersAnonymised} طلب سابق محفوظ كسجل محاسبي فقط (الأصناف والمبالغ والتواريخ، واسمك وعنوانك انمسحوا)`);
  if (n.openOrders) kept.push(en ? `${n.openOrders} open order${n.openOrders > 1 ? "s keep" : " keeps"} its delivery address until delivered` : `${n.openOrders} طلب مفتوح بيضل عنوان التوصيل لحد ما يوصل`);
  return kept.length ? `${head}\n${en ? "Kept" : "انحفظ"}: ${kept.join(en ? "; " : "؛ ")}.` : head;
}
