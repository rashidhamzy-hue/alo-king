// WhatsApp messages to merchants and their drivers (DECISIONS §23, §27.3, §29.4, §30.1.4, §30.2).
// Pure builders: they take the server's order summary (`order_card_payload`) and return Cloud API payloads.
// Every interactive builder is checked against Meta's limits in meta-limits.test.ts. Button ids carry the
// action and the record id; the server re-checks everything a tap claims.
//
// The order card never carries the customer's phone or exact address (§23): code, items, note, broad
// area, payment in USD and LBP at the locked rate, and the buttons.

export type Lang = "ar" | "en";

export type OrderCardData = {
  order_id: string;
  code: string;
  fulfilment: "delivery" | "pickup";
  payment_method: "cod" | "whish" | "tap";
  total_usd: number | string;
  total_lbp: number | string;
  usd_lbp_rate: number | string;
  estimated?: boolean;
  is_new_customer?: boolean;
  customer_note?: string | null;
  area_ar?: string | null;
  area_en?: string | null;
  items: {
    name: string;
    name_en?: string | null;
    quantity: number;
    options?: string[];
    kg?: number | string | null;
    has_empty?: boolean | null;
    note?: string | null;
  }[];
};

const envelope = (to: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to.replace(/^\+/, ""),
});
const usd = (v: number | string) => `$${Number(v).toFixed(2)}`;
const lbp = (v: number | string) => Math.round(Number(v)).toLocaleString("en-US");

const T = {
  ar: {
    newOrder: "🔔 طلب جديد",
    pickup: "استلام من المحل",
    delivery: "توصيل",
    cash: "كاش عند التسليم",
    online: "مدفوع أونلاين",
    rate: "سعر الصرف",
    locked: "مقفل على الطلب",
    newCustomer: "🆕 زبون جديد",
    note: "ملاحظة",
    area: "المنطقة",
    estimated: "⚖️ تقريبي، السعر النهائي حسب الوزن",
    empty: "♻️ عنده فارغ للتبديل",
    noEmpty: "➕ بدون فارغ (تأمين)",
    accept: "✅ قبول",
    reject: "❌ رفض",
    min: "د",
    rejectAsk: "ليش رفضت الطلب؟",
    reasons: "الأسباب",
    busy: "مشغولين كتير",
    item_unavailable: "صنف مش متوفر",
    closed: "مسكرين",
    area_unavailable: "ما منوصل لهونيك",
    menu_or_price_issue: "سعر أو منيو غلط",
    other: "سبب تاني",
    readyAsk: "الطلب لازم يكون جاهز. جاهز هلق أو بعد قديش؟",
    ready: "✅ جاهز",
    needDriver: "الطلب جاهز وما في سائق. شو بتعمل؟",
    outForDelivery: "🛵 طلع للتوصيل",
    wantDriver: "🙋 بدي سائق",
    lowStock: "قرب يخلص",
    left: "باقي",
    soldOut: "خلص",
    paused: "توقف استقبال الطلبات تلقائياً بعد",
    missed: "طلبات ما انردّ عليها",
    reactivate: "🟢 رجعني شغّال",
    confirm: "✅ أكّد",
    cancel: "✖️ لا",
    cancelled: "❌ انلغى الطلب",
    jobTitle: "🛵 مشوار جديد",
    jobSteps: "١. استلم الطلب\n٢. شارك موقعك المباشر مع الزبون (ساعة)\n٣. سلّم واكبس «تم التسليم»",
    shareLive: "📍 شارك موقعي",
    pickedUp: "📦 استلمت",
    delivered: "✅ تم التسليم",
  },
  en: {
    newOrder: "🔔 New order",
    pickup: "Pickup",
    delivery: "Delivery",
    cash: "Cash on delivery",
    online: "Paid online",
    rate: "rate",
    locked: "locked at order",
    newCustomer: "🆕 New customer",
    note: "Note",
    area: "Area",
    estimated: "⚖️ Estimate, final price by weight",
    empty: "♻️ Has an empty to swap",
    noEmpty: "➕ No empty (deposit)",
    accept: "✅ Accept",
    reject: "❌ Reject",
    min: "min",
    rejectAsk: "Why are you rejecting this order?",
    reasons: "Reasons",
    busy: "Too busy",
    item_unavailable: "Item unavailable",
    closed: "We are closed",
    area_unavailable: "We don't deliver there",
    menu_or_price_issue: "Menu or price wrong",
    other: "Other reason",
    readyAsk: "This order should be ready. Ready now, or in how long?",
    ready: "✅ Ready",
    needDriver: "The order is ready and has no driver. What now?",
    outForDelivery: "🛵 Out for delivery",
    wantDriver: "🙋 Need a driver",
    lowStock: "Almost sold out",
    left: "left",
    soldOut: "Sold out",
    paused: "Orders paused automatically after",
    missed: "missed orders in a row",
    reactivate: "🟢 Reactivate",
    confirm: "✅ Confirm",
    cancel: "✖️ No",
    cancelled: "❌ Order cancelled",
    jobTitle: "🛵 New delivery",
    jobSteps:
      "1. Pick up the order\n2. Share your live location with the customer (1 hour)\n3. Hand over, tap Delivered",
    shareLive: "📍 Share location",
    pickedUp: "📦 Picked up",
    delivered: "✅ Delivered",
  },
} as const;

