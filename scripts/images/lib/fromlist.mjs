// "From list" mode (session PIX2): candidates found by a person or by research, one picture address and the page it sits on per item.
// File: data/pictures/candidates.csv with columns sku, image_url, page_url, found_at. Several rows for one sku are tried in order.
// The same checks as the search runs apply to every picture (size, pack, watermark, duplicates); this file only says where to look.
import { hostOf, onDomain } from "./licence.mjs";

function csvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}

/** Open Food Facts pages keep their CC BY-SA licence and attribution; every other public page is filed as public_page (docs/DECISIONS.md, 14 Nov). */
export function kindFor(pageUrl) {
  return onDomain(hostOf(pageUrl), "openfoodfacts.org") ? "open_food_facts" : "public_page";
}

/** CSV text -> Map(sku -> [{ imageUrl, pageUrl, foundAt, sourceKind, attribution }]). Rows without an https picture and page are dropped and counted. */
export function parseCandidates(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  const head = csvLine(lines[0] ?? "").map((h) => h.trim());
  const col = (n) => head.indexOf(n);
  const [iSku, iImg, iPage, iAt] = ["sku", "image_url", "page_url", "found_at"].map(col);
  if ([iSku, iImg, iPage].some((i) => i < 0)) throw new Error("candidates.csv needs the columns sku, image_url, page_url (found_at is recorded when present)");
  const bySku = new Map(); let dropped = 0;
  for (const l of lines.slice(1)) {
    const c = csvLine(l).map((x) => x.trim());
    const sku = c[iSku]; const imageUrl = c[iImg]; const pageUrl = c[iPage];
    if (!sku || !/^https:\/\//.test(imageUrl ?? "") || !/^https:\/\//.test(pageUrl ?? "")) { dropped++; continue; }
    const kind = kindFor(pageUrl);
    const row = { imageUrl, pageUrl, foundAt: iAt >= 0 && c[iAt] ? c[iAt] : null, sourceKind: kind, attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null };
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(row);
  }
  return { bySku, dropped };
}
