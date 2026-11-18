// Arabic and English for the console's shell and the pages written in session D5 (Today, Orders, the hubs, the install guide,
// the names batch controls). The language is the staff member's own choice, kept in a cookie (no database, no account setting).
// The 24 pages built before D5 keep their English bodies inside an Arabic shell: render() marks them lang="en" dir="ltr" so a
// reader and a screen reader are not told English is Arabic. The Arabic below was written by a model: like every Arabic string
// in this system, it needs a reader of Arabic (docs/HANDOFF.md, Status).
export type Lang = "en" | "ar";
export const LANGS: readonly Lang[] = ["en", "ar"];
export const LANG_COOKIE = "ak_lang";
export const dirOf = (l: Lang) => (l === "ar" ? "rtl" : "ltr");

type Entry = { en: string; ar: string };
const D = {
  app_name: { en: "Alo King console", ar: "لوحة ألو كينج" },
  skip: { en: "Skip to the content", ar: "انتقل إلى المحتوى" },
  sign_out: { en: "Sign out", ar: "تسجيل الخروج" },
  test_data: { en: "{env}: test data only", ar: "{env}: بيانات تجريبية فقط" },
  main_menu: { en: "Main menu", ar: "القائمة الرئيسية" },
  all_pages: { en: "All pages", ar: "كل الصفحات" },
  // navigation
  nav_today: { en: "Today", ar: "اليوم" },
  nav_orders: { en: "Orders", ar: "الطلبات" },
  nav_approve: { en: "Approve", ar: "الموافقات" },
  nav_stock: { en: "Stock", ar: "المخزون" },
  nav_more: { en: "More", ar: "المزيد" },
  nav_inbox: { en: "Inbox", ar: "الوارد" },
  nav_pick: { en: "Pick", ar: "التجهيز" },
  nav_dispatch: { en: "Dispatch", ar: "التوزيع" },
  nav_intake: { en: "Intake", ar: "التصوير" },
  g_money: { en: "Money", ar: "المال" },
  g_riders: { en: "Riders", ar: "المناديب" },
  g_settings: { en: "Settings", ar: "الإعدادات" },
  // command bar, bell, theme
  cmd_open: { en: "Search or jump to", ar: "ابحث أو انتقل إلى" },
  cmd_label: { en: "Jump to a page or find an order", ar: "انتقل إلى صفحة أو ابحث عن طلب" },
  cmd_ph: { en: "A page, an order code, a customer", ar: "صفحة، رمز طلب، زبون" },
  cmd_ph_pages: { en: "A page or a product", ar: "صفحة أو منتج" },
  cmd_hint: { en: "Type an order code (AK-1042) and press Enter to open that order. Type a page name to filter the pages; anything else searches orders.", ar: "اكتب رمز طلب (AK-1042) واضغط Enter لفتحه. اكتب اسم صفحة لتصفية الصفحات؛ وأي شيء آخر يبحث في الطلبات." },
  cmd_hint_pages: { en: "Type an order code (AK-1042) and press Enter to open its pick list. Type a page name to filter the pages; anything else searches the catalog.", ar: "اكتب رمز طلب (AK-1042) واضغط Enter لفتح قائمة تجهيزه. اكتب اسم صفحة لتصفية الصفحات؛ وأي شيء آخر يبحث في الكتالوج." },
  bell_label: { en: "Alerts", ar: "التنبيهات" },
  bell_empty: { en: "No high-priority exception is open.", ar: "لا يوجد استثناء عالي الأولوية مفتوح." },
  bell_all: { en: "All exceptions", ar: "كل الاستثناءات" },
  theme_h: { en: "Appearance", ar: "المظهر" },
  theme_auto: { en: "Follow the phone", ar: "حسب الهاتف" },
  theme_light: { en: "Light", ar: "فاتح" },
  theme_dark: { en: "Dark", ar: "داكن" },
  gallery_link: { en: "Component gallery (staging)", ar: "معرض المكوّنات (تجريبي)" },
  tab_needs_you: { en: "Needs you now", ar: "يحتاج إليك الآن" },
  tab_all_exceptions: { en: "All exceptions", ar: "كل الاستثناءات" },
  tab_cases: { en: "Waiting for a person", ar: "بانتظار شخص" },
  tab_complaints: { en: "Complaints", ar: "الشكاوى" },
  updated_at: { en: "Updated {time}. Refreshes every minute.", ar: "آخر تحديث {time}. يتحدّث كل دقيقة." },
  g_approve: { en: "Approve", ar: "الموافقات" },
  g_other: { en: "Other", ar: "أخرى" },
  waiting: { en: "waiting", ar: "بالانتظار" },
  // hubs
  hub_approve_intro: { en: "What waits for a decision from a person.", ar: "ما ينتظر قراراً من شخص." },
  hub_stock_intro: { en: "Shelves, deliveries in and returns.", ar: "الرفوف والبضاعة الواردة والمرتجعات." },
  hub_more_intro: { en: "Money, settings, and what belongs to this phone.", ar: "المال والإعدادات وما يخص هذا الهاتف." },
  hub_empty: { en: "Nothing on this list is open to your role.", ar: "لا شيء في هذه القائمة متاح لدورك." },
  // language, install, push
  language: { en: "Language", ar: "اللغة" },
  lang_en: { en: "English", ar: "English" },
  lang_ar: { en: "العربية", ar: "العربية" },
  lang_note: { en: "Pages not yet rebuilt stay in English; the menu, Today, the Inbox, Orders and this page follow your choice.", ar: "الصفحات التي لم تُعَد بعد تبقى بالإنجليزية؛ القائمة واليوم والوارد والطلبات وهذه الصفحة تتبع اختيارك." },
  install_h: { en: "Put the console on your phone", ar: "ضع اللوحة على هاتفك" },
  install_link: { en: "How to add it to the Home Screen", ar: "كيف تضيفها إلى الشاشة الرئيسية" },
  install_ios_h: { en: "iPhone and iPad (Safari)", ar: "آيفون وآيباد (سفاري)" },
  install_ios_1: { en: "Open this console in Safari (not inside another app).", ar: "افتح هذه اللوحة في سفاري (وليس داخل تطبيق آخر)." },
  install_ios_2: { en: "Tap the Share button, the square with an arrow.", ar: "اضغط زر المشاركة، المربع الذي فيه سهم." },
  install_ios_3: { en: "Scroll down and tap “Add to Home Screen”, then Add.", ar: "مرّر للأسفل واضغط «إضافة إلى الشاشة الرئيسية» ثم «إضافة»." },
  install_ios_4: { en: "Open the console from its new icon. Alerts can only be switched on from that icon, not from Safari.", ar: "افتح اللوحة من الأيقونة الجديدة. لا يمكن تفعيل التنبيهات إلا من هذه الأيقونة وليس من سفاري." },
  install_android_h: { en: "Android (Chrome)", ar: "أندرويد (كروم)" },
  install_android_1: { en: "Open the menu (three dots) and tap “Install app” or “Add to Home screen”.", ar: "افتح القائمة (ثلاث نقاط) واضغط «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»." },
  push_h: { en: "Alerts on this phone", ar: "التنبيهات على هذا الهاتف" },
  push_intro: { en: "A short alert when a new high-priority exception appears. It is an extra: the same alert always goes to the ops WhatsApp line and shows in Today.", ar: "تنبيه قصير عند ظهور استثناء عالي الأولوية. هو إضافة فقط: التنبيه نفسه يصل دائماً إلى واتساب العمليات ويظهر في صفحة اليوم." },
  push_enable: { en: "Switch alerts on", ar: "تفعيل التنبيهات" },
  push_disable: { en: "Switch alerts off", ar: "إيقاف التنبيهات" },
  push_on: { en: "Alerts are on for this phone.", ar: "التنبيهات مفعّلة على هذا الهاتف." },
  push_denied: { en: "This browser blocked alerts. Allow them in the browser's site settings, then try again.", ar: "حجب المتصفح التنبيهات. اسمح بها من إعدادات الموقع في المتصفح ثم حاول مرة أخرى." },
  push_unsupported: { en: "This browser cannot show alerts here. On iPhone, add the console to the Home Screen first.", ar: "هذا المتصفح لا يعرض التنبيهات هنا. على آيفون أضف اللوحة إلى الشاشة الرئيسية أولاً." },
  push_test: { en: "Send me a test alert", ar: "أرسل لي تنبيهاً تجريبياً" },
  push_test_note: { en: "Sends one alert to your phones that have alerts switched on, so you know it works before it matters.", ar: "يرسل تنبيهاً واحداً إلى هواتفك المفعّلة، لتتأكد أنه يعمل قبل أن تحتاجه." },
  push_test_sent: { en: "Test alert sent to {n} phone(s). If nothing shows, check the phone's notification settings.", ar: "أُرسل تنبيه تجريبي إلى {n} هاتف. إن لم يظهر شيء فتحقق من إعدادات الإشعارات في الهاتف." },
  push_test_none: { en: "You have no phone with alerts switched on yet. Switch them on above, on the phone itself, then try again.", ar: "ليس لديك هاتف مفعّل للتنبيهات بعد. فعّلها أعلاه من الهاتف نفسه ثم أعد المحاولة." },
  push_not_configured: { en: "Alerts are not set up on the server yet (the VAPID keys are missing).", ar: "لم تُهيّأ التنبيهات على الخادم بعد (مفاتيح VAPID غير موجودة)." },
  push_leads_only: { en: "Alerts are for the ops lead and the admin.", ar: "التنبيهات لمسؤول العمليات والمدير." },
  push_saved: { en: "Alerts are on for this phone.", ar: "تم تفعيل التنبيهات على هذا الهاتف." },
  push_removed: { en: "Alerts are off for this phone.", ar: "تم إيقاف التنبيهات على هذا الهاتف." },
  // Today
  today_title: { en: "Today", ar: "اليوم" },
  inbox_h: { en: "Needs you now", ar: "يحتاج إليك الآن" },
  nothing_needs: { en: "Nothing needs you.", ar: "لا شيء يحتاج إليك." },
  quiet_summary: { en: "All quiet: no open exceptions, no late orders, no rider above the cash cap.", ar: "كل شيء هادئ: لا استثناءات مفتوحة ولا طلبات متأخرة ولا مندوب فوق سقف النقد." },
  high: { en: "high priority", ar: "أولوية عالية" },
  since: { en: "since", ar: "منذ" },
  min: { en: "min", ar: "د" },
  im_on_it: { en: "I'm on it", ar: "أنا أتولى الأمر" },
  resolved: { en: "Resolved", ar: "تم الحل" },
  open_it: { en: "Open", ar: "افتح" },
  being_handled: { en: "being handled", ar: "قيد المعالجة" },
  chats_waiting: { en: "{n} chat(s) waiting for a person", ar: "{n} محادثة بانتظار شخص" },
  at_risk_h: { en: "Orders late or at risk", ar: "طلبات متأخرة أو معرّضة للتأخر" },
  open_orders_h: { en: "Open orders", ar: "الطلبات المفتوحة" },
  riders_h: { en: "Riders on shift", ar: "المناديب في الوردية" },
  drawer_h: { en: "The drawer", ar: "الصندوق" },
  drawer_line: { en: "The books say the drawer holds {amount}.", ar: "الدفاتر تقول إن الصندوق يحتوي {amount}." },
  day_open_link: { en: "Day open checklist", ar: "قائمة فتح اليوم" },
  // Orders
  orders_title: { en: "Orders", ar: "الطلبات" },
  orders_find: { en: "Find", ar: "بحث" },
  orders_ph: { en: "Code, phone or name", ar: "الرمز أو الهاتف أو الاسم" },
  orders_recent: { en: "Latest orders", ar: "آخر الطلبات" },
  orders_found: { en: "{n} found for “{q}”", ar: "{n} نتيجة لـ «{q}»" },
  orders_none: { en: "No order matches.", ar: "لا يوجد طلب مطابق." },
  order_not_found: { en: "That order was not found.", ar: "لم يُعثر على هذا الطلب." },
  customer: { en: "Customer", ar: "الزبون" },
  village: { en: "Village", ar: "القرية" },
  channel: { en: "Channel", ar: "القناة" },
  payment: { en: "Payment", ar: "الدفع" },
  total: { en: "Total", ar: "المجموع" },
  placed: { en: "Placed", ar: "وقت الطلب" },
  lines_h: { en: "Lines and changes", ar: "البنود والتغييرات" },
  timeline_h: { en: "Timeline", ar: "السجل الزمني" },
  messages_h: { en: "Messages around this order", ar: "الرسائل حول هذا الطلب" },
  payments_h: { en: "Payments", ar: "المدفوعات" },
  refunds_h: { en: "Refunds", ar: "المبالغ المستردة" },
  file_h: { en: "Report a language mistake", ar: "الإبلاغ عن خطأ في الفهم" },
  file_intro: { en: "Files one case for the next evaluation round. It changes nothing on the order.", ar: "يسجّل حالة واحدة لجولة التقييم القادمة. لا يغيّر شيئاً في الطلب." },
  wrong_product: { en: "Wrong product", ar: "منتج خاطئ" },
  bot_at_fault: { en: "Bot at fault", ar: "الخطأ من البوت" },
  note_ph: { en: "What went wrong (optional)", ar: "ما الذي حدث (اختياري)" },
} satisfies Record<string, Entry>;

