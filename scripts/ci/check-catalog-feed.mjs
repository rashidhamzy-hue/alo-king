#!/usr/bin/env node
// TEST1: proves the WhatsApp catalogue's feed on staging, as Meta reads it (RUNBOOK "WhatsApp catalog", A4). Run by deploy-staging.
//   GET <worker>/catalog/feed.csv as user "meta" with CATALOG_FEED_PASSWORD: 200, the header row Meta expects, one row per item with an
//   approved picture (the database's own count, catalog_feed_report().in_feed), every image_link the item's JPEG copy (…feed.jpg), and
//   three of them fetched (200, image/jpeg). Without the feed password (no repository secret) it says so and passes: nothing to prove.
// Nothing secret is printed. Exit 1 on any failure.
const { WORKER_URL, CATALOG_FEED_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
export const HEADER = "id,title,description,availability,condition,price,link,image_link,brand,product_type,custom_label_0";

/** RFC 4180 rows (quoted cells may hold commas, quotes and newlines). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  if (!CATALOG_FEED_PASSWORD) { console.log("- catalogue feed: not checked (no CATALOG_FEED_PASSWORD repository secret)"); return; }
  const url = `${WORKER_URL}/catalog/feed.csv`;
  const auth = "Basic " + Buffer.from(`meta:${CATALOG_FEED_PASSWORD}`).toString("base64");
  let res;
  for (let i = 0; i < 6; i++) {                       // a fresh deploy and a fresh secret can take a few seconds to answer
    res = await fetch(url, { headers: { Authorization: auth } });
    if (res.status === 200) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (res.status !== 200) throw new Error(`GET /catalog/feed.csv answered ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const wrong = await fetch(url, { headers: { Authorization: "Basic " + Buffer.from("meta:wrong").toString("base64") } });
  if (wrong.status !== 401) throw new Error(`a wrong password got ${wrong.status}, not 401`);
  const rows = parseCsv(await res.text()).filter((r) => r.length > 1);
  const [head, ...items] = rows;
  if (head.join(",") !== HEADER) throw new Error(`header is "${head.join(",")}"`);
  const rpc = async (fn) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST",
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "content-type": "application/json" }, body: "{}" });
    if (!r.ok) throw new Error(`${fn} answered ${r.status}`);
    return r.json();
  };
  const report = await rpc("catalog_feed_report");
  // The database's own list: every active item with an approved picture; the feed carries those whose JPEG copy is made (WEB4b).
  const listed = await rpc("catalog_feed");
  const withJpeg = listed.filter((x) => x.feed_jpeg_path).length;
  const img = head.indexOf("image_link"), link = head.indexOf("link"), avail = head.indexOf("availability");
  if (items.length !== withJpeg) throw new Error(`the feed has ${items.length} items; the database has ${withJpeg} with an approved picture and its JPEG`);
  const notJpeg = items.filter((r) => !/\.feed\.jpg(\?|$)/.test(r[img] ?? ""));
  if (notJpeg.length) throw new Error(`${notJpeg.length} item(s) whose image_link is not the feed JPEG (first: ${notJpeg[0][0]})`);
  const badLink = items.filter((r) => !/^https:\/\/wa\.me\/\d+\?text=/.test(r[link] ?? ""));
  if (badLink.length) throw new Error(`${badLink.length} item(s) whose link is not the wa.me link`);
  const ids = new Set(items.map((r) => r[0]));
  if (ids.size !== items.length) throw new Error("an item id appears twice");
  for (const r of [items[0], items[Math.floor(items.length / 2)], items.at(-1)].filter(Boolean)) {
    const g = await fetch(r[img]);
    const type = g.headers.get("content-type") ?? "";
    if (g.status !== 200 || !type.startsWith("image/jpeg")) throw new Error(`${r[0]}'s picture answered ${g.status} ${type}`);
  }
  const inStock = items.filter((r) => r[avail] === "in stock").length;
  console.log(`- catalogue feed proven: 200 for meta, 401 for a wrong password, the header row, ${items.length} items = every one with an approved picture and its JPEG (${report.in_feed} approved, ${report.in_feed - withJpeg} JPEG(s) still to make)`
    + ` (of ${report.active_products} active), every image_link a feed JPEG (3 fetched: 200 image/jpeg), ${inStock} in stock, wa.me links`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`catalogue feed check FAILED: ${e.message}`); process.exit(1); });
