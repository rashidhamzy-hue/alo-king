// UX2b: the words of the Settings page, one entry per editable field (the list itself is data: editable_settings, migration 0231).
// Which fields exist, their type, bounds and which are two-person is the database's; this only says what each is called, in Arabic and
// English, and which group of the page it sits in. A field the database lists that has no entry here still shows, under its own name.
import type { Lang } from "../i18n";

export type GroupId = "hours" | "fees" | "timers" | "caps" | "pickup" | "escalation" | "limits" | "switches";
export const GROUP_ORDER: GroupId[] = ["hours", "fees", "timers", "caps", "pickup", "escalation", "limits", "switches"];
type Words = { en: string; ar: string };
export const GROUPS: Record<GroupId, { title: Words; note: Words }> = {
  hours: { title: { en: "Hours and minimum order", ar: "ساعات العمل والحد الأدنى للطلب" }, note: { en: "When the shop takes orders, and the smallest order it takes.", ar: "متى يستقبل المتجر الطلبات، وأصغر طلب يقبله." } },
  fees: { title: { en: "Fees", ar: "الرسوم" }, note: { en: "The small-order fee is company income. The delivery fee and tips belong to whoever delivers; delivery fees are set per zone on the Zones page.", ar: "رسم الطلب الصغير دخل للشركة. أما رسم التوصيل والإكراميات فهي لمن يوصّل؛ ورسوم التوصيل تُضبط لكل منطقة في صفحة المناطق." } },
  timers: { title: { en: "Timers", ar: "المؤقتات" }, note: { en: "How long an order card, a payment or a draft waits before the system acts.", ar: "كم تنتظر بطاقة الطلب أو الدفع أو المسودة قبل أن يتصرف النظام." } },
  caps: { title: { en: "Cash caps", ar: "سقوف النقد" }, note: { en: "What a rider may carry. The database refuses a new cash order past the hard cap. A change needs a second person.", ar: "ما يحق للمندوب حمله. ترفض قاعدة البيانات طلب نقد جديداً بعد السقف الصلب. التغيير يحتاج شخصاً ثانياً." } },
  pickup: { title: { en: "Pickup place", ar: "مكان الاستلام" }, note: { en: "Where a customer collects an order, when pickup is on.", ar: "أين يستلم الزبون طلبه حين يكون الاستلام مفعّلاً." } },
  escalation: { title: { en: "Escalation steps", ar: "خطوات التصعيد" }, note: { en: "Minutes a customer waits for a person before each step (the Inbox shows them).", ar: "الدقائق التي ينتظرها الزبون شخصاً قبل كل خطوة (يعرضها الوارد)." } },
  limits: { title: { en: "Two-person limits", ar: "حدود الشخصين" }, note: { en: "Above these a second person must approve. Changing a limit also needs a second person.", ar: "فوق هذه الحدود يجب أن يوافق شخص ثانٍ. وتغيير الحد نفسه يحتاج شخصاً ثانياً." } },
  switches: { title: { en: "Switches", ar: "المفاتيح" }, note: { en: "Rules that are on or off.", ar: "قواعد مفعّلة أو معطّلة." } },
};

