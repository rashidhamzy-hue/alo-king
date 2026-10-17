// The Alo King app inside WhatsApp (DECISIONS §39.15.13): the data endpoint of the dynamic Flow `alo_app_<lang>`
// (whatsapp/flows/app.<lang>.json). Every screen is read live for the customer's point; every price, fee and total comes
// from the server (web_explore, web_menu, flow_app_basket); the Flow only sends ids, quantities and choices back, and
// flow_app_add checks them before basket_add_item prices them from the menu.
//
// Transport: Meta encrypts each request; Kapso decrypts it (Flow encryption, §39.8) and its data-endpoint function
// (whatsapp/flows/endpoint/flow-app-proxy.js) forwards the plaintext here signed with the proxy key (verifyProxy). The
// Flow token names the customer (flow_app_session: signature, then an unexpired link). Unsigned requests (Kapso's
// preview) and unknown tokens get the "open it from the chat" screen and no data.
//
// Screens and routes (the routing model in the Flow JSON): HOME → SEARCH, SHOPS, ITEM, BASKET; SEARCH → SHOPS;
// SHOPS → SHOP; SHOP → LIST, ITEM; LIST → ITEM; ITEM → BASKET; BASKET ends the Flow (Confirm). A long list is a page of
// `pageSize` rows and a last "More" row that answers the same screen with the next page.

export type Lang = "ar" | "en";

/** What the endpoint reads and writes; production calls the RPCs, tests use fixtures. */
export interface FlowAppStore {
  session(flowToken: string): Promise<{
    status: string;
    token?: string;
    customer_id?: string;
    lang?: string;
  }>;
  explore(token: string, q: string | null, category: string | null, offset: number): Promise<any>;
  menu(token: string, slug: string): Promise<any>;
  basket(token: string): Promise<any>;
  add(
    token: string,
    itemId: string,
    qty: number,
    optionIds: string[],
    note: string | null,
    replace: boolean,
  ): Promise<any>;
  remove(token: string, lineIds: string[]): Promise<any>;
  complete(token: string): Promise<any>;
  thumbs(
    kind: "item" | "item_large" | "cover" | "category",
    refs: string[],
  ): Promise<Record<string, string>>;
}

export type FlowRequest = {
  version?: string;
  action?: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
};

export type FlowResponse = { version: "3.0"; screen: string; data: Record<string, unknown> };

