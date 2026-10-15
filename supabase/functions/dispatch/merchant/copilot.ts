// The merchant copilot (DECISIONS §39.7) on the Merchant number: availability by station, section or item (back on
// its own), stock, items, offers, hours and closures, minimum order, own-delivery radius, Boost budgets, staff, reports
// and the shop's memory. The rules read the merchant's words (merchant-commands.ts); with ai_merchant_text_enabled the
// model reads what the rules do not, through the same typed commands. Every change to price, availability or money is
// a proposal card the merchant confirms with a tap; reports, staff and memory only read.

import {
  beirutClock,
  normalize,
  type CopilotCommand,
  type MerchantCommand,
  type OfferSpec,
  type Station,
} from "../../_shared/merchant-commands.ts";
import { isMedicineRequest } from "../customer/intents.ts";

export type CopilotCtx = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  member: { member_id: string; vendor_id: string; role?: string };
  now: Date;
  reply: (b: string | Record<string, unknown>) => Promise<any>;
  /** Creates the proposal and sends its card; errors are answered there. */
  propose: (kind: string, payload: Record<string, unknown>, summary: string) => Promise<any>;
  /** The one menu item the words name, or null when none or several match. */
  item: (q: string) => Promise<{ item_id: string; name: string } | null>;
};

const STATION_AR: Record<Station, string> = {
  fryer: "القلاية",
  oven: "الفرن",
  grill: "المنقل",
  saj: "الصاج",
  espresso: "ماكينة القهوة",
  cold: "القسم البارد",
  bar: "البار",
};
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export const COPILOT_HELP = [
  "🤖 شو فيني ساعدك / What I can do (every change waits for your tap):",
  "• «القلاية مطفاية ربع ساعة» / «fryer off 15 min» · «grill back»",
  "• «sandwiches off 1h» · «خلصت الكنافة» · «knefe back»",
  "• «مخزون الرز 20» / «stock rice 20»",
  "• «زيد صنف فلافل 4.5» / «add item falafel wrap 4.5» · «rename X to Y» · «remove item X»",
  "• «سعر الكنافة 3.5» / «price knefe 3.5»",
  "• «خصم 10% على السندويشات» · «happy hour 20% 3pm-6pm» · «first order 15%» · «stop offer»",
  "• «مسكرين بكرا» / «closed tomorrow» · «hours mon-fri 9-23» · «closed every sunday»",
  "• «min order 10» · «radius 3 km» · «boost 20 nearby» · «stop boost»",
  "• «تقرير» / «report» · «week» · «staff» · «شو بتتذكر» / «what do you remember»",
  "• «menu» then photos, a PDF, a link or pasted text",
].join("\n");