export type Key = keyof typeof D;
export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  const e: Entry = D[key];
  return (e[lang] ?? e.en).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** The page links' words by address, for the pages that were built before D5 (their own section labels stay English otherwise). */
export const NAV_AR: Record<string, string> = {
  "/": "اليوم", "/orders": "الطلبات", "/approvals": "الموافقات الثانية", "/names": "مراجعة الأسماء", "/readiness": "جاهزية المنتجات", "/pictures": "الصور",
  "/food-facts": "المعلومات الغذائية", "/search-words": "كلمات البحث", "/auto-approvals": "الموافقات التلقائية", "/intake": "إدخال الملصقات",
  "/catalog": "الكتالوج", "/receiving": "الاستلام", "/returns": "المرتجعات", "/refunds": "المبالغ المستردة", "/money": "المال", "/payments": "المدفوعات",
  "/fx": "سعر الصرف", "/approve": "الموافقات", "/settings": "الإعدادات", "/zones": "المناطق والرسوم", "/day-open": "فتح اليوم", "/day-close": "إغلاق اليوم", "/exceptions": "الاستثناءات والمحادثات", "/inbox": "الوارد",
  "/riders": "المناديب", "/pick": "قائمة التجهيز", "/rider-jobs": "مهام المناديب", "/rider-incidents": "حوادث المناديب", "/windows": "نوافذ التوصيل", "/cases": "الشكاوى", "/merchants": "المطاعم", "/staff": "الموظفون والصلاحيات", "/templates": "حالة قوالب الرسائل", "/capture": "تصوير الملصقات", "/label-queue": "موافقات الملصقات", "/listings": "أماكن الطعام", "/places": "الأماكن", "/menus": "القوائم",
  "/purchase-orders": "طلبات الشراء", "/bins": "الرفوف", "/temperature": "سجل الحرارة", "/screens": "الشاشات",
};

/** Inline pair for a short string that belongs to one page (a table heading, a status word). The long, shared ones are in the dictionary above. */
export const pick = (lang: Lang, en: string, ar: string) => (lang === "ar" ? ar : en);