/** Meta's NavigationList limits (whatsapp-flows-spec.md): 20 rows, title 30, description 20, metadata 80, end 10. */
export const NAV = {
  rows: 20,
  title: 30,
  description: 20,
  metadata: 80,
  end: 10,
  badge: 15,
  label: 80,
  desc: 300,
};
/** Radio and checkbox options: title 30, description 30 (whatsapp-flows-spec.md). */
export const OPT = { title: 30, description: 30, max: 20 };
/** List images: base64 JPEG under Meta's 100 KB (the flow-thumbs job makes them far smaller). */
export const MAX_IMAGE_B64 = 136_000;
/** Choice groups the item page can show: single-choice radios and multi-choice checkboxes. */
export const SLOTS = { radio: 4, check: 3 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[a-z][a-z_]{0,30}$/;

export const clip = (s: unknown, n: number) => {
  const a = Array.from(
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return a.length <= n ? a.join("") : `${a.slice(0, n - 1).join("")}…`;
};
const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;
const lbp = (n: unknown) => `${Math.round(Number(n ?? 0)).toLocaleString("en-US")} LBP`;
const nm = (lang: Lang, ar: unknown, en: unknown) =>
  String((lang === "ar" ? (ar ?? en) : (en ?? ar)) ?? "").trim();
const img = (b64: string | undefined) => (b64 && b64.length <= MAX_IMAGE_B64 ? b64 : undefined);

const T: Record<string, Record<Lang, string>> = {
  craving: { ar: "شو جايي عبالك؟", en: "What are you craving?" },
  search: { ar: "🔍 فتّش", en: "🔍 Search" },
  searchDesc: { ar: "أكلة أو محل", en: "A dish or a shop" },
  near: { ar: "🏪 محلات قريبة", en: "🏪 Shops near you" },
  shopsN: { ar: "{n} محل", en: "{n} shops" },
  shops1: { ar: "محل واحد", en: "1 shop" },
  basketRow: { ar: "🛒 سلّتك", en: "🛒 Your basket" },
  popular: { ar: "الأكتر طلباً حدّك", en: "Popular near you" },
  dishesNear: { ar: "أطباق حدّك", en: "Dishes near you" },
  shopsNear: { ar: "محلات بتوصّل لـ {place}", en: "Shops that deliver to {place}" },
  results: { ar: "نتائج «{q}»", en: "Results for “{q}”" },
  noResults: { ar: "ما لقينا شي. جرّب كلمة تانية.", en: "Nothing found for that." },
  allShops: { ar: "كل المحلات القريبة", en: "All shops near you" },
  noShopsYet: { ar: "ما في محل بيوصّل لهون بعد", en: "No shop delivers here yet" },
  more: { ar: "المزيد ›", en: "More ›" },
  closed: { ar: "مسكّر", en: "Closed" },
  sections: { ar: "الأقسام", en: "Sections" },
  bestItems: { ar: "أصناف {shop}", en: "From {shop}" },
  items: { ar: "{n} صنف", en: "{n} items" },
  items1: { ar: "صنف واحد", en: "1 item" },
  minutes: { ar: "{a}–{b} د", en: "{a}–{b} min" },
  untilHours: { ar: "اليوم {h}", en: "today {h}" },
  delivery: { ar: "🛵 {fee}", en: "🛵 {fee}" },
  add: { ar: "زيد عالسلّة · {p}", en: "Add · {p}" },
  addFrom: { ar: "زيد عالسلّة · من {p}", en: "Add · from {p}" },
  estimated: {
    ar: "≈ {kcal} سعرة · {p} غ بروتين (تقديري)",
    en: "≈ {kcal} kcal · {p} g protein (estimated)",
  },
  allergens: { ar: "فيه: {a} (حسب المحل)", en: "Contains: {a} (declared by the shop)" },
  goesWell: { ar: "بيمشي معه", en: "Goes well with" },
  switchShop: {
    ar: "سلّتك من {shop}. ابدأ سلّة جديدة من هالمحل",
    en: "Your basket is from {shop}. Start a new one here",
  },
  otherShop: {
    ar: "سلّتك من {shop}. علّم «ابدأ سلّة جديدة» لتبدّل.",
    en: "Your basket is from {shop}. Tick “Start a new one” to switch.",
  },
  chooseFirst: {
    ar: "اختار المطلوب قبل ما تزيد.",
    en: "Please choose the required options first.",
  },
  unavailable: { ar: "هالصنف مش متوفّر هلق.", en: "This item isn't available right now." },
  tooMany: {
    ar: "هالصنف إلو خيارات كتير، زيده من المحادثة.",
    en: "This item has more choices than fit here: add it in the chat.",
  },
  subtotal: { ar: "المجموع", en: "Subtotal" },
  fee: { ar: "التوصيل", en: "Delivery" },
  total: { ar: "الكل", en: "Total" },
  feeAtCheckout: { ar: "التوصيل بينحسب بالتأكيد", en: "Delivery is worked out at checkout" },
  confirmNote: {
    ar: "«تأكيد» بيبعتلك الملخّص بالمحادثة. الطلب ما بيتبعت إلا بس تأكّد هونيك.",
    en: "Confirm sends the summary to the chat. The order is placed only when you confirm it there.",
  },
  empty: { ar: "سلّتك فاضية.", en: "Your basket is empty." },
  removeLabel: { ar: "شيل من السلّة", en: "Remove from basket" },
  expired: {
    ar: "سكّر هالصفحة واكبس «اطلب» بالمحادثة",
    en: "Close this and tap Order in the chat",
  },
  expiredDesc: { ar: "انتهت الجلسة", en: "This session ended" },
  outside: {
    ar: "ما منوصّل لعندك بعد. كمّل بالمحادثة.",
    en: "We don't deliver here yet. Carry on in the chat.",
  },
  fullMenu: { ar: "كل الأصناف", en: "All items" },
};
export const t = (lang: Lang, k: keyof typeof T, v: Record<string, string | number> = {}) =>
  T[k][lang].replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ""));
/** "1 shop", "3 shops" (and the same for items). */
const count = (lang: Lang, k: "shopsN" | "items", n: number) =>
  Number(n) === 1 ? t(lang, k === "shopsN" ? "shops1" : "items1") : t(lang, k, { n });

