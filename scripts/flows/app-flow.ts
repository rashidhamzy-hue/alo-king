// The Alo King app as a dynamic WhatsApp Flow (DECISIONS §39.15.13): writes whatsapp/flows/app.ar.json and app.en.json
// (published as alo_app_ar and alo_app_en) from one definition, so both languages keep the same screens, fields and
// routes. Flow JSON 7.3, the newest version and one that has NavigationList (6.2+) with row images; data API 3.0. The
// endpoint is supabase/functions/_shared/flow-app.ts. `pnpm exec tsx scripts/flows/app-flow.ts` rewrites the files;
// flows.test.ts fails when they differ from this.
import { writeFileSync } from "node:fs";

type Lang = "ar" | "en";

const S: Record<string, Record<Lang, string>> = {
  homeTitle: { ar: "ألو كينغ", en: "Alo King" },
  searchTitle: { ar: "فتّش", en: "Search" },
  shopsTitle: { ar: "المحلات", en: "Shops" },
  shopTitle: { ar: "المحل", en: "Shop" },
  listTitle: { ar: "الأصناف", en: "Items" },
  itemTitle: { ar: "الصنف", en: "Item" },
  basketTitle: { ar: "سلّتك", en: "Your basket" },
  searchLabel: { ar: "أكلة أو محل", en: "A dish or a shop" },
  searchHelp: { ar: "مثلاً: شاورما، بيتزا، منقوشة", en: "For example: shawarma, pizza, manoushe" },
  searchBtn: { ar: "فتّش", en: "Search" },
  qty: { ar: "الكمية", en: "Quantity" },
  note: { ar: "ملاحظة للمطبخ", en: "Note for the kitchen" },
  noteHelp: { ar: "مثلاً: بلا بصل", en: "For example: no onions" },
  confirm: { ar: "تأكيد", en: "Confirm" },
  remove: { ar: "شيل من السلّة", en: "Remove from basket" },
};

const str = (example: string) => ({ type: "string", __example__: example });
const bool = (example: boolean) => ({ type: "boolean", __example__: example });
const num = (example: number) => ({ type: "number", __example__: example });
const navRow = {
  type: "object",
  properties: {
    id: { type: "string" },
    "main-content": {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        metadata: { type: "string" },
      },
    },
    start: {
      type: "object",
      properties: { image: { type: "string" }, "alt-text": { type: "string" } },
    },
    end: {
      type: "object",
      properties: { title: { type: "string" }, description: { type: "string" } },
    },
    badge: { type: "string" },
    "on-click-action": {
      type: "object",
      properties: { name: { type: "string" }, payload: { type: "object" } },
    },
  },
};
const rows = (example: unknown[]) => ({ type: "array", items: navRow, __example__: example });
const exampleRow = (id: string, title: string, payload: Record<string, string>) => ({
  id,
  "main-content": { title, description: "", metadata: "" },
  "on-click-action": { name: "data_exchange", payload },
});
const options = (example: unknown[]) => ({
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      image: { type: "string" },
      "alt-text": { type: "string" },
    },
  },
  __example__: example,
});
const nav = (name: string, label: string, items: string, desc?: string) => ({
  type: "NavigationList",
  name,
  label: `\${data.${label}}`,
  ...(desc ? { description: `\${data.${desc}}` } : {}),
  "list-items": `\${data.${items}}`,
});

