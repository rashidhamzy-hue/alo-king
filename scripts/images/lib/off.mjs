// Open Food Facts, by barcode (5.17 step 2). Pictures are CC BY-SA: the attribution travels with them.
import { fetchRetry } from "./http.mjs";

export const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
export const OFF_IMAGES = "https://images.openfoodfacts.org/images/products";

/** 3017620422003 -> 301/762/042/2003. Codes of 8 digits or fewer are used as they are. */
export function offFolder(code) {
  const c = String(code).replace(/\D/g, "");
  if (c.length <= 8) return c;
  const p = c.padStart(13, "0");
  return `${p.slice(0, 3)}/${p.slice(3, 6)}/${p.slice(6, 9)}/${p.slice(9)}`;
}

const full = (u) => String(u).replace(/\.(100|200|400)\.jpg$/, ".full.jpg");

/** Up to `max` picture addresses for one product, front pictures first, full size where Open Food Facts has it. */
export function offCandidates(code, product, max = 5) {
  const base = `${OFF_IMAGES}/${offFolder(code)}`;
  const page = `https://world.openfoodfacts.org/product/${String(code).replace(/\D/g, "")}`;
  const urls = [];
  const add = (u) => { if (u && /^https:\/\//.test(u) && !urls.includes(u)) urls.push(u); };
  const display = product?.selected_images?.front?.display;
  if (display && typeof display === "object") for (const u of Object.values(display)) add(full(u));
  add(product?.image_front_url ? full(product.image_front_url) : null);
  const images = product?.images && typeof product.images === "object" ? product.images : {};
  for (const [key, v] of Object.entries(images)) {
    if (/^front_/.test(key) && v?.rev) add(`${base}/${key}.${v.rev}.full.jpg`);
  }
  // Other uploads (any side of the pack): the vision check decides. Only the ones big enough to pass.
  for (const [key, v] of Object.entries(images)) {
    if (/^\d+$/.test(key) && Number(v?.sizes?.full?.w) >= 800) add(`${base}/${key}.jpg`);
  }
  const attribution = `Open Food Facts contributors, CC BY-SA 3.0, ${page}`;
  return urls.slice(0, max).map((imageUrl) => ({ sourceKind: "open_food_facts", imageUrl, pageUrl: page, attribution }));
}

export async function offLookup(code, { fetchImpl = fetch, wait = async () => {}, max = 5 } = {}) {
  const c = String(code ?? "").replace(/\D/g, "");
  if (c.length < 6) return { found: false, candidates: [] };
  await wait();
  const res = await fetchRetry(`${OFF_API}/${c}.json?fields=code,product_name,brands,quantity,images,selected_images,image_front_url`, {}, { fetchImpl });
  if (res.status === 404) return { found: false, candidates: [] };
  if (!res.ok) throw new Error(`off_http_${res.status}`);
  const body = await res.json();
  if (body?.status === 0 || !body?.product) return { found: false, candidates: [] };
  return { found: true, candidates: offCandidates(c, body.product, max) };
}