const go = (payload: Record<string, string>) => ({ name: "data_exchange", payload });

type Row = {
  id: string;
  "main-content": { title: string; description?: string; metadata?: string };
  start?: { image: string; "alt-text"?: string };
  end?: { title?: string; description?: string };
  badge?: string;
  "on-click-action": ReturnType<typeof go>;
};

function row(
  id: string,
  title: string,
  payload: Record<string, string>,
  o: { description?: string; metadata?: string; image?: string; end?: string; badge?: string } = {},
): Row {
  const r: Row = {
    id: clip(id, 60),
    "main-content": { title: clip(title, NAV.title) || "·" },
    "on-click-action": go(payload),
  };
  if (o.description) r["main-content"].description = clip(o.description, NAV.description);
  if (o.metadata) r["main-content"].metadata = clip(o.metadata, NAV.metadata);
  const im = img(o.image);
  if (im) r.start = { image: im, "alt-text": clip(title, 60) };
  if (o.end) r.end = { title: clip(o.end, NAV.end) };
  if (o.badge) r.badge = clip(o.badge, NAV.badge);
  return r;
}

/** One page of rows and a last "More" row when more follow (never more than Meta's 20). */
export function paged(
  rows: Row[],
  offset: number,
  size: number,
  more: (next: number) => Row,
): Row[] {
  const page = rows.slice(offset, offset + size);
  return rows.length > offset + size ? [...page, more(offset + size)] : page;
}

/** At most one badge per list (Meta). */
const oneBadge = (rows: Row[]) => {
  let seen = false;
  return rows.map((r) => {
    if (!r.badge) return r;
    if (seen) {
      const { badge: _b, ...rest } = r;
      return rest as Row;
    }
    seen = true;
    return r;
  });
};

const res = (screen: string, data: Record<string, unknown>): FlowResponse => ({
  version: "3.0",
  screen,
  data,
});

// ---- Screens ----------------------------------------------------------------------------------------------------------
function expiredHome(lang: Lang, why: "expired" | "outside" = "expired"): FlowResponse {
  const r = row(
    "closed",
    t(lang, why === "outside" ? "outside" : "expired"),
    { go: "close" },
    {
      description: t(lang, "expiredDesc"),
    },
  );
  return res("HOME", {
    cats_label: why === "outside" ? t(lang, "outside") : t(lang, "expired"),
    cats: [r],
    pop_label: " ",
    pop: [r],
  });
}

async function home(s: FlowAppStore, tok: string, lang: Lang): Promise<FlowResponse> {
  const [e, b] = await Promise.all([
    s.explore(tok, null, null, 0),
    s.basket(tok).catch(() => null),
  ]);
  if (e?.status === "expired") return expiredHome(lang);
  if (e?.status !== "ok") return expiredHome(lang, "outside");
  const cats: any[] = Array.isArray(e.categories) ? e.categories : [];
  const pop: any[] = Array.isArray(e.popular?.items) ? e.popular.items : [];
  const [catImg, popImg] = await Promise.all([
    s.thumbs(
      "category",
      cats.map((c) => String(c.key)),
    ),
    s.thumbs(
      "item",
      pop.map((p) => String(p.id)),
    ),
  ]);
  const rows: Row[] = [];
  if (b?.status === "ok" && Array.isArray(b.lines) && b.lines.length) {
    const n = b.lines.reduce((k: number, l: any) => k + Number(l.quantity ?? 0), 0);
    rows.push(
      row(
        "basket",
        t(lang, "basketRow"),
        { go: "basket" },
        {
          description: `${n} · ${usd(b.subtotal_usd)}`,
          metadata: nm(lang, b.vendor_ar, b.vendor_en),
        },
      ),
    );
  }
  rows.push(
    row("search", t(lang, "search"), { go: "search" }, { description: t(lang, "searchDesc") }),
  );
  const nShops = Array.isArray(e.shops) ? e.shops.length : 0;
  rows.push(
    row(
      "near",
      t(lang, "near"),
      { go: "shops", cat: "", q: "", offset: "0" },
      {
        description: e.next_offset != null ? "" : count(lang, "shopsN", nShops),
        metadata: nm(lang, e.place?.name_ar, e.place?.name_en),
      },
    ),
  );
  for (const c of cats.slice(0, NAV.rows - rows.length))
    rows.push(
      row(
        `c_${c.key}`,
        `${c.emoji ?? ""} ${nm(lang, c.name_ar, c.name_en)}`.trim(),
        {
          go: "shops",
          cat: String(c.key),
          q: "",
          offset: "0",
        },
        { description: count(lang, "shopsN", Number(c.shops ?? 0)), image: catImg[c.key] },
      ),
    );
  const popRows = pop.slice(0, NAV.rows).map((p) =>
    row(
      `p_${p.id}`,
      nm(lang, p.name_ar, p.name_en),
      { go: "item", slug: String(p.slug), item: String(p.id) },
      {
        description: nm(lang, p.vendor_ar, p.vendor_en),
        image: popImg[p.id],
        end: usd(p.price_usd),
      },
    ),
  );
  return res("HOME", {
    cats_label: t(lang, "craving"),
    cats: rows,
    pop_label: e.popular?.by_sales ? t(lang, "popular") : t(lang, "dishesNear"),
    // A list always has a row: without dishes yet, the shops near the customer stand in.
    pop: popRows.length ? popRows : [rows.find((r) => r.id === "near")!],
  });
}

