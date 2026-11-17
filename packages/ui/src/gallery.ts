// The gallery: every component of the design system on one page, in the language and theme the viewer is using. Each app serves
// it on staging only (the console at /gallery, the website at /gallery), for the founder's review and for the screenshots every
// pull request attaches. Everything shown is invented: no real order, customer, price or product.
import { Raw, html } from "./h";
import { contrast } from "./contrast";
import { DARK, LIGHT } from "./tokens.generated";
import {
  badge, bell, button, card, cartBar, caseList, caseRow, chips, commandBar, count, crown, dataTable, dialog, drawer, empty, errorState, icon, input, kpiTile, kpis,
  limitBar, loading, orderTimeline, productCard, select, tabs, timerChip, toast,
  factList, factRow, field, ORDER_STATUS_IDS, previewNotice, price, statusLabel, statusPill, stepper,
} from "./components";

export type GalleryLang = "en" | "ar" | "fr";
const W = (l: GalleryLang, en: string, ar: string) => (l === "ar" ? ar : en);

/** The pairs a page really uses: text on its background. AA needs 4.5 for text, 3 for large text and the edge of a control. */
export const CONTRAST_PAIRS: { fg: string; bg: string; min: number; use: string }[] = [
  { fg: "text", bg: "bg", min: 4.5, use: "body text" }, { fg: "text", bg: "surface", min: 4.5, use: "text on a card" }, { fg: "text-2", bg: "surface-2", min: 4.5, use: "table heads" },
  { fg: "muted", bg: "bg", min: 4.5, use: "hints, times" }, { fg: "muted", bg: "surface-2", min: 4.5, use: "hints on a tint" },
  { fg: "accent", bg: "bg", min: 4.5, use: "links" }, { fg: "accent", bg: "surface", min: 4.5, use: "links on a card" }, { fg: "accent", bg: "bg-2", min: 4.5, use: "links on the console's page" }, { fg: "accent", bg: "accent-soft", min: 4.5, use: "the active item" },
  { fg: "on-primary", bg: "primary", min: 4.5, use: "primary button" }, { fg: "ink", bg: "gold", min: 4.5, use: "gold button" }, { fg: "gold", bg: "ink", min: 3, use: "the crown, headings on ink" },
  { fg: "paper", bg: "ink", min: 4.5, use: "the header, the cart bar" },
  { fg: "ok", bg: "ok-bg", min: 4.5, use: "available, done" }, { fg: "ok", bg: "bg", min: 4.5, use: "ok text" }, { fg: "warn", bg: "warn-bg", min: 4.5, use: "amber timers, notices" }, { fg: "warn", bg: "bg", min: 4.5, use: "warning text" },
  { fg: "danger", bg: "danger-bg", min: 4.5, use: "late, failed" }, { fg: "danger", bg: "bg", min: 4.5, use: "error text" }, { fg: "on-status", bg: "danger", min: 4.5, use: "the count badge, late timers" },
  { fg: "line-strong", bg: "bg", min: 3, use: "the edge of a control" }, { fg: "line-strong", bg: "surface", min: 3, use: "the edge of an input" },
  // DS2 (the design reference)
  { fg: "gold-deep", bg: "paper", min: 4.5, use: "gold text on paper" }, { fg: "text", bg: "tint", min: 4.5, use: "the hero band, soft buttons" }, { fg: "accent", bg: "tint", min: 3, use: "the placeholder picture's mark (a drawing, not text)" }, { fg: "accent", bg: "surface-2", min: 3, use: "an icon on the quiet fill (gold text never sits there: 4.29)" },
  { fg: "muted", bg: "tint", min: 4.5, use: "hints on the hero band" }, { fg: "text", bg: "bg-2", min: 4.5, use: "the console's page" }, { fg: "muted", bg: "bg-2", min: 4.5, use: "hints on the console's page" },
  { fg: "on-whatsapp", bg: "whatsapp", min: 4.5, use: "a WhatsApp action" }, { fg: "info", bg: "info-bg", min: 4.5, use: "status: packed" }, { fg: "transit", bg: "transit-bg", min: 4.5, use: "status: on the way" },
  { fg: "warn", bg: "surface", min: 4.5, use: "not confirmed yet" }, { fg: "ink", bg: "paper", min: 4.5, use: "the chosen page in the sidebar" },
];

