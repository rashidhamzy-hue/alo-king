// Exports real Kapso webhook payloads that the staging Worker stored (wa_inbound_events) as test fixtures:
//   test/fixtures/kapso/<event>/<message type>-NN.json   (at most 10 per event and message type)
// Real shape, fake people: phone numbers, user ids, names and every URL are replaced by stable fakes, so the same sender
// stays the same fake across files. Nothing else is changed: the point of a fixture is the real structure.
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. Usage: node scripts/ci/export-kapso-fixtures.mjs [outDir]
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const MAX_PER_KIND = 10;
const out = process.argv[2] ?? "test/fixtures/kapso";
const fakes = new Map();
const fake = (kind, v, make) => { const k = kind + "|" + v; if (!fakes.has(k)) fakes.set(k, make(fakes.size + 1)); return fakes.get(k); };
const h = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);

const PHONE_KEYS = new Set(["from", "to", "wa_id", "phone_number", "display_phone_number", "display_phone_number_normalized", "recipient_id", "contacts"]);
const BSUID_KEYS = new Set(["from_user_id", "business_scoped_user_id", "user_id", "recipient"]);
const NAME_KEYS = new Set(["contact_name", "username", "profile_name", "name", "verified_name"]);
const digits = /^\+?\d{8,15}$/;

export function scrub(node, key = "") {
  if (Array.isArray(node)) return node.map((x) => scrub(x, key));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrub(v, k)]));
  if (typeof node !== "string") return node;
  if (/^https?:\/\//i.test(node)) return `https://example.invalid/${h(node)}`;       // media links can carry signed tokens
  if (BSUID_KEYS.has(key) || /^[A-Z]{2}\.\d{10,}$/.test(node)) return fake("bsuid", node, (n) => `XX.${String(n).padStart(18, "0")}`);
  if ((PHONE_KEYS.has(key) && digits.test(node)) || (key === "from" && digits.test(node))) return fake("phone", node.replace(/^\+/, ""), (n) => `9617000${String(n).padStart(4, "0")}`);
  if (NAME_KEYS.has(key) && node && key !== "name") return fake("name", node, (n) => `Test Person ${n}`);
  return node;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/wa_inbound_events?select=line,event,payload,received_at&event=like.whatsapp.*&order=received_at.desc&limit=1000`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`read failed: HTTP ${res.status}`);
  const rows = await res.json();

  const kept = new Map();       // "<event>/<type>" -> payloads, oldest first
  for (const r of rows.reverse()) {
    const first = (r.payload?.batch ? r.payload.data?.[0] : r.payload) ?? {};
    const type = first?.message?.type ?? "event";
    const k = `${r.event}/${type}`;
    const list = kept.get(k) ?? []; if (list.length < MAX_PER_KIND) { list.push({ line: r.line, event: r.event, body: scrub(r.payload) }); kept.set(k, list); }
  }
  if (existsSync(out)) for (const d of readdirSync(out)) if (d.startsWith("whatsapp.")) rmSync(`${out}/${d}`, { recursive: true });
  let files = 0;
  for (const [k, list] of kept) {
    const [event, type] = k.split("/");
    mkdirSync(`${out}/${event}`, { recursive: true });
    list.forEach((f, i) => { writeFileSync(`${out}/${event}/${type}-${String(i + 1).padStart(2, "0")}.json`, JSON.stringify(f, null, 2) + "\n"); files++; });
  }
  const lines = [...kept].map(([k, l]) => `${k}: ${l.length}`).sort();
  console.log(`${files} fixtures from ${rows.length} stored events\n${lines.join("\n")}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
