// Builds webhook fixtures from REAL Kapso message objects (task 4.1).
//
// Why this exists: the staging Worker has stored no real webhook yet (wa_inbound_events holds only smoke tests on 13 Nov),
// but the customer number carried real traffic in October, and Kapso's message API returns those messages in the same
// v2 message shape its webhooks carry (docs: platform/webhooks/message-events, "message.kapso" block). So:
//   - `message` is the real object from GET /whatsapp/messages, people replaced by fakes;
//   - the envelope around it (`conversation`, `is_new_conversation`, top-level `phone_number_id`) follows Kapso's
//     documented webhook payload, filled from the message's own fields.
// When real webhook captures exist (`capture-kapso-fixtures` workflow), they sit beside these with source "webhook".
//
// Usage: node scripts/fixtures/from-kapso-messages.mjs <inbound.json> <outbound.json> [outDir]
//   (each input is the JSON body of GET /platform/v1/whatsapp/messages, i.e. { data: [...] })
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const [inFile, outFile, outDir = "test/fixtures/kapso"] = process.argv.slice(2);
const MAX = 10;
const h = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);
const fakes = new Map();
const fake = (kind, v, make) => { const k = `${kind}|${v}`; if (!fakes.has(k)) fakes.set(k, make([...fakes.keys()].filter((x) => x.startsWith(kind + "|")).length + 1)); return fakes.get(k); };

// Our own business numbers are not personal data, and the parser needs them to route; everything else that looks like a person is replaced.
const OURS = new Set(["12036602328", "1378974041965966", "597907523413541", "1086076707594153"]);
const PHONE = /\+?\b\d{9,15}\b/g;
const BSUID = /\b[A-Z]{2}\.\d{10,}\b/g;
const URL_RE = /https?:\/\/[^\s"]+/g;
const SYNTH_TEXT = ["بدي ٢ ربطة خبز وكيلو بندورة", "عندكن حليب؟", "Order food", "قديش التوصيل عالباروك؟", "زيدلي علبة لبنة", "شكراً"];
const SYNTH_VOICE = ["بدي كيس خبز ومي", "جيبلي ٣ قناني مي كبار", "عندكن جبنة عكاوي؟"];

const phone = (p) => (OURS.has(p.replace(/^\+/, "")) ? p : fake("phone", p.replace(/^\+/, ""), (n) => `9617000${String(n).padStart(4, "0")}`));
const bsuid = (b) => fake("bsuid", b, (n) => `XX.${String(n).padStart(16, "0")}`);
function scrubString(s) {
  return s.replace(URL_RE, (u) => `https://example.invalid/${h(u)}`).replace(BSUID, bsuid).replace(PHONE, (p) => phone(p));
}
const NAME_KEYS = new Set(["contact_name", "profile_name", "display_name", "username"]);
function scrub(node, key = "") {
  if (Array.isArray(node)) return node.map((x) => scrub(x, key));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrub(v, k)]));
  if (typeof node !== "string") return node;
  if (NAME_KEYS.has(key)) return fake("name", node, (n) => `Test Person ${n}`);
  if (key === "sha256" || key === "hash") return h(node);
  if (key === "timestamp") return node;                                   // epoch seconds look like phone numbers; they are not
  if (node.startsWith("wamid.")) return fake("wamid", node, () => `wamid.TEST${h(node).toUpperCase()}`);   // a wamid encodes the sender's number
  if (key === "whatsapp_conversation_id" || (key === "id" && /^[0-9a-f-]{36}$/.test(node))) return fake("conv", node, (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (key === "id" && /^\d{10,}$/.test(node) && !OURS.has(node)) return fake("media", node, (n) => `${900000000000000 + n}`);
  return scrubString(node);
}

/** Free text a real person wrote or said is replaced by a synthetic line; the structure around it stays. */
function replaceSpeech(m, i) {
  const swap = (from, to) => { if (m.kapso?.content && from) m.kapso.content = m.kapso.content.split(from).join(to); };
  if (m.text?.body && m.kapso?.direction === "inbound") { const t = SYNTH_TEXT[i % SYNTH_TEXT.length]; swap(m.text.body, t); m.text.body = t; }
  if (m.kapso?.transcript?.text) { const t = SYNTH_VOICE[i % SYNTH_VOICE.length]; swap(m.kapso.transcript.text, t); m.kapso.transcript.text = t; }
  if (m.kapso?.direction === "outbound" && m.text?.body) { const t = "رسالة صادرة (نص مستبدل)"; m.kapso.content = t; m.text.body = t; }
  return m;
}

/** The documented v2 envelope around a real message. */
function envelope(m, isNew) {
  const k = m.kapso ?? {};
  const counterpart = k.direction === "inbound" ? m.from : m.to;
  const bs = m.from_user_id ?? k.statuses?.find((s) => s.recipient_user_id)?.recipient_user_id ?? null;
  return {
    message: m,
    conversation: {
      id: k.whatsapp_conversation_id, contact_name: k.contact_name ?? null, phone_number: counterpart ?? k.phone_number ?? null,
      business_scoped_user_id: bs, status: "active", phone_number_id: k.phone_number_id,
    },
    is_new_conversation: isNew,
    phone_number_id: k.phone_number_id,
  };
}

const lineOf = (pnid) => (pnid === "597907523413541" ? "ops" : "customer");
const load = (f) => JSON.parse(readFileSync(f, "utf8")).data ?? [];
const kept = new Map();
const keep = (event, kind, line, body) => { const k = `${event}/${kind}`; const l = kept.get(k) ?? []; if (l.length < MAX) { l.push({ line, event, source: "kapso-message-api", body }); kept.set(k, l); } };

let i = 0;
for (const raw of load(inFile).reverse()) {
  const m = replaceSpeech(structuredClone(raw), i++);
  const kind = m.type === "interactive" ? m.interactive?.type ?? "interactive" : m.type;
  keep("whatsapp.message.received", kind, lineOf(m.kapso?.phone_number_id), scrub(envelope(m, i === 1)));
}
for (const raw of load(outFile).reverse()) {
  const m = replaceSpeech(structuredClone(raw), i++);
  const event = `whatsapp.message.${m.kapso?.status ?? "sent"}`;   // the last status Kapso holds is the event it last fired
  keep(event, m.type, lineOf(m.kapso?.phone_number_id), scrub(envelope(m, false)));
}

if (existsSync(outDir)) for (const d of readdirSync(outDir)) if (d.startsWith("whatsapp.")) for (const f of readdirSync(`${outDir}/${d}`)) if (f.startsWith("api-")) rmSync(`${outDir}/${d}/${f}`);
let n = 0;
for (const [k, list] of kept) {
  const [event, kind] = k.split("/");
  mkdirSync(`${outDir}/${event}`, { recursive: true });
  list.forEach((f, j) => { writeFileSync(`${outDir}/${event}/api-${kind}-${String(j + 1).padStart(2, "0")}.json`, JSON.stringify(f, null, 2) + "\n"); n++; });
}
console.log(`${n} fixtures\n${[...kept].map(([k, l]) => `${k}: ${l.length}`).sort().join("\n")}`);