const swatch = (name: string, hex: string) => html`<li class="ak-swatch"><svg viewBox="0 0 10 4" preserveAspectRatio="none" aria-hidden="true"><rect width="10" height="4" fill="${hex}"/></svg><span><strong>${name}</strong></span><span class="ak-muted"><bdi>${hex}</bdi></span></li>`;

export function gallery(l: GalleryLang, opts: { theme?: "light" | "dark" } = {}): Raw {
  const T = opts.theme === "dark" ? DARK : LIGHT;
  const h = (en: string, ar: string) => html`<h2>${W(l, en, ar)}</h2>`;
  const labels = { inStock: W(l, "In stock", "متوفر"), outOfStock: W(l, "Out of stock", "غير متوفر"), noPicture: W(l, "No picture yet", "لا توجد صورة بعد") };
  return html`
<p class="ak-muted">${W(l, "Every component, from packages/ui. Staging only. Everything shown is invented.", "كل المكوّنات، من packages/ui. للتجربة فقط. كل ما يظهر هنا مُختلَق.")}</p>

${h("The crown", "التاج")}
<div class="ak-demo ak-demo--ink">${crown({ tone: "on-ink", size: 120, label: "Alo King" })}${crown({ tone: "on-ink", size: 64 })}${crown({ tone: "on-ink", size: 32 })}<span>${W(l, "On ink: gold. 120, 64 and 32 px.", "على الحبر: ذهبي. 120 و64 و32 بكسل.")}</span></div>
<div class="ak-demo ak-demo--paper">${crown({ tone: "on-paper", size: 120, label: "Alo King" })}${crown({ tone: "on-paper", size: 64 })}${crown({ tone: "on-paper", size: 32 })}${crown({ tone: "on-ink", size: 64 })}${crown({ tone: "on-ink", size: 32 })}<span>${W(l, "On paper: ink, or the ink tile.", "على الورق: بالحبر، أو على بلاطة الحبر.")}</span></div>
<p><span class="ak-logo">${crown()}<span>${W(l, "Alo King", "ألو كينغ")}</span></span></p>

${h("Colour", "الألوان")}
<ul class="ak-swatches">${["ink", "ink-soft", "paper", "gold", "gold-deep"].map((k) => swatch(k, LIGHT[k]!))}</ul>
<p class="ak-muted ak-small">${W(l, "Roles in this theme:", "الأدوار في هذا المظهر:")}</p>
<ul class="ak-swatches">${["bg", "bg-2", "surface", "surface-2", "tint", "info", "info-bg", "transit", "transit-bg", "whatsapp", "text", "text-2", "muted", "line", "line-strong", "primary", "accent", "accent-soft", "ok", "ok-bg", "warn", "warn-bg", "danger", "danger-bg"].map((k) => swatch(k, T[k]!))}</ul>
${dataTable({ caption: W(l, "Measured contrast", "التباين المقاس"), columns: [{ label: W(l, "Text", "النص") }, { label: W(l, "On", "على") }, { label: W(l, "Used for", "يُستخدم في"), wrap: true }, { label: W(l, "Ratio", "النسبة"), num: true }, { label: W(l, "Needs", "المطلوب"), num: true }, { label: "AA" }],
    rows: CONTRAST_PAIRS.map((p) => { const r = contrast(T[p.fg]!, T[p.bg]!); return { cells: [p.fg, p.bg, p.use, r.toFixed(2), p.min.toFixed(1), r >= p.min ? badge(W(l, "passes", "ناجح"), "ok", "check") : badge(W(l, "fails", "راسب"), "danger")] }; }) })}

${h("Type", "الخط")}
<h1 class="ak-static">${W(l, "Groceries to your door in the Chouf", "البقالة إلى باب بيتك في الشوف")}</h1>
<h2>${W(l, "IBM Plex Sans, weight 600", "IBM Plex Sans Arabic، وزن 600")}</h2>
<p>${W(l, "Body text at 16 px, weight 400. One family for both scripts, served from our own address.", "نص عادي بحجم 16 بكسل ووزن 400. عائلة واحدة للعربية واللاتينية، تُحمَّل من عنواننا.")}</p>
<p lang="${l === "ar" ? "en" : "ar"}" dir="${l === "ar" ? "ltr" : "rtl"}">${l === "ar" ? "The same family in Latin: Labneh 500 g, $3.25." : "العائلة نفسها بالعربية: لبنة 500 غ، $3.25."}</p>
<p class="ak-small ak-muted">${W(l, "Small and muted: prices keep Western digits and $ in every language:", "صغير وخافت: الأسعار تبقى بالأرقام الغربية و$ في كل اللغات:")} <span class="ak-num">$12.50 · 1,250,000 LBP · 09:00–21:00</span></p>

${h("Buttons", "الأزرار")}
<div class="ak-demo">${button({ label: W(l, "Confirm", "تأكيد"), variant: "primary", type: "button" })}${button({ label: W(l, "Secondary", "ثانوي"), type: "button" })}${button({ label: W(l, "Order on WhatsApp", "اطلب عبر واتساب"), variant: "whatsapp", icon: "chat", type: "button" })}${button({ label: W(l, "Soft", "هادئ"), variant: "soft", type: "button" })}${button({ label: W(l, "Link", "رابط"), variant: "ghost", type: "button" })}${button({ label: W(l, "Cancel the order", "إلغاء الطلب"), variant: "danger", type: "button" })}${button({ label: W(l, "Disabled", "معطّل"), type: "button", disabled: true })}${button({ label: W(l, "Add", "أضف"), icon: "plus", iconOnly: true, variant: "primary", type: "button" })}</div>
<div class="ak-demo ak-demo--ink">${button({ label: W(l, "Order on WhatsApp", "اطلب عبر واتساب"), variant: "gold", icon: "chat", type: "button" })}${button({ label: W(l, "Shop here", "تسوّق هنا"), variant: "on-ink", type: "button" })}</div>

${h("Inputs and select", "الحقول والقوائم")}
<div class="ak-filters">${input({ name: "g1", label: W(l, "Search", "بحث"), placeholder: W(l, "Code, phone or name", "الرمز أو الهاتف أو الاسم") })}${select({ name: "g2", label: W(l, "Village", "القرية"), options: [{ value: "", label: W(l, "Any", "الكل") }, { value: "1", label: W(l, "Example village", "قرية مثال") }] })}${input({ name: "g3", label: W(l, "Amount", "المبلغ"), value: "abc", invalid: true })}</div>

<div class="ak-filters">${field({ label: W(l, "Counted cash, USD", "النقد المعدود، دولار"), control: input({ name: "g4", label: W(l, "Counted cash, USD", "النقد المعدود، دولار"), value: "12o", hideLabel: true, invalid: true }), hint: W(l, "What you counted, not what is expected.", "ما عددتَه، لا المتوقَّع."), error: W(l, "Type a number, for example 120.", "اكتب رقماً، مثلاً 120.") })}</div>

${h("Order statuses: one table, staff words and customer words", "حالات الطلب: جدول واحد، كلمات الفريق وكلمات الزبون")}
${dataTable({ caption: W(l, "Order statuses", "حالات الطلب"), columns: [{ label: W(l, "Id in the database", "المعرّف في قاعدة البيانات") }, { label: W(l, "Staff see", "يراه الفريق") }, { label: W(l, "The customer sees", "يراه الزبون") }],
    rows: ORDER_STATUS_IDS.map((id) => ({ cells: [html`<code>${id}</code>`, statusPill(id, { lang: l === "ar" ? "ar" : "en" }), html`${statusPill(id, { audience: "customer", lang: l === "ar" ? "ar" : "en" })}${statusLabel(id, { audience: "customer", pickup: true }) !== statusLabel(id, { audience: "customer" }) ? html` ${statusPill(id, { audience: "customer", pickup: true, lang: l === "ar" ? "ar" : "en" })}` : ""}`] })) })}
<p>${statusPill("cancelled", { lang: l === "ar" ? "ar" : "en", reason: W(l, "the customer asked", "طلب الزبون") })}</p>

${h("Chips, badges, tabs", "الرقاقات والشارات والتبويبات")}
${chips([{ label: W(l, "Latest", "الأحدث"), href: "#", current: true }, { label: W(l, "Open now", "المفتوحة الآن"), href: "#", count: 4 }, { label: W(l, "In stock", "متوفر"), href: "#" }])}
<div class="ak-demo">${badge(W(l, "confirmed", "مؤكد"))}${badge(W(l, "available", "متوفر"), "ok", "check")}${badge(W(l, "delivered, not paid yet", "سُلّم ولم يُدفع بعد"), "warn")}${badge(W(l, "failed delivery", "فشل التوصيل"), "danger")}${badge(W(l, "call back", "طلب اتصالاً"), "gold", "phone")}${count(3)}${count(128)}</div>
${tabs([{ label: W(l, "Needs you now", "يحتاج إليك الآن"), href: "#", current: true, count: 3 }, { label: W(l, "All exceptions", "كل الاستثناءات"), href: "#" }], W(l, "Example tabs", "تبويبات مثال"))}

${h("KPI tiles", "بطاقات المؤشرات")}
${kpis([
    kpiTile({ label: W(l, "Orders", "الطلبات"), value: "42", compare: [{ label: W(l, "vs yesterday, same hours", "عن أمس، بالساعات نفسها"), text: "+6", direction: "up", good: true }, { label: W(l, "vs the same day last week", "عن اليوم نفسه الأسبوع الماضي"), text: "−3", direction: "down", good: false }], trend: [28, 31, 30, 36, 33, 39, 36] }),
    kpiTile({ label: W(l, "Sales, goods only", "المبيعات، البضاعة فقط"), value: "$612.40", compare: [{ label: W(l, "vs yesterday, same hours", "عن أمس، بالساعات نفسها"), text: "+$48.10", direction: "up", good: true }], trend: [410, 455, 440, 520, 505, 590, 564] }),
    kpiTile({ label: W(l, "Average delivery time", "متوسط وقت التوصيل"), value: `31 ${W(l, "min", "د")}`, compare: [{ label: W(l, "vs yesterday, same hours", "عن أمس، بالساعات نفسها"), text: `−4 ${W(l, "min", "د")}`, direction: "down", good: true }], trend: [38, 36, 37, 35, 36, 33, 35] }),
    kpiTile({ label: W(l, "Customers waiting for a person", "زبائن بانتظار شخص"), value: "2", alert: true, note: W(l, "1 late", "1 متأخرة") }),
  ])}

${h("Timer chip and limit bar", "رقاقة المؤقت وشريط الحد")}
<div class="ak-demo">${timerChip({ minutes: 12, promise: 45, text: `12 ${W(l, "min", "د")}` })}${timerChip({ minutes: 38, promise: 45, text: `38 ${W(l, "min", "د")}` })}${timerChip({ minutes: 61, promise: 45, text: `61 ${W(l, "min", "د")} (16 ${W(l, "late", "تأخير")})` })}${timerChip({ minutes: 3, promise: null, text: `3 ${W(l, "min", "د")}` })}</div>
<ul class="riders"><li><span class="row"><strong>${W(l, "Rider one", "المندوب الأول")}</strong><span class="ak-muted">$62.00</span></span>${limitBar({ value: 62, soft: 150, hard: 200, label: "$62.00 / $200.00" })}</li>
<li><span class="row"><strong>${W(l, "Rider two", "المندوب الثاني")}</strong><span class="ak-muted">$164.50</span></span>${limitBar({ value: 164.5, soft: 150, hard: 200, label: "$164.50 / $200.00" })}</li>
<li class="over"><span class="row"><strong>${W(l, "Rider three", "المندوب الثالث")}</strong><span class="ak-muted">$203.00</span></span>${limitBar({ value: 203, soft: 150, hard: 200, label: "$203.00 / $200.00" })}</li></ul>

${h("Data table", "جدول البيانات")}
${dataTable({ caption: W(l, "Example orders", "طلبات مثال"),
    columns: [{ label: W(l, "Order", "الطلب") }, { label: W(l, "Status", "الحالة"), sortHref: "#", sorted: null }, { label: W(l, "Village", "القرية") }, { label: W(l, "Total", "المجموع"), num: true, sortHref: "#", sorted: "descending" }, { label: W(l, "Placed", "وقت الطلب"), sortHref: "#" }],
    rows: [
      { cells: [html`<a href="#"><strong>AK-0001</strong></a>`, badge(W(l, "on the way", "في الطريق")), W(l, "Example village", "قرية مثال"), "$24.75", "15/11, 14:02"], selected: true },
      { cells: [html`<a href="#"><strong>AK-0002</strong></a>`, badge(W(l, "closed", "مُغلق"), "ok"), W(l, "Another village", "قرية أخرى"), "$18.20", "15/11, 13:40"] },
      { cells: [html`<a href="#"><strong>AK-0003</strong></a>`, badge(W(l, "delivered, not paid yet", "سُلّم ولم يُدفع بعد"), "warn"), W(l, "Example village", "قرية مثال"), "$9.90", "15/11, 12:15"] },
    ] })}

${h("Case rows", "صفوف الحالات")}
${caseList([
    caseRow({ href: "#", openLabel: W(l, "Open", "افتح"), state: "late", timer: timerChip({ minutes: 17, promise: null, state: "late", text: `17 ${W(l, "min", "د")}` }), title: W(l, "Complaint · Example customer", "شكوى · زبون مثال"), order: "AK-0003", last: W(l, "Example customer: the milk arrived warm", "زبون مثال: وصل الحليب دافئاً"), tags: [badge(W(l, "nobody yet", "لا أحد بعد"), "warn"), badge(W(l, "late", "متأخرة"), "danger")] }),
    caseRow({ href: "#", openLabel: W(l, "Open", "افتح"), state: "claimed", timer: timerChip({ minutes: 4, promise: null, state: "idle", text: `4 ${W(l, "min", "د")}` }), title: W(l, "Asked for a person · Another customer", "طلب شخصاً · زبون آخر"), last: W(l, "us: A person from our team will answer you.", "نحن: حدا من الفريق رح يجاوبك."), tags: [badge(W(l, "Example lead", "مسؤول مثال"), "ok", "user"), badge(W(l, "call back", "طلب اتصالاً"), "gold", "phone")] }),
  ])}

${h("Order timeline", "السجل الزمني للطلب")}
${orderTimeline([
    { at: "14:02", kind: W(l, "placed", "أُنشئ"), text: "$24.75 · cod", state: "done" }, { at: "14:03", kind: W(l, "status", "الحالة"), text: W(l, "confirmed (customer)", "مؤكد (الزبون)"), state: "done" },
    { at: "14:11", kind: W(l, "status", "الحالة"), text: W(l, "being picked", "قيد التجهيز"), state: "now" }, { kind: W(l, "next", "التالي"), text: W(l, "on the way", "في الطريق"), state: "todo" },
  ])}

${h("Product cards and the cart bar", "بطاقات المنتجات وشريط السلة")}
<ul class="ak-grid">
${productCard({ href: "#", name: W(l, "Example labneh", "لبنة مثال"), meta: W(l, "Example brand · 500 g", "ماركة مثال · 500 غ"), price: "$3.25", unitPrice: { amount: "$6.50", per: W(l, "kg", "كغ") }, inStock: true, picture: null, labels, action: { href: "#", label: W(l, "Order on WhatsApp", "اطلب عبر واتساب"), icon: "chat" } })}
${productCard({ href: "#", name: W(l, "Example bread, a long name that runs over two lines to show the cut", "خبز مثال باسم طويل يمتد على سطرين لإظهار القطع"), meta: W(l, "bundle", "ربطة"), price: "$0.85", inStock: true, picture: null, labels, action: { href: "#", label: W(l, "Add", "أضف"), icon: "plus" } })}
${productCard({ href: "#", name: W(l, "Example olive oil", "زيت زيتون مثال"), meta: W(l, "1 litre", "1 ليتر"), price: "$11.00", inStock: false, picture: null, labels })}
</ul>
<p></p>
${cartBar({ count: 3, total: "$15.10", note: W(l, "Delivery $2.00 · $4.90 more to reach the minimum", "التوصيل $2.00 · باقي $4.90 للحد الأدنى"), progress: { value: 15.1, max: 20, label: W(l, "Progress to the minimum order", "التقدّم نحو الحد الأدنى للطلب") }, cta: { href: "#", label: W(l, "View cart", "عرض السلة") } })}

<p></p>
<form class="ak-demo" method="get" action="#">${stepper({ name: "g-qty", value: 2, labels: { less: W(l, "One less", "واحد أقل"), more: W(l, "One more", "واحد أكثر"), quantity: W(l, "Quantity", "الكمية") } })}${stepper({ name: "g-qty0", value: 0, labels: { less: W(l, "One less", "واحد أقل"), more: W(l, "One more", "واحد أكثر"), quantity: W(l, "Quantity", "الكمية") } })}${price({ amount: "$3.25", unit: { amount: "$6.50", per: W(l, "kg", "كغ") }, big: true })}${price({ amount: "$0.85" })}</form>
<form method="get" action="#">${stepper({ name: "g-qty2", value: 3, big: true, labels: { less: W(l, "One less", "واحد أقل"), more: W(l, "One more", "واحد أكثر"), quantity: W(l, "Quantity", "الكمية") } })}</form>

${h("Facts with their status", "المعلومات مع حالتها")}
${card(factList([
    factRow({ label: W(l, "Contains", "يحتوي على"), value: W(l, "Milk", "حليب"), source: W(l, "from the label photo", "من صورة الملصق"), notConfirmed: W(l, "Not confirmed yet", "لم يُؤكَّد بعد") }),
    factRow({ label: W(l, "Ingredients", "المكوّنات"), value: null, notConfirmed: W(l, "Not confirmed yet", "لم يُؤكَّد بعد") }),
    factRow({ label: W(l, "Storage", "التخزين"), value: null, notConfirmed: W(l, "Not confirmed yet", "لم يُؤكَّد بعد") }),
  ]))}

${h("Preview notice", "إشعار المعاينة")}
${previewNotice(W(l, "STAGING: test data. Nothing here is a real order.", "تجربة: بيانات اختبار. لا شيء هنا طلب حقيقي."))}
<p></p>
${previewNotice(W(l, "Preview: fees and delivery times are placeholders.", "معاينة: الرسوم وأوقات التوصيل مؤقتة."), { tone: "ink" })}

${h("Empty, loading and error", "فارغ، تحميل، خطأ")}
${empty({ ok: true, title: W(l, "Nothing needs you.", "لا شيء يحتاج إليك.") })}
<p></p>
${empty({ title: W(l, "No order matches.", "لا يوجد طلب مطابق."), text: W(l, "Change a filter, or search by code.", "غيّر التصفية أو ابحث بالرمز."), icon: "search" })}
<p></p>
${loading({ label: W(l, "Loading", "جارٍ التحميل"), tiles: 3, rows: 2 })}
${errorState({ title: W(l, "We could not load this page.", "تعذّر تحميل هذه الصفحة."), text: W(l, "Nothing was changed. Try again in a moment.", "لم يتغيّر شيء. حاول مرة أخرى بعد قليل."), action: button({ label: W(l, "Try again", "حاول مرة أخرى"), href: "#" }) })}

${h("Toast, bell, dialog, command bar, drawer", "إشعار، جرس، حوار، شريط الأوامر، درج")}
<div class="ak-demo">${toast({ text: W(l, "Marked resolved.", "تم الحل."), undo: { href: "#", label: W(l, "Undo", "تراجع") } })}${toast({ tone: "err", text: W(l, "Not sent: the 24-hour window is closed.", "لم تُرسل: نافذة 24 ساعة مغلقة.") })}</div>
<div class="ak-demo">${bell({ count: 2, label: W(l, "Alerts", "التنبيهات"), items: [{ label: W(l, "Allergen complaint", "شكوى حساسية"), href: "#", meta: `12 ${W(l, "min", "د")}` }, { label: W(l, "A rider cannot continue", "مندوب لا يستطيع المتابعة"), href: "#", meta: `3 ${W(l, "min", "د")}` }], empty: "", allHref: "#", allLabel: W(l, "All exceptions", "كل الاستثناءات") })}
<span class="ak-muted ak-small">${W(l, "Tap the bell. The command bar opens with Ctrl+K or the search button in the console.", "اضغط الجرس. شريط الأوامر يُفتح بـ Ctrl+K أو زر البحث في اللوحة.")}</span></div>
${card(html`<p>${W(l, "A dialog asks before something that cannot be undone:", "الحوار يسأل قبل ما لا يمكن التراجع عنه:")}</p>${dialog({ id: "g-dialog", open: true, title: W(l, "Cancel this order?", "إلغاء هذا الطلب؟"), body: html`<p>${W(l, "The customer is told, and the stock goes back on the shelf.", "يُبلَّغ الزبون وتعود البضاعة إلى الرف.")}</p>`,
    actions: html`${button({ label: W(l, "Keep it", "أبقِه"), type: "button" })}${button({ label: W(l, "Cancel the order", "إلغاء الطلب"), variant: "danger", type: "button" })}` })}`, { cls: "ak-dialog-demo" })}
<p class="ak-muted ak-small">${W(l, "The drawer is shown on the console's Orders page: open an order on a wide screen.", "الدرج يظهر في صفحة الطلبات في اللوحة: افتح طلباً على شاشة عريضة.")}</p>

${h("Icons", "الأيقونات")}
<div class="ak-demo">${(["home", "inbox", "orders", "approve", "stock", "money", "reports", "settings", "search", "bell", "cart", "chat", "clock", "pin", "truck", "bike", "phone", "check", "warn", "store", "food", "wallet", "shield", "user", "dispatch", "camera", "pick", "undo", "hourglass", "basket"] as const).map((n) => icon(n))}<span class="ak-muted ak-small">Lucide</span></div>`;
}
export { commandBar, drawer };
