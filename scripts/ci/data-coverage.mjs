// Read-only. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. Prints, per data/research file, whether the database already holds
// what the file said and nothing of it is waiting for a person; plus the coverage functions and the name proposals.
import { readdirSync } from "node:fs";
const { SUPABASE_URL: base, SUPABASE_SERVICE_KEY: key } = process.env;
if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
const h = { apikey: key, Authorization: `Bearer ${key}` };
async function all(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: { ...h, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    const page = await r.json(); rows.push(...page); if (page.length < 1000) return rows;
  }
}
async function rpc(name) {
  const r = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: "{}" });
  return r.ok ? await r.json() : `HTTP ${r.status}`;
}
const products = await all("products?select=id,sku&owner_source_id=is.null");
const sku = new Map(products.map((p) => [p.id, p.sku]));
const loads = await all("research_loads?select=product_id,part,outcome");
const images = await all("product_images?select=product_id,status,licence,vision");
const facts = await all("product_facts?select=product_id,source,approved_at,superseded_at,detail&source=eq.web_page");
const labelFacts = await all("product_facts?select=product_id&source=eq.label&approved_at=not.is.null");
const names = await all("product_name_proposals?select=status");

const files = readdirSync("data/research").filter((f) => /^AK-\d+\.json$/.test(f)).map((f) => f.replace(".json", ""));
const by = (rows) => { const m = new Map(); for (const r of rows) { const s = sku.get(r.product_id); if (s) (m.get(s) ?? m.set(s, []).get(s)).push(r); } return m; };
const L = by(loads), I = by(images), F = by(facts), LF = by(labelFacts);
const del = [], pending = [], unapplied = [], notLoaded = [];
for (const s of files) {
  const l = L.get(s) ?? [];
  if (!l.length) { notLoaded.push(s); continue; }
  const imgs = I.get(s) ?? [], fs = F.get(s) ?? [];
  const waitingPic = imgs.some((i) => i.status === "proposed" && (i.vision?.source_file ?? "").includes(`${s}.json`));
  const waitingFact = fs.some((f) => !f.approved_at && !f.superseded_at && (f.detail?.source_file ?? "").includes(`${s}.json`));
  const applied = imgs.some((i) => i.status === "approved") || (LF.get(s) ?? []).length > 0;
  if (waitingPic || waitingFact) pending.push(s); else if (applied) del.push(s); else unapplied.push(s);
}
const out = [];
out.push(`## data/research: ${files.length} files`, `- loaded and applied, nothing waiting (may be deleted): ${del.length}`, `- keep, a proposal still waits for a person: ${pending.length}`,
  `- keep, loaded but nothing approved yet: ${unapplied.length}`, `- keep, not loaded: ${notLoaded.length}`);
out.push("", "DELETE_OK=" + del.join(" "), "", "PENDING=" + pending.join(" "), "", "UNAPPLIED=" + unapplied.join(" "), "", "NOT_LOADED=" + notLoaded.join(" "));
const cnt = {}; for (const n of names) cnt[n.status] = (cnt[n.status] ?? 0) + 1;
out.push("", `## product_name_proposals: ${JSON.stringify(cnt)}`);
for (const f of ["research_load_coverage", "product_image_coverage", "product_data_coverage"]) out.push("", `## ${f}()`, "```json", JSON.stringify(await rpc(f), null, 1), "```");
console.log(out.join("\n"));