export const REJECT_REASONS = [
  "busy",
  "item_unavailable",
  "closed",
  "area_unavailable",
  "menu_or_price_issue",
  "other",
] as const;

/** Money line shown on every card: both totals and the locked rate (§13). */
export function moneyLine(
  d: Pick<OrderCardData, "payment_method" | "total_usd" | "total_lbp" | "usd_lbp_rate">,
  lang: Lang,
): string {
  const t = T[lang];
  const how = d.payment_method === "cod" ? t.cash : t.online;
  return `${how}: ${usd(d.total_usd)} = ${lbp(d.total_lbp)} LBP (${t.rate} ${lbp(d.usd_lbp_rate)}, ${t.locked})`;
}

export function orderCard(to: string, d: OrderCardData, lang: Lang = "ar") {
  const t = T[lang];
  const lines: string[] = [];
  for (const i of d.items) {
    const name = lang === "en" ? (i.name_en ?? i.name) : i.name;
    const opts = i.options?.length ? ` (${i.options.join("، ")})` : "";
    const kg = i.kg ? ` ~${Number(i.kg)} kg` : "";
    const empty =
      i.has_empty === true ? ` ${t.empty}` : i.has_empty === false ? ` ${t.noEmpty}` : "";
    lines.push(`${i.quantity}× ${name}${opts}${kg}${empty}${i.note ? ` · ${i.note}` : ""}`);
  }
  const area = lang === "en" ? (d.area_en ?? d.area_ar) : (d.area_ar ?? d.area_en);
  const len = (x: string) => [...x].length;
  const clip = (x: string, n: number) => (len(x) > n ? [...x].slice(0, n - 1).join("") + "…" : x);
  const head = `${d.fulfilment === "pickup" ? t.pickup : t.delivery}${area ? ` · ${t.area}: ${area}` : ""}`;
  // The money line and flags always fit; items fill the rest, then "+N more" (the portal has them all).
  const tail = [
    d.customer_note ? `${t.note}: ${clip(d.customer_note, 200)}` : "",
    moneyLine(d, lang),
    d.estimated ? t.estimated : "",
    d.is_new_customer ? t.newCustomer : "",
  ]
    .filter(Boolean)
    .join("\n");
  const budget = 1024 - len(head) - len(tail) - 40;
  const shown: string[] = [];
  let used = 0;
  for (const [k, l] of lines.entries()) {
    const line = clip(l, 120);
    if (used + len(line) + 1 > budget) {
      shown.push(
        lang === "en" ? `+${lines.length - k} more items` : `+${lines.length - k} أصناف أخرى`,
      );
      break;
    }
    shown.push(line);
    used += len(line) + 1;
  }
  const body = [head, "", ...shown, "", tail].join("\n").trim();
  return {
    ...envelope(to),
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: `${t.newOrder} #${d.code}` },
      body: { text: body },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: `acc:${d.order_id}:15`, title: `${t.accept} 15 ${t.min}` },
          },
          {
            type: "reply",
            reply: { id: `acc:${d.order_id}:30`, title: `${t.accept} 30 ${t.min}` },
          },
          { type: "reply", reply: { id: `rej:${d.order_id}`, title: t.reject } },
        ],
      },
    },
  };
}

export function rejectReasonList(to: string, orderId: string, code: string, lang: Lang = "ar") {
  const t = T[lang];
  return {
    ...envelope(to),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: code ? `#${code} · ${t.rejectAsk}` : t.rejectAsk },
      action: {
        button: t.reasons,
        sections: [
          {
            title: t.reasons,
            rows: REJECT_REASONS.map((r) => ({ id: `rjr:${orderId}:${r}`, title: t[r] })),
          },
        ],
      },
    },
  };
}

export function readyCheckCard(to: string, orderId: string, code: string, lang: Lang = "ar") {
  const t = T[lang];
  return buttons(to, `#${code} · ${t.readyAsk}`, [
    [`rdy:${orderId}`, t.ready],
    [`rin:${orderId}:10`, `⏱ 10 ${t.min}`],
    [`rin:${orderId}:20`, `⏱ 20 ${t.min}`],
  ]);
}

export function needDriverCard(to: string, orderId: string, code: string, lang: Lang = "ar") {
  const t = T[lang];
  return buttons(to, `#${code} · ${t.needDriver}`, [
    [`out:${orderId}`, t.outForDelivery],
    [`ndr:${orderId}`, t.wantDriver],
  ]);
}

export function lowStockCard(
  to: string,
  itemId: string,
  itemName: string,
  remaining: number,
  lang: Lang = "ar",
) {
  const t = T[lang];
  return buttons(to, `⚠️ ${itemName}: ${t.lowStock} (${remaining} ${t.left})`, [
    [`stk:${itemId}:10`, "+10"],
    [`stk:${itemId}:20`, "+20"],
    [`sld:${itemId}`, t.soldOut],
  ]);
}

