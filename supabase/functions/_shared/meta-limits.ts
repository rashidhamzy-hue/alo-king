// WhatsApp Cloud API limits for interactive messages. One source of truth: the senders clip to these numbers and
// meta-limits.test.ts fails if any builder or hard-coded title would exceed them.
export const META = {
  maxButtons: 3,
  buttonTitle: 20,
  buttonId: 256,
  listRows: 10, // total rows across all sections
  listSections: 10,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  sectionTitle: 24,
  listButton: 20,
  header: 60,
  footer: 60,
  body: 1024,
  flowCta: 30, // Flow button label
  productListItems: 30, // multi-product message: items across all sections
  productListSections: 10,
  carouselMinCards: 2, // product carousel (DECISIONS §39.15.2): 2 to 10 product cards, one catalogue
  carouselMaxCards: 10,
} as const;

/** Every way an interactive payload breaks Meta's limits (empty array = fine). Template and plain-text payloads are not interactive and are ignored. */
export function checkInteractive(payload: any): string[] {
  const v: string[] = [];
  const i = payload?.interactive;
  if (!i) return v;
  const len = (s: unknown) => [...String(s ?? "")].length; // WhatsApp counts characters, not UTF-16 units (emoji = 1)
  if (len(i.body?.text) > META.body) v.push(`body ${len(i.body?.text)} > ${META.body}`);
  if (i.body && !String(i.body.text ?? "").trim()) v.push("empty body");
  if (len(i.footer?.text) > META.footer) v.push(`footer ${len(i.footer?.text)} > ${META.footer}`);
  if (i.header?.type === "text" && len(i.header.text) > META.header) v.push(`header ${len(i.header.text)} > ${META.header}`);
  if (i.type === "button") {
    const bs = i.action?.buttons ?? [];
    if (bs.length < 1) v.push("no buttons");
    if (bs.length > META.maxButtons) v.push(`${bs.length} buttons > ${META.maxButtons}`);
    const titles = new Set<string>();
    for (const b of bs) {
      const t = String(b.reply?.title ?? "");
      if (!t.trim()) v.push("empty button title");
      if (len(t) > META.buttonTitle) v.push(`button title "${t}" is ${len(t)} > ${META.buttonTitle}`);
      if (titles.has(t)) v.push(`duplicate button title "${t}"`);
      titles.add(t);
      if (len(b.reply?.id) > META.buttonId) v.push(`button id ${len(b.reply?.id)} > ${META.buttonId}`);
      if (!String(b.reply?.id ?? "").trim()) v.push("empty button id");
    }
  } else if (i.type === "list") {
    const secs = i.action?.sections ?? [];
    const rows = secs.flatMap((s: any) => s.rows ?? []);
    if (secs.length > META.listSections) v.push(`${secs.length} sections > ${META.listSections}`);
    if (rows.length < 1) v.push("no rows");
    if (rows.length > META.listRows) v.push(`${rows.length} rows > ${META.listRows}`);
    if (len(i.action?.button) > META.listButton) v.push(`list button "${i.action?.button}" > ${META.listButton}`);
    if (!String(i.action?.button ?? "").trim()) v.push("empty list button");
    for (const s of secs) if (len(s.title) > META.sectionTitle) v.push(`section title "${s.title}" > ${META.sectionTitle}`);
    const ids = new Set<string>();
    for (const r of rows) {
      if (len(r.title) > META.rowTitle) v.push(`row title "${r.title}" is ${len(r.title)} > ${META.rowTitle}`);
      if (!String(r.title ?? "").trim()) v.push("empty row title");
      if (len((r.description ?? "")) > META.rowDescription) v.push(`row description ${len(r.description)} > ${META.rowDescription}`);
      if (len(r.id) > META.rowId) v.push(`row id ${len(r.id)} > ${META.rowId}`);
      if (ids.has(r.id)) v.push(`duplicate row id "${r.id}"`);
      ids.add(r.id);
    }
  } else if (i.type === "location_request_message") {
    if (len(i.body?.text) > META.body) v.push("location request body too long");
  } else if (i.type === "flow") {
    const p = i.action?.parameters ?? {};
    if (len(p.flow_cta) > META.flowCta) v.push(`flow cta "${p.flow_cta}" > ${META.flowCta}`);
    if (!String(p.flow_cta ?? "").trim()) v.push("empty flow cta");
    if (!p.flow_id && !p.flow_name) v.push("flow needs flow_id or flow_name");
    if (!String(p.flow_token ?? "").trim()) v.push("flow needs a flow_token");
    if (p.flow_action === "navigate" && !p.flow_action_payload?.screen) v.push("navigate flow needs a screen");
  } else if (i.type === "product_list") {
    const secs = i.action?.sections ?? [];
    const items = secs.flatMap((s: any) => s.product_items ?? []);
    if (!i.header || i.header.type !== "text" || !String(i.header.text ?? "").trim()) v.push("product list needs a text header");
    if (!String(i.action?.catalog_id ?? "").trim()) v.push("product list needs a catalog_id");
    if (secs.length > META.productListSections) v.push(`${secs.length} sections > ${META.productListSections}`);
    if (items.length < 1) v.push("no products");
    if (items.length > META.productListItems) v.push(`${items.length} products > ${META.productListItems}`);
    for (const s of secs) {
      if (len(s.title) > META.sectionTitle) v.push(`section title "${s.title}" > ${META.sectionTitle}`);
      if (!String(s.title ?? "").trim()) v.push("empty section title");
    }
  } else if (i.type === "product") {
    // Single-product message: one catalogue item; no header (Meta draws the product), body and footer optional.
    if (!String(i.action?.catalog_id ?? "").trim()) v.push("product needs a catalog_id");
    if (!String(i.action?.product_retailer_id ?? "").trim()) v.push("product needs a product_retailer_id");
    if (i.header) v.push("a single-product message takes no header");
    if (len(i.body?.text) > META.body) v.push(`body ${len(i.body?.text)} > ${META.body}`);
  } else if (i.type === "carousel") {
    // Product carousel: swipeable product cards of one catalogue, a body, no header (Meta draws each card).
    const cards = i.action?.cards ?? [];
    if (cards.length < META.carouselMinCards) v.push(`${cards.length} cards < ${META.carouselMinCards}`);
    if (cards.length > META.carouselMaxCards) v.push(`${cards.length} cards > ${META.carouselMaxCards}`);
    if (!String(i.body?.text ?? "").trim()) v.push("carousel needs a body");
    if (i.header) v.push("a product carousel takes no header");
    const ids = new Set<string>();
    const catalogs = new Set<string>();
    cards.forEach((c: any, k: number) => {
      if (c?.card_index !== k) v.push(`card ${k} has card_index ${c?.card_index}`);
      if (c?.type !== "product") v.push(`card ${k} is not a product card`);
      const id = String(c?.action?.product_retailer_id ?? "");
      if (!id.trim()) v.push(`card ${k} needs a product_retailer_id`);
      if (ids.has(id)) v.push(`duplicate product "${id}"`);
      ids.add(id);
      if (!String(c?.action?.catalog_id ?? "").trim()) v.push(`card ${k} needs a catalog_id`);
      catalogs.add(String(c?.action?.catalog_id ?? ""));
    });
    if (catalogs.size > 1) v.push("every card must come from the same catalogue");
  } else if (i.type === "cta_url") {
    const p = i.action?.parameters ?? {};
    if (len(p.display_text) > META.buttonTitle) v.push(`cta label "${p.display_text}" > ${META.buttonTitle}`);
    if (!String(p.display_text ?? "").trim()) v.push("empty cta label");
    if (!/^https:\/\//.test(String(p.url ?? ""))) v.push("cta url must be https");
  }
  return v;
}

export const assertMetaLimits = (payload: any): void => {
  const v = checkInteractive(payload);
  if (v.length) throw new Error(`Meta limits exceeded: ${v.join("; ")}`);
};

const clipTo = (v: unknown, n: number) => { const a = [...String(v ?? "")]; return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
/** Safety net applied to every interactive payload right before it is sent: truncates instead of letting Meta reject the whole message. Valid payloads come back unchanged. */
export function clampInteractive<T>(payload: T): T {
  const p: any = payload;
  if (!p?.interactive) return payload;
  const over = checkInteractive(payload);
  if (over.length) console.warn("meta-limits: clamped an interactive message", over.map((x) => x.split(" ")[0] + " " + x.split(" ").slice(-3).join(" ").replace(/"[^"]*"/g, "")).slice(0, 5)); // limits only, never message text
  const i = JSON.parse(JSON.stringify(p.interactive));
  if (i.body?.text !== undefined) i.body.text = clipTo(i.body.text, META.body);
  if (i.footer?.text !== undefined) i.footer.text = clipTo(i.footer.text, META.footer);
  if (i.header?.type === "text") i.header.text = clipTo(i.header.text, META.header);
  if (i.type === "button" && i.action?.buttons) {
    i.action.buttons = i.action.buttons.slice(0, META.maxButtons).map((b: any) => ({ ...b, reply: { ...b.reply, id: clipTo(b.reply?.id, META.buttonId), title: clipTo(b.reply?.title, META.buttonTitle) } }));
  } else if (i.type === "list" && i.action) {
    let left: number = META.listRows;
    i.action.button = clipTo(i.action.button, META.listButton);
    i.action.sections = (i.action.sections ?? []).slice(0, META.listSections).map((s: any) => {
      const rows = (s.rows ?? []).slice(0, left); left -= rows.length;
      return { ...s, title: s.title === undefined ? undefined : clipTo(s.title, META.sectionTitle), rows: rows.map((r: any) => ({ ...r, id: clipTo(r.id, META.rowId), title: clipTo(r.title, META.rowTitle), ...(r.description ? { description: clipTo(r.description, META.rowDescription) } : {}) })) };
    }).filter((s: any) => s.rows.length);
  } else if (i.type === "location_request_message" && i.body?.text !== undefined) i.body.text = clipTo(i.body.text, META.body);
  else if (i.type === "cta_url" && i.action?.parameters) i.action.parameters = { ...i.action.parameters, display_text: clipTo(i.action.parameters.display_text, META.buttonTitle) };
  else if (i.type === "flow" && i.action?.parameters) i.action.parameters = { ...i.action.parameters, flow_cta: clipTo(i.action.parameters.flow_cta, META.flowCta) };
  else if (i.type === "carousel" && i.action?.cards) {
    i.action.cards = i.action.cards.slice(0, META.carouselMaxCards).map((c: any, k: number) => ({ ...c, card_index: k }));
  } else if (i.type === "product_list" && i.action) {
    let left: number = META.productListItems;
    i.action.sections = (i.action.sections ?? []).slice(0, META.productListSections).map((s: any) => {
      const items = (s.product_items ?? []).slice(0, left); left -= items.length;
      return { ...s, title: clipTo(s.title, META.sectionTitle), product_items: items };
    }).filter((s: any) => s.product_items.length);
  }
  return { ...p, interactive: i };
}