export function appFlow(lang: Lang) {
  const s = (k: keyof typeof S) => S[k][lang];
  const radio = (k: number) => ({
    type: "RadioButtonsGroup",
    name: `r${k}`,
    label: `\${data.r${k}_label}`,
    "data-source": `\${data.r${k}_items}`,
    visible: `\${data.r${k}_visible}`,
    required: `\${data.r${k}_required}`,
  });
  const check = (k: number) => ({
    type: "CheckboxGroup",
    name: `c${k}`,
    label: `\${data.c${k}_label}`,
    "data-source": `\${data.c${k}_items}`,
    visible: `\${data.c${k}_visible}`,
    required: false,
    "min-selected-items": `\${data.c${k}_min}`,
    "max-selected-items": `\${data.c${k}_max}`,
  });
  const itemData: Record<string, unknown> = {
    item_id: str("51000000-0000-0000-0000-000000000001"),
    slug: str("alo-test-grill"),
    name: str("Chicken Shawarma"),
    sub: str("شاورما دجاج · Alo Test Grill"),
    desc: str("Chicken, garlic sauce, pickles"),
    has_desc: bool(true),
    photo: str(""),
    has_photo: bool(false),
    facts: str("≈ 520 kcal · 32 g protein (estimated)"),
    has_facts: bool(true),
    too_many: bool(false),
    too_many_text: str(" "),
    gw_label: str("Goes well with"),
    gw_items: options([{ id: "x", title: "Fries", description: "+$2.00" }]),
    gw_visible: bool(false),
    add_label: str("Add · $5.00"),
    sw_label: str(" "),
    sw_items: options([{ id: "replace", title: "Start a new basket" }]),
    sw_visible: bool(false),
  };
  for (const k of [1, 2, 3, 4])
    Object.assign(itemData, {
      [`r${k}_label`]: str(k === 1 ? "Size" : " "),
      [`r${k}_items`]: options([{ id: "o1", title: "Regular" }]),
      [`r${k}_visible`]: bool(k === 1),
      [`r${k}_required`]: bool(k === 1),
    });
  for (const k of [1, 2, 3])
    Object.assign(itemData, {
      [`c${k}_label`]: str(" "),
      [`c${k}_items`]: options([{ id: "o2", title: "Cheese", description: "+$0.50" }]),
      [`c${k}_visible`]: bool(false),
      [`c${k}_min`]: num(0),
      [`c${k}_max`]: num(1),
    });
  const qtyOptions = Array.from({ length: 10 }, (_, k) => ({
    id: String(k + 1),
    title: String(k + 1),
  }));
  return {
    version: "7.3",
    data_api_version: "3.0",
    routing_model: {
      HOME: ["SEARCH", "SHOPS", "ITEM", "BASKET"],
      SEARCH: ["SHOPS"],
      SHOPS: ["SHOP"],
      SHOP: ["LIST", "ITEM"],
      LIST: ["ITEM"],
      ITEM: ["BASKET"],
      BASKET: [],
    },
    screens: [
      {
        id: "HOME",
        title: s("homeTitle"),
        data: {
          cats_label: str("What are you craving?"),
          cats: rows([exampleRow("search", "Search", { go: "search" })]),
          pop_label: str("Popular near you"),
          pop: rows([exampleRow("near", "Shops near you", { go: "shops" })]),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [nav("cats", "cats_label", "cats"), nav("pop", "pop_label", "pop")],
        },
      },
      {
        id: "SEARCH",
        title: s("searchTitle"),
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "TextInput",
              name: "q",
              label: s("searchLabel"),
              "input-type": "text",
              required: true,
              "min-chars": 2,
              "max-chars": 60,
              "helper-text": s("searchHelp"),
            },
            {
              type: "Footer",
              label: s("searchBtn"),
              "on-click-action": {
                name: "data_exchange",
                payload: { go: "shops", q: "${form.q}", cat: "", offset: "0" },
              },
            },
          ],
        },
      },
      {
        id: "SHOPS",
        title: s("shopsTitle"),
        data: {
          shops_label: str("Shops that deliver to Baakline"),
          shops: rows([exampleRow("s1", "Alo Test Grill", { go: "shop", slug: "alo-test-grill" })]),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [{ ...nav("shops", "shops_label", "shops"), "media-size": "large" }],
        },
      },
      {
        id: "SHOP",
        title: s("shopTitle"),
        data: {
          secs_label: str("Alo Test Grill"),
          secs_desc: str("Grills · Baakline · 🛵 $2.00 · 25–35 min"),
          secs: rows([
            exampleRow("x0", "Sandwiches", { go: "section", slug: "alo-test-grill", sec: "0" }),
          ]),
          items_label: str("From Alo Test Grill"),
          items: rows([
            exampleRow("i1", "Chicken Shawarma", { go: "item", slug: "alo-test-grill", item: "x" }),
          ]),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            nav("secs", "secs_label", "secs", "secs_desc"),
            nav("items", "items_label", "items"),
          ],
        },
      },
      {
        id: "LIST",
        title: s("listTitle"),
        data: {
          rows_label: str("Sandwiches"),
          rows_desc: str("Grills · Baakline · 🛵 $2.00"),
          rows: rows([
            exampleRow("i1", "Chicken Shawarma", { go: "item", slug: "alo-test-grill", item: "x" }),
          ]),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [nav("rows", "rows_label", "rows", "rows_desc")],
        },
      },
      {
        id: "ITEM",
        title: s("itemTitle"),
        data: itemData,
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "If",
              condition: "${data.has_photo}",
              then: [
                { type: "Image", src: "${data.photo}", "scale-type": "cover", "aspect-ratio": 1 },
              ],
            },
            { type: "TextHeading", text: "${data.name}" },
            { type: "TextCaption", text: "${data.sub}" },
            { type: "TextBody", text: "${data.desc}", visible: "${data.has_desc}" },
            { type: "TextCaption", text: "${data.facts}", visible: "${data.has_facts}" },
            { type: "TextCaption", text: "${data.too_many_text}", visible: "${data.too_many}" },
            radio(1),
            radio(2),
            radio(3),
            radio(4),
            check(1),
            check(2),
            check(3),
            {
              type: "CheckboxGroup",
              name: "gw",
              label: "${data.gw_label}",
              "data-source": "${data.gw_items}",
              visible: "${data.gw_visible}",
              required: false,
              "media-size": "regular",
            },
            {
              type: "Dropdown",
              name: "qty",
              label: s("qty"),
              required: true,
              "init-value": "1",
              "data-source": qtyOptions,
            },
            {
              type: "TextArea",
              name: "note",
              label: s("note"),
              required: false,
              "max-length": 80,
              "helper-text": s("noteHelp"),
            },
            {
              type: "CheckboxGroup",
              name: "sw",
              label: "${data.sw_label}",
              "data-source": "${data.sw_items}",
              visible: "${data.sw_visible}",
              required: false,
            },
            {
              type: "Footer",
              label: "${data.add_label}",
              "on-click-action": {
                name: "data_exchange",
                payload: {
                  go: "add",
                  item: "${data.item_id}",
                  slug: "${data.slug}",
                  r1: "${form.r1}",
                  r2: "${form.r2}",
                  r3: "${form.r3}",
                  r4: "${form.r4}",
                  c1: "${form.c1}",
                  c2: "${form.c2}",
                  c3: "${form.c3}",
                  gw: "${form.gw}",
                  qty: "${form.qty}",
                  note: "${form.note}",
                  sw: "${form.sw}",
                },
              },
            },
          ],
        },
      },
      {
        id: "BASKET",
        title: s("basketTitle"),
        terminal: true,
        data: {
          shop: str("Alo Test Grill"),
          lines_text: str("2× Chicken Shawarma · **$10.00**"),
          remove_items: options([{ id: "l1", title: "2× Chicken Shawarma" }]),
          has_lines: bool(true),
          totals_text: str("Subtotal: $10.00\nDelivery: $2.00\n**Total: $12.00 · 1,074,000 LBP**"),
          confirm_note: str("Confirm sends the summary to the chat."),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextSubheading", text: "${data.shop}" },
            { type: "TextBody", text: "${data.lines_text}", markdown: true },
            {
              type: "CheckboxGroup",
              name: "remove",
              label: s("remove"),
              "data-source": "${data.remove_items}",
              visible: "${data.has_lines}",
              required: false,
            },
            { type: "TextBody", text: "${data.totals_text}", markdown: true },
            { type: "TextCaption", text: "${data.confirm_note}" },
            {
              type: "Footer",
              label: s("confirm"),
              "on-click-action": {
                name: "data_exchange",
                payload: { go: "confirm", remove: "${form.remove}" },
              },
            },
          ],
        },
      },
    ],
  };
}

export const appFlowFile = (lang: Lang) => `${JSON.stringify(appFlow(lang), null, 2)}\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const lang of ["ar", "en"] as const)
    writeFileSync(`whatsapp/flows/app.${lang}.json`, appFlowFile(lang));
  console.log("wrote whatsapp/flows/app.ar.json and app.en.json");
}
