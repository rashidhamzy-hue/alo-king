// Pure helpers for smart understanding (flow spec item 3): "the usual", voice-note confirmation, saved addresses and location pins.
// No I/O: index.ts does the DB work. Nothing here prices anything; reorders are re-priced server-side and still need Confirm.

export const USUAL = /^\s*(the usual|my usual|usual|as usual|same as usual|the usual please|المعتاد|طلبي المعتاد|نفس (الشي|الشيء) المعتاد|el 3ade|el 3adeh|3ade)\s*[!.،,؟?]*\s*$/i;
export const isUsualRequest = (s: string) => USUAL.test(String(s ?? ""));

type PastOrder = { id: string; vendor_id: string; created_at: string; status?: string | null; items?: unknown };
const signature = (o: PastOrder) => {
  const lines = (Array.isArray(o.items) ? o.items : []).map((l: any) => `${l.item_id}x${Number(l.quantity) || 1}`).sort();
  return `${o.vendor_id}::${lines.join(",")}`;
};
/** The customer's "usual": the basket (vendor + dishes + quantities) they ordered most often; ties and the returned instance go to the most recent. */
export function pickUsual(orders: PastOrder[]): PastOrder | null {
  const live = orders.filter((o) => !["cancelled", "rejected"].includes(String(o.status ?? "")) && Array.isArray(o.items) && o.items.length);
  const groups = new Map<string, PastOrder[]>();
  for (const o of live) { const k = signature(o); groups.set(k, [...(groups.get(k) ?? []), o]); }
  let best: PastOrder[] | null = null;
  const newest = (g: PastOrder[]) => g.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  for (const g of groups.values()) if (!best || g.length > best.length || (g.length === best.length && newest(g).created_at > newest(best).created_at)) best = g;
  return best ? newest(best) : null;
}

// ---- voice notes: the transcript is shown back and only acted on after the customer taps Yes ----
export const voiceTapId = (answer: "ok" | "no", id: string) => `VOICE|${answer}|${id}`;
export function parseVoiceTap(id: string): { answer: "ok" | "no"; id: string } | null {
  const p = id.split("|");
  return p.length === 3 && p[0] === "VOICE" && (p[1] === "ok" || p[1] === "no") && p[2] ? { answer: p[1], id: p[2] } : null;
}
export const voiceCardText = (transcript: string, ar: boolean) => {
  const t = String(transcript).replace(/\s+/g, " ").trim().slice(0, 500);
  return ar ? `🎙️ سمعت:\n“${t}”\n\nهيك صح؟` : `🎙️ I heard:\n“${t}”\n\nIs that right?`;
};

// ---- addresses and location pins ----
const norm = (s: string) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** De-duplication key: same village+landmark, or pins within ~10 m. */
export const addrKey = (village: string, landmark: string, lat?: number | null, lng?: number | null) =>
  lat != null && lng != null ? `pin:${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}` : `${norm(village)}|${norm(landmark)}`;
export const mapsLink = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;
/** The landmark text the customer typed earlier (same village, map link stripped) so a shared pin adds to it instead of replacing it; null when there is none worth keeping. */
function keptLandmark(prev: { village?: string | null; address?: string | null } | null | undefined, village: string): string | null {
  if (!prev?.address || String(prev.village ?? "").trim().toLowerCase() !== village.trim().toLowerCase()) return null;
  const text = String(prev.address).replace(/\s*\(?https?:\/\/\S+\)?\s*$/, "").replace(/\s+/g, " ").trim();
  return text.length > 3 && text.toLowerCase() !== village.trim().toLowerCase() ? text : null;
}
export function pinnedLandmark(loc: { latitude: number; longitude: number; address?: string | null; name?: string | null }, village: string, prev?: { village?: string | null; address?: string | null } | null): string {
  const link = mapsLink(Number(loc.latitude), Number(loc.longitude));
  const text = String(keptLandmark(prev, village) || loc.address || loc.name || village || "Pinned location").replace(/\s+/g, " ").trim();
  const room = 200 - link.length - 3; // "text (link)"
  return `${text.slice(0, Math.max(0, room))} (${link})`.slice(0, 200);
}
export type SavedAddress = { id: string; label?: string | null; village?: string | null; landmark?: string | null; last_used_at: string };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export function addressRows(saved: SavedAddress[], ar: boolean, basketId?: string) {
  const suffix = basketId ? `|${basketId}` : "";
  const rows = [...saved].sort((a, b) => b.last_used_at.localeCompare(a.last_used_at)).slice(0, 9).map((a) => ({
    id: `ADDR|${a.id}${suffix}`, title: clip(a.label || a.village || "Address", 24), description: clip(String(a.landmark ?? "").replace(/\s*\(https?:\/\/\S+\)\s*$/, ""), 72) || undefined,
  }));
  return [...rows, { id: `ADDR|new${suffix}`, title: ar ? "➕ عنوان جديد" : "➕ New address", description: ar ? "اكتبلي العنوان أو شاركني موقعك" : "Type it or share your location" }];
}
export function parseAddrTap(id: string): { id: string; basketId: string | null } | null {
  const p = id.split("|");
  return (p.length === 2 || p.length === 3) && p[0] === "ADDR" && p[1] && (p.length === 2 || p[2]) ? { id: p[1], basketId: p[2] ?? null } : null;
}