export const META: Record<string, { group: GroupId; name: Words; unit?: Words; help?: Words }> = {
  "hours.open": { group: "hours", name: { en: "Opens", ar: "يفتح" }, help: { en: "Beirut time.", ar: "بتوقيت بيروت." } },
  "hours.close": { group: "hours", name: { en: "Closes", ar: "يغلق" }, help: { en: "Beirut time.", ar: "بتوقيت بيروت." } },
  // WEB4b (0252): the rider shifts, one row of settings.join; a shift starts before it ends (checked in SQL). Windows are offered only inside them.
  "join.rider.shifts.0.from": { group: "hours", name: { en: "Morning rider shift starts", ar: "تبدأ وردية المندوبين الصباحية" }, help: { en: "Beirut time.", ar: "بتوقيت بيروت." } },
  "join.rider.shifts.0.to": { group: "hours", name: { en: "Morning rider shift ends", ar: "تنتهي وردية المندوبين الصباحية" }, help: { en: "Beirut time.", ar: "بتوقيت بيروت." } },
  "join.rider.shifts.1.from": { group: "hours", name: { en: "Evening rider shift starts", ar: "تبدأ وردية المندوبين المسائية" }, help: { en: "Beirut time.", ar: "بتوقيت بيروت." } },
  "join.rider.shifts.1.to": { group: "hours", name: { en: "Evening rider shift ends", ar: "تنتهي وردية المندوبين المسائية" }, help: { en: "Beirut time.", ar: "بتوقيت بيروت." } },
  "min_order_usd.": { group: "hours", name: { en: "Minimum order", ar: "الحد الأدنى للطلب" }, unit: { en: "USD", ar: "دولار" } },
  "small_order_fee.below_subtotal_usd": { group: "fees", name: { en: "Small-order fee applies below", ar: "رسم الطلب الصغير ينطبق تحت" }, unit: { en: "USD of goods; 0 is off", ar: "دولار من المشتريات؛ 0 يعني معطّل" } },
  "small_order_fee.fee_usd": { group: "fees", name: { en: "Small-order fee", ar: "رسم الطلب الصغير" }, unit: { en: "USD", ar: "دولار" } },
  "food.service_fee_usd": { group: "fees", name: { en: "Food service fee (per restaurant order)", ar: "رسم خدمة الطعام (لكل طلب من مطعم)" }, unit: { en: "USD; 0 is off", ar: "دولار؛ 0 يعني معطّل" }, help: { en: "Company income. The delivery fee for food is the zone's and belongs to whoever delivers.", ar: "دخل للشركة. رسم توصيل الطعام هو رسم المنطقة ويعود لمن يوصّل." } },
  "timers.awaiting_payment_min": { group: "timers", name: { en: "A transfer waits for payment", ar: "التحويل ينتظر الدفع" }, unit: { en: "minutes", ar: "دقيقة" } },
  "timers.awaiting_confirmation_min": { group: "timers", name: { en: "An order card waits for the customer's tap", ar: "بطاقة الطلب تنتظر ضغطة الزبون" }, unit: { en: "minutes", ar: "دقيقة" } },
  "timers.confirm_reminder_min": { group: "timers", name: { en: "One reminder for an unconfirmed card after", ar: "تذكير واحد بالبطاقة غير المؤكدة بعد" }, unit: { en: "minutes", ar: "دقيقة" } },
  "timers.draft_min": { group: "timers", name: { en: "A draft is dropped after", ar: "تُترك المسودة بعد" }, unit: { en: "minutes", ar: "دقيقة" } },
  "cash_cap.soft_usd": { group: "caps", name: { en: "Soft cap: warn above", ar: "السقف المرن: تحذير فوق" }, unit: { en: "USD a rider holds", ar: "دولار مع المندوب" } },
  "cash_cap.hard_usd": { group: "caps", name: { en: "Hard cap: no new cash order above", ar: "السقف الصلب: لا طلب نقد جديد فوق" }, unit: { en: "USD a rider holds", ar: "دولار مع المندوب" } },
  "pickup.enabled": { group: "pickup", name: { en: "Pickup at the hub", ar: "الاستلام من المستودع" }, help: { en: "Stays off until the pickup place below is set.", ar: "يبقى معطّلاً حتى يُضبط مكان الاستلام أدناه." } },
  "pickup.place_en": { group: "pickup", name: { en: "Pickup place (English)", ar: "مكان الاستلام (بالإنجليزية)" } },
  "pickup.place_ar": { group: "pickup", name: { en: "Pickup place (Arabic)", ar: "مكان الاستلام (بالعربية)" } },
  "support.claim_alert_min": { group: "escalation", name: { en: "Step 1: the ops lead is alerted after", ar: "الخطوة 1: يُنبَّه مسؤول العمليات بعد" }, unit: { en: "minutes", ar: "دقيقة" } },
  "support.founder_alert_min": { group: "escalation", name: { en: "Step 2: the founder is alerted after", ar: "الخطوة 2: يُنبَّه المؤسس بعد" }, unit: { en: "minutes", ar: "دقيقة" } },
  "support.late_min": { group: "escalation", name: { en: "Step 3: the case is marked late after", ar: "الخطوة 3: تُعلَّم الحالة متأخرة بعد" }, unit: { en: "minutes", ar: "دقيقة" } },
  "approvals.refund_usd": { group: "limits", name: { en: "A refund above this needs a second person", ar: "استرداد فوق هذا يحتاج شخصاً ثانياً" }, unit: { en: "USD", ar: "دولار" } },
  "approvals.price_change_pct": { group: "limits", name: { en: "A price change above this needs a second person", ar: "تغيير سعر فوق هذا يحتاج شخصاً ثانياً" }, unit: { en: "percent", ar: "بالمئة" } },
  "approvals.fx_rate_second_person": { group: "limits", name: { en: "Any change to the LBP rate needs a second person", ar: "أي تغيير في سعر الليرة يحتاج شخصاً ثانياً" }, help: { en: "Switching this off needs a second person.", ar: "إيقافه يحتاج شخصاً ثانياً." } },
  "sell_requires_label.enabled": { group: "switches", name: { en: "A packaged item is sold only after its label is read and approved", ar: "لا يُباع المنتج المعبّأ إلا بعد قراءة ملصقه واعتماده" }, help: { en: "On: every packaged item without an approved label reading reads “coming soon”. Turning it on needs a second person; turning it off is immediate. Read the steps on the Intake page first.", ar: "مفعّل: كل منتج معبّأ بلا قراءة ملصق معتمدة يظهر «جايي قريباً». التفعيل يحتاج شخصاً ثانياً؛ والإيقاف فوري. اقرأ الخطوات في صفحة الإدخال أولاً." } },
  // AST1 (0262): the console assistant: on or off, and what it may spend (both caps count the nightly digest too).
  "assistant.enabled": { group: "switches", name: { en: "The console assistant answers questions", ar: "مساعد الكونسول يجيب عن الأسئلة" }, help: { en: "It reads and never acts. Off: the panel says it is off.", ar: "يقرأ ولا يتصرّف أبداً. عند الإيقاف: تقول اللوحة إنه متوقّف." } },
  "assistant.daily_cap_usd": { group: "limits", name: { en: "Assistant: spend per day", ar: "المساعد: الإنفاق في اليوم" }, unit: { en: "USD", ar: "دولار" }, help: { en: "Over it, the assistant stops until tomorrow.", ar: "عند تجاوزه يتوقّف المساعد حتى الغد." } },
  "assistant.monthly_cap_usd": { group: "limits", name: { en: "Assistant: spend per month", ar: "المساعد: الإنفاق في الشهر" }, unit: { en: "USD", ar: "دولار" }, help: { en: "Over it, the assistant stops until next month.", ar: "عند تجاوزه يتوقّف المساعد حتى الشهر القادم." } },
  // AUTO1 (0263): the two approval rules a person approved; the weekly check switches one off by itself, a person switches it back on here
  "automation.dishes.enabled": { group: "switches", name: { en: "Dishes approved by rule (menu-dish-1)", ar: "الأطباق تُقبل بالقاعدة (menu-dish-1)" }, help: { en: "On: a clean dish whose every price is found in the menu's text, or given again by a second reading, is approved automatically, recorded and undoable (Approvals, Auto-approvals). Prices to confirm and anything flagged still come to a person.", ar: "مفعّل: الطبق النظيف الذي يوجد كل سعر له في نص القائمة، أو تعيده قراءة ثانية، يُقبل تلقائياً، مسجّلاً وقابلاً للتراجع (الموافقات، الموافقات التلقائية). الأسعار للتأكيد وكل ما عليه علامة يبقى لشخص." } },
  "automation.photos.enabled": { group: "switches", name: { en: "Pictures decided by rule (photo-vision-2)", ar: "الصور تُقرَّر بالقاعدة (photo-vision-2)" }, help: { en: "On: a picture whose brand, product, size and flavour a vision check confirms is approved; a clear mismatch is rejected with its reason; anything uncertain comes to a person.", ar: "مفعّل: الصورة التي يؤكد فحص الرؤية علامتها ومنتجها وحجمها ونكهتها تُقبل؛ عدم التطابق الواضح يُرفض مع سببه؛ وكل ما هو غير مؤكد يأتي لشخص." } },
  "search.embeddings": { group: "switches", name: { en: "Search by meaning (embeddings)", ar: "البحث بالمعنى (المتجهات)" }, help: { en: "On only once the model's vectors are in the database and the search evaluation shows it beats words alone.", ar: "يُفعَّل فقط بعد أن تصبح متجهات النموذج في قاعدة البيانات وبعد أن يُظهر تقييم البحث أنه يتفوق على الكلمات وحدها." } },
};

export const settingWords = (L: Lang, key: string, field: string) => META[`${key}.${field}`]?.name[L] ?? `${key}${field ? `.${field}` : ""}`;