const hhmm = (d: Date) => {
  const c = beirutClock(d);
  return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const days = (wd: number[]) =>
  wd.length === 7
    ? { ar: "كل يوم", en: "every day" }
    : { ar: wd.map((d) => WEEKDAY_AR[d]).join("، "), en: wd.map((d) => WEEKDAY[d]).join(", ") };

/** A section of this branch named by the words (exact, or one containing the other), else null. */
async function section(ctx: CopilotCtx, q: string) {
  const parts = await ctx.rpc("merchant_menu_parts", {
    p_vendor_id: ctx.member.vendor_id,
    p_member_id: ctx.member.member_id,
  });
  // "sandwichs", "sandwiches" and "Sandwich" are the same section; so are "السندويشات" and "سندويش".
  const key = (x: string) =>
    normalize(x)
      .replace(/^ال(?=\S)/, "")
      .replace(/(?:es|s|ات)$/, "");
  const n = key(q);
  const hits = ((parts?.sections ?? []) as any[]).filter((s) =>
    [s.name_en, s.name_ar].some((x: string | null) => {
      if (!x) return false;
      const v = key(x);
      return v === n || (n.length >= 4 && (v.startsWith(n) || n.startsWith(v)));
    }),
  );
  return hits.length === 1
    ? (hits[0] as { section_id: string; name_ar: string; name_en: string })
    : null;
}

const notFound = (ctx: CopilotCtx, q: string) =>
  ctx.reply(`ما لقيت «${q}» بالمنيو. اكتب الاسم متل ما هو بالمنيو. / “${q}” isn't on your menu.`);

/** The thing "X off" names: a station, else a section, else one item. */
async function availabilityTarget(ctx: CopilotCtx, target: string, station: Station | null) {
  if (station)
    return { scope: "station", target: station, label: { ar: STATION_AR[station], en: station } };
  const s = await section(ctx, target);
  if (s)
    return {
      scope: "section",
      target: s.section_id,
      label: { ar: s.name_ar ?? s.name_en, en: s.name_en ?? s.name_ar },
    };
  const it = await ctx.item(target);
  if (it) return { scope: "item", target: it.item_id, label: { ar: it.name, en: it.name } };
  return null;
}

async function offerPayload(ctx: CopilotCtx, o: OfferSpec) {
  const scope = async (target: string | null) => {
    if (!target) return { payload: {}, label: { ar: "كل المنيو", en: "the whole menu" } };
    const s = await section(ctx, target);
    if (s)
      return {
        payload: { section_id: s.section_id },
        label: { ar: s.name_ar ?? s.name_en, en: s.name_en ?? s.name_ar },
      };
    const it = await ctx.item(target);
    if (it) return { payload: { item_ids: [it.item_id] }, label: { ar: it.name, en: it.name } };
    return null;
  };
  switch (o.type) {
    case "percent": {
      const sc = await scope(o.target);
      if (!sc) return null;
      return {
        payload: { kind: "percent", percent: o.percent, days: o.days, ...sc.payload },
        summary: `🏷️ خصم ${o.percent}% على ${sc.label.ar} لمدة ${o.days} يوم؟ الخصم من حسابك. / ${o.percent}% off ${sc.label.en} for ${o.days} days? You fund the discount.`,
      };
    }
    case "happy_hour": {
      const sc = await scope(o.target);
      if (!sc) return null;
      return {
        payload: {
          kind: "happy_hour",
          percent: o.percent,
          from: o.from,
          to: o.to,
          days: o.days,
          ...sc.payload,
        },
        summary: `🏷️ هابي آور: ${o.percent}% على ${sc.label.ar} من ${o.from} لـ ${o.to}، ${o.days} يوم؟ / Happy hour: ${o.percent}% off ${sc.label.en} ${o.from}-${o.to} for ${o.days} days?`,
      };
    }
    case "first_order":
      return {
        payload: { kind: "first_order", percent: o.percent, days: o.days },
        summary: `🏷️ ${o.percent}% على أول طلب من محلك لكل زبون (${o.days} يوم)؟ / ${o.percent}% off a customer's first order from you (${o.days} days)?`,
      };
    case "free_item": {
      const free = await ctx.item(o.free);
      const sc = await scope(o.target);
      if (!free || !sc || !("item_ids" in sc.payload || "section_id" in sc.payload)) return null;
      return {
        payload: {
          kind: "free_item",
          free_item_id: free.item_id,
          min_quantity: o.minQuantity,
          days: o.days,
          ...sc.payload,
        },
        summary: `🎁 «${free.name}» ببلاش مع ${o.minQuantity} ${sc.label.ar}، ${o.days} يوم؟ / Free “${free.name}” with ${o.minQuantity} ${sc.label.en} for ${o.days} days?`,
      };
    }
  }
}

/** Runs one copilot command. Returns false for commands that are not the copilot's (the caller handles them). */
export async function runCopilot(ctx: CopilotCtx, cmd: MerchantCommand): Promise<boolean> {
  const c = cmd as CopilotCommand;
  const vendor = ctx.member.vendor_id;
  const memberId = ctx.member.member_id;
  // "<section> back" switches a section back on (the item rule below would find one item at most).
  if (cmd.kind === "back_in_stock") {
    const s = await section(ctx, cmd.item);
    if (!s) return false;
    await ctx.propose(
      "availability_on",
      { scope: "section", target: s.section_id },
      `▶️ «${s.name_ar ?? s.name_en}» رجع؟ منرجّع أصنافو. / “${s.name_en ?? s.name_ar}” back on? Its items come back.`,
    );
    return true;
  }
  switch (c.kind) {
    case "help":
      await ctx.reply(COPILOT_HELP);
      return true;
    case "avail_off": {
      const t = await availabilityTarget(ctx, c.target, c.station);
      if (!t) {
        await notFound(ctx, c.target);
        return true;
      }
      const until = c.minutes ? new Date(ctx.now.getTime() + c.minutes * 60_000) : null;
      await ctx.propose(
        "availability_off",
        { scope: t.scope, target: t.target, until: until?.toISOString() ?? null },
        until
          ? `⏸ ${t.label.ar} متوقّف ${c.minutes} دقيقة؟ برجع لحالو الساعة ${hhmm(until)}. / ${t.label.en} off for ${c.minutes} min? Back on its own at ${hhmm(until)}.`
          : `⏸ ${t.label.ar} متوقّف لحد ما ترجّعو؟ / ${t.label.en} off until you switch it back on?`,
      );
      return true;
    }
    case "avail_on":
      await ctx.propose(
        "availability_on",
        { scope: "station", target: c.station },
        `▶️ ${STATION_AR[c.station]} رجع يشتغل؟ منرجّع أصنافو. / ${c.station} working again? Its items come back.`,
      );
      return true;
    case "stock_set": {
      const it = await ctx.item(c.item);
      if (!it) {
        await notFound(ctx, c.item);
        return true;
      }
      await ctx.propose(
        "stock_set",
        { item_id: it.item_id, quantity: c.quantity },
        `📦 مخزون «${it.name}» يصير ${c.quantity}؟ (الباقي بينتقل لتاني يوم) / Stock of “${it.name}” = ${c.quantity}? (what's left carries over)`,
      );
      return true;
    }
    case "item_add":
      // Never medicines (§38.3, the ban of 2 June 2026), whatever the shop.
      if (isMedicineRequest(c.name)) {
        await ctx.reply("💊 ما منبيع أدوية على Alo King. / Medicines can't be sold on Alo King.");
        return true;
      }
      await ctx.propose(
        "item_add",
        { name: c.name, price_usd: c.priceUsd, section: c.section },
        `➕ صنف جديد «${c.name}» بـ ${usd(c.priceUsd)}${c.section ? ` بـ «${c.section}»` : ""}؟ / Add “${c.name}” at ${usd(c.priceUsd)}${c.section ? ` in “${c.section}”` : ""}?`,
      );
      return true;
    case "item_rename":
    case "item_describe":
    case "item_station":
    case "item_remove": {
      const it = await ctx.item(c.item);
      if (!it) {
        await notFound(ctx, c.item);
        return true;
      }
      if (c.kind === "item_remove")
        await ctx.propose(
          "item_remove",
          { item_id: it.item_id },
          `🗑️ نشيل «${it.name}» من المنيو؟ (بيضل بالطلبات القديمة) / Remove “${it.name}” from the menu? (old orders keep it)`,
        );
      else if (c.kind === "item_rename")
        await ctx.propose(
          "item_edit",
          { item_id: it.item_id, name: c.name },
          `✏️ «${it.name}» يصير اسمو «${c.name}»؟ / Rename “${it.name}” to “${c.name}”?`,
        );
      else if (c.kind === "item_describe")
        await ctx.propose(
          "item_edit",
          { item_id: it.item_id, description: c.description },
          `✏️ وصف «${it.name}»: ${c.description.slice(0, 200)}؟ / Description of “${it.name}”?`,
        );
      else
        await ctx.propose(
          "item_edit",
          { item_id: it.item_id, station: c.station },
          `🍳 «${it.name}» من ${STATION_AR[c.station]}؟ (بيتوقف معو) / “${it.name}” comes from the ${c.station}? (off when it is)`,
        );
      return true;
    }
    case "offer": {
      const o = await offerPayload(ctx, c.offer);
      if (!o) {
        await ctx.reply(
          "ما عرفت على أي صنف أو قسم العرض. اكتب الاسم متل ما هو بالمنيو. / Which item or section is the offer on? Use the name on your menu.",
        );
        return true;
      }
      await ctx.propose("offer_create", o.payload, o.summary);
      return true;
    }
    case "offer_stop":
      await ctx.propose("offer_stop", {}, "🛑 نوقّف العرض؟ / Stop the running offer?");
      return true;
    case "closure": {
      const d = new Date(`${c.day}T12:00:00Z`);
      await ctx.propose(
        "closure",
        { day: c.day },
        `🚪 مسكّرين ${WEEKDAY_AR[d.getUTCDay()]} ${c.day}؟ ما في طلبات هالنهار. / Closed on ${WEEKDAY[d.getUTCDay()]} ${c.day}? No orders that day.`,
      );
      return true;
    }
    case "hours": {
      const dd = days(c.weekdays);
      await ctx.propose(
        "hours_set",
        c.opens && c.closes
          ? { weekdays: c.weekdays, opens: c.opens, closes: c.closes }
          : { weekdays: c.weekdays, closed: true },
        c.opens && c.closes
          ? `🕘 الدوام ${dd.ar}: ${c.opens} لـ ${c.closes}؟ / Hours ${dd.en}: ${c.opens}-${c.closes}?`
          : `🚪 مسكّرين كل ${dd.ar}؟ / Closed every ${dd.en}?`,
      );
      return true;
    }
    case "min_order":
      await ctx.propose(
        "min_order",
        { usd: c.usd },
        c.usd === null
          ? "🧾 نشيل الحد الأدنى للطلب؟ / Remove the minimum order?"
          : `🧾 الحد الأدنى للطلب ${usd(c.usd)} (قبل التوصيل)؟ / Minimum order ${usd(c.usd)} (food, before delivery)?`,
      );
      return true;
    case "radius":
      await ctx.propose(
        "radius",
        { km: c.km },
        `📍 بتوصّل لـ ${c.km} كم؟ / You deliver up to ${c.km} km?`,
      );
      return true;
    case "boost":
      await ctx.propose(
        "boost_start",
        { budget_usd: c.budgetUsd, audience: c.audience, kind: "sponsored" },
        `🚀 بوست بميزانية ${usd(c.budgetUsd)} (${c.audience === "nearby" ? "زباين قراب" : "زبايني"})؟ ما منسحب شي قبل ما يبلّش الإعلان. / Boost with a ${usd(c.budgetUsd)} budget (${c.audience === "nearby" ? "people nearby" : "past customers"})? Nothing is charged until sponsored placement starts.`,
      );
      return true;
    case "boost_stop":
      await ctx.propose("boost_stop", {}, "🛑 نوقّف البوست؟ / Stop the Boost?");
      return true;
    case "report": {
      let r: any;
      try {
        r = await ctx.rpc("merchant_report", {
          p_vendor_id: vendor,
          p_member_id: memberId,
          p_period: c.period,
        });
      } catch {
        await ctx.reply(
          "📊 التقرير لصاحب المحل أو المدير. / Reports are for the owner or a manager.",
        );
        return true;
      }
      await ctx.reply(reportText(r));
      return true;
    }
    case "staff_list": {
      let rows: any[];
      try {
        rows =
          (await ctx.rpc("vendor_staff_list", { p_vendor_id: vendor, p_member_id: memberId })) ??
          [];
      } catch {
        await ctx.reply(
          "👤 لائحة الموظفين لصاحب المحل أو المدير. / The staff list is for the owner or a manager.",
        );
        return true;
      }
      await ctx.reply(
        [
          "👤 الفريق / Staff:",
          ...rows.map((s) => `• ${s.name || "—"} · ${s.role} · ${s.phone}`),
        ].join("\n") + "\n\n«add Ali as kitchen +961…» · «remove Ali»",
      );
      return true;
    }
    case "memory": {
      let r: any;
      try {
        r = await ctx.rpc("merchant_memory", { p_vendor_id: vendor, p_member_id: memberId });
      } catch {
        await ctx.reply("🧠 هيدي لصاحب المحل أو المدير. / This is for the owner or a manager.");
        return true;
      }
      await ctx.reply(memoryText(r));
      return true;
    }
    default:
      return false;
  }
}

export function reportText(r: any): string {
  const week = r?.period === "week";
  const top = ((r?.top_items ?? []) as any[]).map((t) => `${t.name} ×${t.quantity}`).join("، ");
  const acc =
    r?.acceptance_median_s == null ? "–" : `${Math.round(Number(r.acceptance_median_s))} s`;
  return [
    week ? "📊 آخر ٧ أيام / Last 7 days" : "📊 اليوم / Today",
    `• طلبات / orders: ${r?.orders ?? 0} (وصل / delivered ${r?.delivered ?? 0}، رفض / rejected ${r?.rejected ?? 0}، إلغاء / cancelled ${r?.cancelled ?? 0})`,
    `• مبيعات الأكل / food sales: ${usd(Number(r?.food_sales_usd ?? 0))}${Number(r?.offers_usd ?? 0) > 0 ? ` (عروض / offers −${usd(Number(r.offers_usd))})` : ""}`,
    `• عمولة / order fees: ${usd(Number(r?.order_fees_usd ?? 0))}`,
    `• سرعة القبول / acceptance: ${acc}`,
    `• تقييم / rating: ${r?.rating_avg ?? "–"} (${r?.ratings ?? 0})`,
    ...(top ? [`• الأكثر طلباً / top: ${top}`] : []),
  ].join("\n");
}

export function memoryText(r: any): string {
  const f = r?.facts ?? {};
  const v = (k: string) => f[k]?.value;
  const parts = r?.parts ?? {};
  const lines = ["🧠 شو بعرف عن محلك / What I know about your shop:"];
  if (v("writes_in")) lines.push(`• بتكتبلي / you write in: ${v("writes_in")}`);
  if ((r?.sellout_names ?? []).length)
    lines.push(`• عادةً بيخلص / usually sells out: ${(r.sellout_names as string[]).join("، ")}`);
  const closed = v("usual_closed_weekdays");
  if (Array.isArray(closed) && closed.length)
    lines.push(
      `• عادةً مسكّرين / usually closed: ${closed.map((d: number) => WEEKDAY[d]).join(", ")}`,
    );
  if (v("acceptance_median_s") != null)
    lines.push(
      `• سرعة القبول / acceptance (28 days): ${Math.round(Number(v("acceptance_median_s")))} s`,
    );
  if (v("quiet_weekday") != null)
    lines.push(`• أهدى يوم / quietest day: ${WEEKDAY[Number(v("quiet_weekday"))]}`);
  if (parts.min_order_usd != null)
    lines.push(`• الحد الأدنى / minimum order: ${usd(Number(parts.min_order_usd))}`);
  if (parts.radius_km != null) lines.push(`• التوصيل / delivery radius: ${parts.radius_km} km`);
  for (const o of (parts.offers ?? []) as any[])
    lines.push(
      `• عرض / offer: ${o.kind}${o.percent ? ` ${Number(o.percent)}%` : ""} → ${String(o.ends_at).slice(0, 10)}`,
    );
  for (const h of (parts.holds ?? []) as any[])
    lines.push(
      `• متوقف / off: ${h.scope} ${h.scope === "station" ? h.target : ""} → ${hhmm(new Date(h.until))}`,
    );
  const changes = (v("recent_changes") ?? []) as any[];
  if (changes.length)
    lines.push(
      `• آخر تغييرات / last changes: ${changes
        .slice(0, 5)
        .map((x) => x.kind)
        .join(", ")}`,
    );
  if (lines.length === 1)
    lines.push(
      "• بعد ما في شي. بتعلّم من طلباتك وتغييراتك. / Nothing yet: I learn from your orders and changes.",
    );
  lines.push(
    "",
    "بستعمل هالشي لاقتراحات بس، وكل تغيير بدو تأكيدك. / Used only for suggestions; every change waits for your tap.",
  );
  return lines.join("\n");
}

/** The language a merchant writes in, for memory (the copilot answers in it). */
export function writesIn(text: string): "ar" | "en" | "fr" | "arabizi" {
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[a-z][2357][a-z]|\b(?:el|w|bas|shu|shou|fi|ma3|3a)\b/i.test(text)) return "arabizi";
  if (/[éèàçù]|\b(?:le|la|les|fermé|ferme|demain|prix|jusqu)\b/i.test(text)) return "fr";
  return "en";
}