export function reactivateCard(to: string, vendorId: string, missed: number, lang: Lang = "ar") {
  const t = T[lang];
  return buttons(to, `⏸ ${t.paused} ${missed} ${t.missed}.`, [[`rea:${vendorId}`, t.reactivate]]);
}

export function proposalCard(to: string, proposalId: string, summary: string, lang: Lang = "ar") {
  const t = T[lang];
  return buttons(to, summary, [
    [`pyes:${proposalId}`, t.confirm],
    [`pno:${proposalId}`, t.cancel],
  ]);
}

export function cancelledText(to: string, code: string, lang: Lang = "ar") {
  return { ...envelope(to), type: "text", text: { body: `${T[lang].cancelled} #${code}` } };
}

export function textMessage(to: string, body: string) {
  return { ...envelope(to), type: "text", text: { body } };
}

/**
 * Driver job card for a merchant driver without the app (§27.2, §27.3): the steps including the live-share
 * step, a link that opens the customer's chat with a greeting, then status buttons. Two messages.
 */
export function driverJobCard(
  to: string,
  d: OrderCardData,
  customerPhone: string,
  driverName: string,
  vendorName: string,
  lang: Lang = "ar",
) {
  const t = T[lang];
  const greet =
    lang === "en"
      ? `Hi, I'm ${driverName} from Alo King with your order from ${vendorName}`
      : `مرحبا، أنا ${driverName} من ألو كينغ، معي طلبك من ${vendorName}`;
  const area = lang === "en" ? (d.area_en ?? d.area_ar) : (d.area_ar ?? d.area_en);
  const link = {
    ...envelope(to),
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: { type: "text", text: `${t.jobTitle} #${d.code}` },
      body: {
        text: [area ? `${t.area}: ${area}` : "", moneyLine(d, lang), "", t.jobSteps]
          .filter(Boolean)
          .join("\n"),
      },
      action: {
        name: "cta_url",
        parameters: {
          display_text: t.shareLive,
          url: `https://wa.me/${customerPhone.replace(/^\+/, "")}?text=${encodeURIComponent(greet)}`,
        },
      },
    },
  };
  const status = buttons(to, `#${d.code}`, [
    [`pku:${d.order_id}`, t.pickedUp],
    [`dlv:${d.order_id}`, t.delivered],
  ]);
  return [link, status];
}

function buttons(to: string, body: string, list: [string, string][]) {
  return {
    ...envelope(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: list.map(([id, title]) => ({ type: "reply", reply: { id, title } })) },
    },
  };
}

/** Parses a button or list id from these cards. Unknown ids return null. */
export type MerchantAction =
  | { a: "accept"; orderId: string; prep: number }
  | { a: "reject_ask"; orderId: string }
  | { a: "reject"; orderId: string; reason: (typeof REJECT_REASONS)[number] }
  | { a: "ready"; orderId: string }
  | { a: "ready_in"; orderId: string; minutes: number }
  | { a: "out"; orderId: string }
  | { a: "need_driver"; orderId: string }
  | { a: "stock_add"; itemId: string; add: number }
  | { a: "sold_out"; itemId: string }
  | { a: "reactivate"; vendorId: string }
  | { a: "proposal"; proposalId: string; confirm: boolean }
  | { a: "picked_up"; orderId: string }
  | { a: "delivered"; orderId: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function parseMerchantAction(id: string): MerchantAction | null {
  const m = id.match(new RegExp(`^([a-z]+):(${UUID})(?::([a-z_0-9]+))?$`));
  if (!m) return null;
  const [, k, ref, arg] = m;
  const n = arg !== undefined && /^\d{1,3}$/.test(arg) ? Number(arg) : null;
  switch (k) {
    case "acc":
      return n !== null && n >= 1 && n <= 240 ? { a: "accept", orderId: ref, prep: n } : null;
    case "rej":
      return arg === undefined ? { a: "reject_ask", orderId: ref } : null;
    case "rjr":
      return (REJECT_REASONS as readonly string[]).includes(arg ?? "")
        ? { a: "reject", orderId: ref, reason: arg as (typeof REJECT_REASONS)[number] }
        : null;
    case "rdy":
      return { a: "ready", orderId: ref };
    case "rin":
      return n !== null && n >= 1 && n <= 120 ? { a: "ready_in", orderId: ref, minutes: n } : null;
    case "out":
      return { a: "out", orderId: ref };
    case "ndr":
      return { a: "need_driver", orderId: ref };
    case "stk":
      return n !== null && n >= 1 && n <= 100 ? { a: "stock_add", itemId: ref, add: n } : null;
    case "sld":
      return { a: "sold_out", itemId: ref };
    case "rea":
      return { a: "reactivate", vendorId: ref };
    case "pyes":
      return { a: "proposal", proposalId: ref, confirm: true };
    case "pno":
      return { a: "proposal", proposalId: ref, confirm: false };
    case "pku":
      return { a: "picked_up", orderId: ref };
    case "dlv":
      return { a: "delivered", orderId: ref };
    default:
      return null;
  }
}
