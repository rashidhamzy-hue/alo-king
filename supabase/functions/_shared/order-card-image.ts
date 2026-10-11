// The visual order card (DECISIONS §32.5): a gold card image sent with the order confirmation (and, once
// they exist, merchant statements), showing the items and the total in USD and LBP at the rate locked on the
// order. This module builds the SVG only; the dispatch function renders it to PNG (resvg) with the bundled
// Noto fonts. Every number comes from the server (order_card_image); nothing is computed here but layout.
// Pure: runs under vitest and Deno.

export type OrderCardImage = {
  code: string;
  vendor_ar?: string | null;
  vendor_en?: string | null;
  lines: { name_ar?: string | null; name_en?: string | null; quantity: number; line_usd: number | string }[];
  subtotal_usd?: number | string | null;
  delivery_fee_usd?: number | string | null;
  extras_usd?: number | string | null;
  total_usd: number | string;
  total_lbp: number | string;
  usd_lbp_rate: number | string;
  estimated?: boolean;
  same_price?: boolean;
};

export const CARD_WIDTH = 1080;
export const CARD_MAX_LINES = 12;
const GOLD = "#d4af37";
const GOLD_LIGHT = "#f3e3a6";
const INK = "#15110a";
const ARABIC = /[؀-ۿ]/;

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const clip = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);
const usd = (v: unknown) => `$${Number(v ?? 0).toFixed(2)}`;
const lbp = (v: unknown) => Math.round(Number(v ?? 0)).toLocaleString("en-US");

/** One text element; Arabic is right-aligned and laid out right to left. */
function txt(x: number, y: number, s: string, size: number, fill: string, opts: { anchor?: "start" | "end" | "middle"; bold?: boolean } = {}) {
  const rtl = ARABIC.test(s);
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${opts.bold ? ' font-weight="700"' : ""} text-anchor="${opts.anchor ?? "start"}"${rtl ? ' direction="rtl" unicode-bidi="embed"' : ""} font-family="Noto Naskh Arabic, Noto Sans">${esc(s)}</text>`;
}

/** The card as an SVG document, in the customer's language ("ar" puts Arabic names first). */
export function orderCardSvg(d: OrderCardImage, lang: "ar" | "en" = "ar"): string {
  const ar = lang === "ar";
  const lines = d.lines.slice(0, CARD_MAX_LINES);
  const more = d.lines.length - lines.length;
  const W = CARD_WIDTH;
  const pad = 72;
  const rowH = 58;
  const top = 250;
  const listH = (lines.length + (more > 0 ? 1 : 0)) * rowH;
  const H = top + listH + 400 + (d.same_price ? 60 : 0) + (d.estimated ? 50 : 0);
  const name = (l: OrderCardImage["lines"][number]) => clip(String((ar ? l.name_ar : l.name_en) ?? l.name_ar ?? l.name_en ?? ""), 34);
  const vendor = String((ar ? d.vendor_ar : d.vendor_en) ?? d.vendor_ar ?? d.vendor_en ?? "");
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${INK}"/>`,
    `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="36" fill="none" stroke="${GOLD}" stroke-width="6"/>`,
    txt(W / 2, 120, "Alo King · ألو كينغ", 52, GOLD, { anchor: "middle", bold: true }),
    txt(W / 2, 185, `${clip(vendor, 40)} · #${d.code}`, 36, GOLD_LIGHT, { anchor: "middle" }),
    `<line x1="${pad}" y1="215" x2="${W - pad}" y2="215" stroke="${GOLD}" stroke-width="2"/>`,
  ];
  lines.forEach((l, i) => {
    const y = top + 40 + i * rowH;
    const label = `${Math.max(1, Math.trunc(Number(l.quantity) || 1))} × ${name(l)}`;
    // Arabic: the item on the right, the price on the left; English the other way round.
    if (ar) {
      out.push(txt(W - pad, y, label, 34, GOLD_LIGHT, { anchor: "end" }));
      out.push(txt(pad, y, usd(l.line_usd), 34, GOLD_LIGHT));
    } else {
      out.push(txt(pad, y, label, 34, GOLD_LIGHT));
      out.push(txt(W - pad, y, usd(l.line_usd), 34, GOLD_LIGHT, { anchor: "end" }));
    }
  });
  if (more > 0)
    out.push(txt(ar ? W - pad : pad, top + 40 + lines.length * rowH, ar ? `+ ${more} أصناف كمان` : `+ ${more} more items`, 30, GOLD, { anchor: ar ? "end" : "start" }));
  let y = top + listH + 40;
  out.push(`<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="${GOLD}" stroke-width="2"/>`);
  const fee = Number(d.delivery_fee_usd ?? 0) + Number(d.extras_usd ?? 0);
  if (fee > 0) {
    y += 55;
    out.push(txt(ar ? W - pad : pad, y, ar ? "توصيل وإضافات" : "Delivery and extras", 30, GOLD_LIGHT, { anchor: ar ? "end" : "start" }));
    out.push(txt(ar ? pad : W - pad, y, usd(fee), 30, GOLD_LIGHT, { anchor: ar ? "start" : "end" }));
  }
  y += 95;
  out.push(txt(W / 2, y, usd(d.total_usd), 76, GOLD, { anchor: "middle", bold: true }));
  y += 70;
  out.push(txt(W / 2, y, `${lbp(d.total_lbp)} LBP`, 44, GOLD_LIGHT, { anchor: "middle" }));
  y += 55;
  out.push(
    txt(W / 2, y, ar ? `سعر الصرف ${lbp(d.usd_lbp_rate)} ل.ل. · مثبّت عالطلب` : `Rate ${lbp(d.usd_lbp_rate)} LBP/USD · locked at order`, 28, GOLD, {
      anchor: "middle",
    }),
  );
  if (d.estimated) {
    y += 50;
    out.push(txt(W / 2, y, ar ? "تقديري لحد ما ينوزن" : "Estimated until weighed", 28, GOLD_LIGHT, { anchor: "middle" }));
  }
  if (d.same_price) {
    y += 60;
    out.push(txt(W / 2, y, ar ? "نفس سعر المحل" : "Same price as in the shop", 30, GOLD, { anchor: "middle", bold: true }));
  }
  out.push("</svg>");
  return out.join("\n");
}

/** The WhatsApp image message for a rendered card (uploaded media id). */
export function orderCardImageMessage(to: string, mediaId: string, code: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "image",
    image: { id: mediaId, caption: `#${code}` },
  };
}