async function shops(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  q: string | null,
  cat: string | null,
  offset: number,
  size: number,
): Promise<FlowResponse> {
  const e = await s.explore(tok, q, cat, offset);
  if (e?.status === "expired") return expiredHome(lang);
  if (e?.status !== "ok") return expiredHome(lang, "outside");
  const list: any[] = Array.isArray(e.shops) ? e.shops : [];
  const covers = await s.thumbs(
    "cover",
    list.map((x) => String(x.vendor_id)),
  );
  const rows = oneBadge(
    list.slice(0, size).map((x) => {
      const eta = x.eta_min != null ? t(lang, "minutes", { a: x.eta_min, b: x.eta_max }) : "";
      const fee = x.fee_usd != null ? t(lang, "delivery", { fee: usd(x.fee_usd) }) : "";
      return row(
        `s_${x.vendor_id}`,
        nm(lang, x.name_ar, x.name_en),
        { go: "shop", slug: String(x.slug) },
        {
          description: nm(lang, x.cuisine_ar, x.cuisine_en),
          metadata: [fee, eta, nm(lang, x.village_ar, x.village_en)].filter(Boolean).join(" · "),
          image: covers[x.vendor_id],
          badge: x.open_now === false ? t(lang, "closed") : undefined,
        },
      );
    }),
  );
  if (e.next_offset != null)
    rows.push(
      row("more", t(lang, "more"), {
        go: "shops",
        cat: cat ?? "",
        q: q ?? "",
        offset: String(e.next_offset),
      }),
    );
  const place = nm(lang, e.place?.name_ar, e.place?.name_en);
  const label = q ? t(lang, "results", { q: clip(q, 30) }) : t(lang, "shopsNear", { place });
  // An empty list still needs a row, and SHOPS can only route to SHOP or itself: a filtered search offers every shop near
  // the customer; with none at all, the row reloads the list.
  if (!rows.length)
    rows.push(
      row(
        "all",
        t(lang, q || cat ? "noResults" : "noShopsYet"),
        { go: "shops", cat: "", q: "", offset: "0" },
        {
          description: q || cat ? t(lang, "allShops") : undefined,
        },
      ),
    );
  return res("SHOPS", { shops_label: clip(label, NAV.label), shops: rows });
}

type MenuItem = any;
const priceOf = (i: MenuItem) =>
  i.per_kg ? Number(i.price_usd) * Number(i.est_weight_kg ?? 1) : Number(i.price_usd);

