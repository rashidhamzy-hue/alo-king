// The product image of a catalogue item that has no photo (DECISIONS §39.12): a square tile with the item's name in Arabic
// and English and the shop's name, in the brand's ink and gold. Meta needs an image for every product; the shop's own
// confirmed photo is used instead whenever one exists (§38.1). Pure: builds the SVG only; dispatch renders it to PNG.

export const TILE = 600;
const INK = "#15110a";
const GOLD = "#d4af37";
const CREAM = "#f6efdc";
const ARABIC = /[؀-ۿ]/;

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const clip = (s: string, n: number) => {
  const a = Array.from(s.trim());
  return a.length > n ? `${a.slice(0, n - 1).join("")}…` : a.join("");
};

/** Splits a name into at most two lines of about `width` characters. */
export function wrap(s: string, width: number): string[] {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (Array.from(`${cur} ${w}`).length <= width) cur = `${cur} ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) return [lines[0], clip(lines.slice(1).join(" "), width)];
  return lines.map((l) => clip(l, width));
}

function text(y: number, s: string, size: number, fill: string, bold = false) {
  const rtl = ARABIC.test(s);
  return `<text x="${TILE / 2}" y="${y}" font-size="${size}" fill="${fill}"${bold ? ' font-weight="700"' : ""} text-anchor="middle"${rtl ? ' direction="rtl" unicode-bidi="embed"' : ""} font-family="Noto Naskh Arabic, Noto Sans">${esc(s)}</text>`;
}

export function catalogTileSvg(d: {
  name_ar?: string | null;
  name_en?: string | null;
  vendor?: string | null;
  vendor_ar?: string | null;
}): string {
  const main = wrap(String(d.name_ar || d.name_en || "Alo King"), 16);
  const second = d.name_ar && d.name_en && d.name_en !== d.name_ar ? wrap(d.name_en, 24) : [];
  const shop = clip(String(d.vendor || d.vendor_ar || ""), 30);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect width="${TILE}" height="${TILE}" fill="${INK}"/>`,
    `<rect x="24" y="24" width="${TILE - 48}" height="${TILE - 48}" rx="28" fill="none" stroke="${GOLD}" stroke-width="3"/>`,
    // The crown mark, drawn as three points over a band.
    `<path d="M255 120 L270 80 L285 108 L300 70 L315 108 L330 80 L345 120 Z" fill="${GOLD}"/>`,
    `<rect x="255" y="124" width="90" height="10" rx="3" fill="${GOLD}"/>`,
  ];
  let y = main.length > 1 ? 250 : 285;
  for (const l of main) {
    parts.push(text(y, l, 56, CREAM, true));
    y += 70;
  }
  y += 5;
  for (const l of second) {
    parts.push(text(y, l, 34, GOLD));
    y += 44;
  }
  if (shop) parts.push(text(530, shop, 28, CREAM));
  parts.push("</svg>");
  return parts.join("");
}
