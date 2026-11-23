#!/usr/bin/env node
// TEST1: the WhatsApp catalogue's Meta side, through Kapso's Meta proxy (RUNBOOK "WhatsApp catalog", B and C, done by code where the
// access allows). Run by the `catalog-setup` workflow; never by a model. ACTION:
//   inspect      which Meta business portfolio owns the customer line's WhatsApp account (WABA), the catalogues connected to it, and the
//                number's commerce settings. Reads only.
//   enable_cart  POST /<phone_number_id>/whatsapp_commerce_settings?is_catalog_visible=true&is_cart_enabled=true, then reads them back.
//   sets         one product set per category (filter custom_label_0 = the category's code, named in Arabic), in the display order;
//                a set that already exists by name is left as it is. Needs the catalogue id (input, or settings.catalog.catalog_id).
// Prints Meta's answers with nothing secret in them. Exit 1 when Meta refuses (the summary says what it said).
const { KAPSO_API_KEY, ACTION = "inspect", WABA_ID, PHONE_NUMBER_ID, CATALOG_ID = "", SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const BASE = (process.env.KAPSO_BASE_URL ?? "https://api.kapso.ai/meta/whatsapp/v24.0").replace(/\/+$/, "");
const out = (s) => console.log(s);

async function meta(method, path, body) {
  const r = await fetch(`${BASE}/${path.replace(/^\//, "")}`, { method, headers: { "X-API-Key": KAPSO_API_KEY, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
}
const show = (label, r) => out(`- ${label}: HTTP ${r.status}\n\n\`\`\`json\n${JSON.stringify(r.json, null, 2).slice(0, 3000)}\n\`\`\``);

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function inspect() {
  const waba = await meta("GET", `${WABA_ID}?fields=id,name,owner_business_info,on_behalf_of_business_info,account_review_status,business_verification_status,timezone_id,currency`);
  show("the WhatsApp account (WABA)", waba);
  const owner = waba.json?.owner_business_info, behalf = waba.json?.on_behalf_of_business_info;
  if (owner) out(`- **Owned by the business portfolio "${owner.name}" (id ${owner.id})**${behalf ? `; on behalf of "${behalf.name}" (id ${behalf.id})` : ""}.`);
  show("catalogues connected to the WABA", await meta("GET", `${WABA_ID}/product_catalogs?fields=id,name,vertical,product_count`));
  show("the customer number's commerce settings", await meta("GET", `${PHONE_NUMBER_ID}/whatsapp_commerce_settings`));
}

async function enableCart() {
  const r = await meta("POST", `${PHONE_NUMBER_ID}/whatsapp_commerce_settings?is_catalog_visible=true&is_cart_enabled=true`);
  show("switch on the catalogue icon and the cart", r);
  const now = await meta("GET", `${PHONE_NUMBER_ID}/whatsapp_commerce_settings`);
  show("read back", now);
  const s = now.json?.data?.[0] ?? {};
  if (!(s.is_catalog_visible && s.is_cart_enabled)) throw new Error("the commerce settings do not read back as visible with the cart on");
  out("- **The catalogue is visible on the number and the cart is on.**");
}

async function sets() {
  let id = CATALOG_ID.trim();
  if (!id) id = (await rest("settings?key=eq.catalog&select=value"))[0]?.value?.catalog_id ?? "";
  if (!/^\d{6,20}$/.test(id)) throw new Error("no catalogue id (input catalog_id, or settings.catalog.catalog_id)");
  const cats = await rest("catalog_categories?is_active=eq.true&select=code,name_ar,name_en,sort_order&order=sort_order");
  const have = await meta("GET", `${id}/product_sets?fields=id,name,filter&limit=100`);
  show("the sets already in the catalogue", have);
  if (have.status >= 400) throw new Error("the catalogue's sets cannot be read through Kapso's proxy (the access does not reach the catalogue): make them in Commerce Manager (optional)");
  const names = new Set((have.json?.data ?? []).map((x) => x.name));
  let made = 0;
  for (const c of cats) {
    if (names.has(c.name_ar)) { out(`- ${c.code}: already there`); continue; }
    const r = await meta("POST", `${id}/product_sets`, { name: c.name_ar, filter: JSON.stringify({ custom_label_0: { eq: c.code } }) });
    out(`- ${c.code} (${c.name_en}): HTTP ${r.status}${r.json?.id ? `, set ${r.json.id}` : ` ${JSON.stringify(r.json).slice(0, 200)}`}`);
    if (r.status >= 400) throw new Error(`Meta refused the set for ${c.code}`);
    made++;
  }
  out(`- **${made} set(s) made; ${cats.length} categories.**`);
}

const run = { inspect, enable_cart: enableCart, sets }[ACTION];
if (!run) { console.error(`unknown action ${ACTION}`); process.exit(1); }
run().catch((e) => { out(`- **FAILED: ${e.message}**`); process.exit(1); });