function shopLine(lang: Lang, m: any): string {
  const sh = m.shop ?? {};
  const d = m.delivery ?? {};
  return [
    nm(lang, sh.cuisine_ar, sh.cuisine_en),
    nm(lang, sh.village_ar, sh.village_en),
    d.fee_usd != null ? t(lang, "delivery", { fee: usd(d.fee_usd) }) : "",
    d.eta_min != null ? t(lang, "minutes", { a: d.eta_min, b: d.eta_max }) : "",
    sh.hours_today ? t(lang, "untilHours", { h: sh.hours_today }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

async function itemRows(
  s: FlowAppStore,
  lang: Lang,
  slug: string,
  items: MenuItem[],
): Promise<Row[]> {
  const th = await s.thumbs(
    "item",
    items.filter((i) => i.photo).map((i) => String(i.id)),
  );
  return items.map((i) =>
    // An item without a photo is a clean row: its name, a line of its description, its price.
    row(
      `i_${i.id}`,
      nm(lang, i.name_ar, i.name_en),
      { go: "item", slug, item: String(i.id) },
      {
        metadata: i.description ? String(i.description) : undefined,
        image: th[i.id],
        end: usd(priceOf(i)),
      },
    ),
  );
}

async function shop(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  slug: string,
  size: number,
): Promise<FlowResponse> {
  const m = await s.menu(tok, slug);
  if (m?.status === "expired") return expiredHome(lang);
  if (m?.status !== "ok") return expiredHome(lang, "outside");
  const name = nm(lang, m.shop?.name_ar, m.shop?.name_en);
  const secs: any[] = Array.isArray(m.sections) ? m.sections : [];
  const secRows = paged(
    secs.map((x, k) =>
      row(
        `x_${k}`,
        nm(lang, x.name_ar, x.name_en) || name,
        { go: "section", slug, sec: String(k), offset: "0" },
        {
          description: count(lang, "items", (x.items ?? []).length),
        },
      ),
    ),
    0,
    size,
    () => row("xmore", t(lang, "fullMenu"), { go: "section", slug, sec: "all", offset: "0" }),
  );
  // The shop's first items: a few of each section in its own order, photos first, so the page opens on real dishes.
  const first: MenuItem[] = [];
  for (const x of secs)
    for (const i of (x.items ?? []).slice(0, 4)) if (first.length < size) first.push(i);
  first.sort((a, b) => Number(!!b.photo) - Number(!!a.photo));
  return res("SHOP", {
    secs_label: clip(name, NAV.label),
    secs_desc: clip(shopLine(lang, m), NAV.desc),
    secs: secRows.length ? secRows : [row("none", t(lang, "unavailable"), { go: "home" })],
    items_label: clip(t(lang, "bestItems", { shop: name }), NAV.label),
    items: first.length
      ? await itemRows(s, lang, slug, first)
      : [row("none", t(lang, "unavailable"), { go: "home" })],
  });
}

async function section(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  slug: string,
  sec: string,
  offset: number,
  size: number,
): Promise<FlowResponse> {
  const m = await s.menu(tok, slug);
  if (m?.status === "expired") return expiredHome(lang);
  if (m?.status !== "ok") return expiredHome(lang, "outside");
  const secs: any[] = Array.isArray(m.sections) ? m.sections : [];
  const k = Number(sec);
  const x = sec === "all" ? null : secs[k];
  const items: MenuItem[] = x ? (x.items ?? []) : secs.flatMap((y) => y.items ?? []);
  const page = items.slice(offset, offset + size);
  const rows = await itemRows(s, lang, slug, page);
  if (items.length > offset + size)
    rows.push(
      row("more", t(lang, "more"), { go: "section", slug, sec, offset: String(offset + size) }),
    );
  const shopName = nm(lang, m.shop?.name_ar, m.shop?.name_en);
  return res("LIST", {
    rows_label: clip(x ? nm(lang, x.name_ar, x.name_en) || shopName : shopName, NAV.label),
    rows_desc: clip(shopLine(lang, m), NAV.desc),
    rows: rows.length ? rows : [row("none", t(lang, "unavailable"), { go: "home" })],
  });
}

const emptyGroup = { label: " ", items: [{ id: "none", title: "·" }], visible: false };

/** The item page's data: photo, names, description, facts, choice groups in their slots, Goes well with. */
export async function itemData(
  s: FlowAppStore,
  lang: Lang,
  m: any,
  slug: string,
  itemId: string,
): Promise<Record<string, unknown> | null> {
  const all: MenuItem[] = (m.sections ?? []).flatMap((x: any) => x.items ?? []);
  const i = all.find((x) => x.id === itemId);
  if (!i) return null;
  const gw = i.goes_well ? all.find((x) => x.id === i.goes_well) : null;
  const gwPlain = gw && !(gw.groups ?? []).some((g: any) => Number(g.min) > 0);
  const [large, small] = await Promise.all([
    i.photo ? s.thumbs("item_large", [itemId]) : Promise.resolve({} as Record<string, string>),
    gwPlain && gw.photo
      ? s.thumbs("item", [String(gw.id)])
      : Promise.resolve({} as Record<string, string>),
  ]);
  const groups: any[] = i.groups ?? [];
  const radios = groups.filter((g) => Number(g.max) <= 1);
  const checks = groups.filter((g) => Number(g.max) > 1);
  const d: Record<string, unknown> = {
    item_id: i.id,
    slug,
    name: clip(nm(lang, i.name_ar, i.name_en), 80),
    sub: clip(
      [lang === "ar" ? i.name_en : i.name_ar, nm(lang, m.shop?.name_ar, m.shop?.name_en)]
        .filter((x) => x && String(x).trim())
        .join(" · "),
      409,
    ),
    desc: clip(i.description ?? " ", 4096) || " ",
    has_desc: !!i.description,
    photo: img(large[itemId]) ?? "",
    has_photo: !!img(large[itemId]),
    too_many: radios.length > SLOTS.radio || checks.length > SLOTS.check,
    too_many_text: t(lang, "tooMany"),
  };
  const facts: string[] = [];
  if (i.nutrition?.kcal != null)
    facts.push(
      t(lang, "estimated", {
        kcal: Math.round(i.nutrition.kcal),
        p: Math.round(Number(i.nutrition.protein_g ?? 0)),
      }),
    );
  if (Array.isArray(i.allergens) && i.allergens.length)
    facts.push(t(lang, "allergens", { a: i.allergens.join(", ") }));
  d.facts = facts.join("\n") || " ";
  d.has_facts = facts.length > 0;
  const opt = (o: any) => ({
    id: String(o.id),
    title: clip(nm(lang, o.name_ar, o.name_en), OPT.title) || "·",
    ...(Number(o.price_usd) > 0 ? { description: `+${usd(o.price_usd)}` } : {}),
  });
  for (let k = 0; k < SLOTS.radio; k++) {
    const g = radios[k];
    d[`r${k + 1}_label`] = g ? clip(nm(lang, g.name_ar, g.name_en), 30) || " " : emptyGroup.label;
    d[`r${k + 1}_items`] = g ? g.options.slice(0, OPT.max).map(opt) : emptyGroup.items;
    d[`r${k + 1}_visible`] = !!g;
    d[`r${k + 1}_required`] = !!g && Number(g.min) > 0;
  }
  for (let k = 0; k < SLOTS.check; k++) {
    const g = checks[k];
    d[`c${k + 1}_label`] = g ? clip(nm(lang, g.name_ar, g.name_en), 30) || " " : emptyGroup.label;
    d[`c${k + 1}_items`] = g ? g.options.slice(0, OPT.max).map(opt) : emptyGroup.items;
    d[`c${k + 1}_visible`] = !!g;
    d[`c${k + 1}_min`] = g ? Math.min(Number(g.min ?? 0), g.options.length) : 0;
    d[`c${k + 1}_max`] = g ? Math.max(1, Math.min(Number(g.max ?? 1), g.options.length)) : 1;
  }
  d.gw_label = t(lang, "goesWell");
  d.gw_items = gwPlain
    ? [
        {
          id: String(gw.id),
          title: clip(nm(lang, gw.name_ar, gw.name_en), OPT.title) || "·",
          description: `+${usd(priceOf(gw))}`,
          ...(img(small[gw.id])
            ? { image: small[gw.id], "alt-text": clip(nm(lang, gw.name_ar, gw.name_en), 60) }
            : {}),
        },
      ]
    : emptyGroup.items;
  d.gw_visible = !!gwPlain;
  const base = priceOf(i);
  const extra = groups.some((g) => (g.options ?? []).some((o: any) => Number(o.price_usd) > 0));
  d.add_label = clip(t(lang, extra ? "addFrom" : "add", { p: usd(base) }), 35);
  const other = m.basket?.other_vendor === true;
  const otherShop = other ? nm(lang, m.basket.vendor_ar, m.basket.vendor_en) : "";
  d.sw_items = [
    { id: "replace", title: clip(t(lang, "switchShop", { shop: otherShop }), OPT.title) },
  ];
  d.sw_label = other ? clip(t(lang, "otherShop", { shop: otherShop }), 30) : " ";
  d.sw_visible = other;
  return d;
}

async function item(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  slug: string,
  itemId: string,
): Promise<FlowResponse> {
  const m = await s.menu(tok, slug);
  if (m?.status === "expired") return expiredHome(lang);
  if (m?.status !== "ok") return expiredHome(lang, "outside");
  const d = await itemData(s, lang, m, slug, itemId);
  if (!d) return section(s, tok, lang, slug, "all", 0, 19);
  return res("ITEM", d);
}

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [])
    .map(String)
    .filter((x) => UUID.test(x));

async function add(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  d: Record<string, unknown>,
): Promise<FlowResponse> {
  const itemId = String(d.item ?? "");
  const slug = String(d.slug ?? "");
  if (!UUID.test(itemId) || !SLUG.test(slug)) return expiredHome(lang);
  const opts = [
    ...[1, 2, 3, 4].flatMap((k) => list(d[`r${k}`])),
    ...[1, 2, 3].flatMap((k) => list(d[`c${k}`])),
  ];
  const qty = Math.min(Math.max(parseInt(String(d.qty ?? "1"), 10) || 1, 1), 10);
  const note = typeof d.note === "string" ? d.note.slice(0, 200) : null;
  const replace = list(d.sw).length > 0 || (Array.isArray(d.sw) && d.sw.includes("replace"));
  const r = await s.add(tok, itemId, qty, opts, note, replace);
  if (r?.status === "expired") return expiredHome(lang);
  if (r?.status !== "added") {
    // Stay on the item page with the reason (and every field the screen needs).
    const m = await s.menu(tok, slug);
    const data = m?.status === "ok" ? await itemData(s, lang, m, slug, itemId) : null;
    if (!data) return expiredHome(lang);
    const why =
      r?.status === "choices"
        ? t(lang, "chooseFirst")
        : r?.status === "other_vendor"
          ? t(lang, "otherShop", {
              shop: m.basket?.other_vendor
                ? nm(lang, m.basket.vendor_ar, m.basket.vendor_en)
                : String(r.basket_vendor ?? ""),
            })
          : t(lang, "unavailable");
    if (r?.status === "other_vendor") data.sw_visible = true;
    return res("ITEM", { ...data, error_message: why });
  }
  // Goes well with, ticked: one of it, if it needs no choice (the server checks it again).
  for (const g of list(d.gw)) await s.add(tok, g, 1, [], null, false).catch(() => null);
  return basket(s, tok, lang);
}

async function basket(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  error?: string,
): Promise<FlowResponse> {
  const b = await s.basket(tok);
  if (b?.status === "expired") return expiredHome(lang);
  const lines: any[] = b?.status === "ok" && Array.isArray(b.lines) ? b.lines : [];
  const text = lines.length
    ? lines
        .map((l) => {
          const opts =
            Array.isArray(l.options) && l.options.length ? ` (${l.options.join(", ")})` : "";
          const note = l.note ? `\n_${String(l.note).replace(/[*_~`]/g, "")}_` : "";
          return `${l.quantity}× ${nm(lang, l.name_ar, l.name_en)}${opts} · **${usd(l.line_total_usd)}**${note}`;
        })
        .join("\n")
    : t(lang, "empty");
  const totals = lines.length
    ? [
        `${t(lang, "subtotal")}: ${usd(b.subtotal_usd)}`,
        b.fee_usd != null ? `${t(lang, "fee")}: ${usd(b.fee_usd)}` : t(lang, "feeAtCheckout"),
        b.total_usd != null
          ? `**${t(lang, "total")}: ${usd(b.total_usd)} · ${lbp(b.total_lbp)}**`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : " ";
  return res("BASKET", {
    shop: clip(nm(lang, b?.vendor_ar, b?.vendor_en) || t(lang, "basketRow"), 80),
    lines_text: text,
    remove_items: lines.length
      ? lines.slice(0, OPT.max).map((l) => ({
          id: String(l.line_id),
          title: clip(`${l.quantity}× ${nm(lang, l.name_ar, l.name_en)}`, OPT.title),
        }))
      : [{ id: "none", title: "·" }],
    has_lines: lines.length > 0,
    totals_text: totals,
    confirm_note: t(lang, "confirmNote"),
    ...(error ? { error_message: error } : {}),
  });
}

async function confirm(
  s: FlowAppStore,
  tok: string,
  lang: Lang,
  flowToken: string,
  d: Record<string, unknown>,
): Promise<FlowResponse> {
  const remove = list(d.remove);
  if (remove.length) {
    await s.remove(tok, remove);
    return basket(s, tok, lang);
  }
  const r = await s.complete(tok);
  if (r?.status === "expired") return expiredHome(lang);
  if (r?.status !== "ok") return basket(s, tok, lang, t(lang, "empty"));
  return res("SUCCESS", {
    extension_message_response: {
      params: { flow_token: flowToken, app: "alo_app", basket_id: String(r.basket_id ?? "") },
    },
  });
}

/**
 * One data-exchange request: INIT opens HOME; every other request carries `go` (the tapped row's or footer's payload)
 * and the ids it needs, each checked here and again by the server.
 */
export async function handleFlowRequest(
  s: FlowAppStore,
  req: FlowRequest,
  opts: { pageSize?: number; signed: boolean },
): Promise<FlowResponse> {
  const size = Math.min(Math.max(opts.pageSize ?? 19, 5), NAV.rows - 1);
  const flowToken = String(req.flow_token ?? "");
  const guessLang: Lang = (req.data as any)?.lang === "en" ? "en" : "ar";
  if (!opts.signed) return expiredHome(guessLang);
  const sess = await s.session(flowToken);
  if (sess.status !== "ok" || !sess.token) return expiredHome(guessLang);
  const tok = sess.token;
  const lang: Lang = sess.lang === "en" ? "en" : "ar";
  const d = (req.data ?? {}) as Record<string, unknown>;
  // Meta's ping on the endpoint and the error notifications need no screen.
  if (req.action === "INIT" || req.action === "BACK") return home(s, tok, lang);
  const g = String(d.go ?? "");
  const off = Math.min(Math.max(parseInt(String(d.offset ?? "0"), 10) || 0, 0), 10_000);
  switch (g) {
    case "search":
      return res("SEARCH", {});
    case "shops": {
      const q = typeof d.q === "string" ? d.q.trim().slice(0, 60) : "";
      const cat = typeof d.cat === "string" && KEY.test(d.cat) ? d.cat : null;
      return shops(s, tok, lang, q.length >= 2 ? q : null, cat, off, size);
    }
    case "shop":
      return SLUG.test(String(d.slug ?? ""))
        ? shop(s, tok, lang, String(d.slug), size)
        : home(s, tok, lang);
    case "section": {
      const sec = String(d.sec ?? "");
      if (!SLUG.test(String(d.slug ?? "")) || !/^(all|\d{1,3})$/.test(sec))
        return home(s, tok, lang);
      return section(s, tok, lang, String(d.slug), sec, off, size);
    }
    case "item":
      return SLUG.test(String(d.slug ?? "")) && UUID.test(String(d.item ?? ""))
        ? item(s, tok, lang, String(d.slug), String(d.item))
        : home(s, tok, lang);
    case "add":
      return add(s, tok, lang, d);
    case "basket":
      return basket(s, tok, lang);
    case "confirm":
      return confirm(s, tok, lang, flowToken, d);
    case "close":
      return res("SUCCESS", {
        extension_message_response: {
          params: { flow_token: flowToken, app: "alo_app", closed: "1" },
        },
      });
    default:
      return home(s, tok, lang);
  }
}

// ---- The proxy's signature ------------------------------------------------------------------------------------------------
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 (hex) of `<timestamp>.<raw body>` with the proxy key (hex), as the Kapso function signs it. */
export async function proxySignature(keyHex: string, ts: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array((keyHex.match(/../g) ?? []).map((h) => parseInt(h, 16))),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${raw}`)));
}

/** A forwarded request is genuine when its signature matches and its timestamp is within five minutes. */
export async function verifyProxy(
  keyHex: string | null,
  ts: string | null,
  sig: string | null,
  raw: string,
  now = Date.now(),
): Promise<boolean> {
  if (
    !keyHex ||
    !/^[0-9a-f]{64}$/.test(keyHex) ||
    !ts ||
    !/^\d{10}$/.test(ts) ||
    !sig ||
    !/^[0-9a-f]{64}$/.test(sig)
  )
    return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = await proxySignature(keyHex, ts, raw);
  let diff = 0;
  for (let k = 0; k < 64; k++) diff |= want.charCodeAt(k) ^ sig.charCodeAt(k);
  return diff === 0;
}
