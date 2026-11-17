// The crown mark. An original drawing for Alo King (session DS1, 15 November 2026): three peaks, three jewels and a band, with
// rounded joins so it stays legible at 32 px. It is always drawn on a tile: gold on ink by default; on paper it becomes ink on
// paper (gold is too light to be seen on paper: 2.3 to 1). Colours come from tokens.css through the classes .tile and .mark;
// the standalone files (packages/ui/crown.svg, the app icons) are written by scripts/build.mjs with the same geometry and the
// token values, so one edit of the tokens changes them all. Waits for the founder's approval (docs/HANDOFF.md, DS1).
import { Raw, attr, html } from "./h";

/** The geometry, on a 64 by 64 grid. `safe` insets the mark for a maskable icon (Android crops to a circle). */
export const CROWN_BODY = "M14.5 41 11 21.5 22.5 29.5 32 14 41.5 29.5 53 21.5 49.5 41Z";
export const CROWN_BAND = { x: 14.5, y: 45, width: 35, height: 5.5, rx: 2 };
export const CROWN_JEWELS = [{ cx: 11, cy: 19, r: 2.6 }, { cx: 32, cy: 11.5, r: 3 }, { cx: 53, cy: 19, r: 2.6 }];

const jewels = CROWN_JEWELS.map((j) => `<circle cx="${j.cx}" cy="${j.cy}" r="${j.r}"/>`).join("");
const band = `<rect x="${CROWN_BAND.x}" y="${CROWN_BAND.y}" width="${CROWN_BAND.width}" height="${CROWN_BAND.height}" rx="${CROWN_BAND.rx}"/>`;
/** The mark alone, as SVG children (no colours). */
export const CROWN_MARK = `<path d="${CROWN_BODY}"/>${band}${jewels}`;

/** `on-gold`: the ink crown on a gold tile (the logo of the design reference, DS2). */
export type CrownTone = "auto" | "on-ink" | "on-paper" | "on-gold" | "bare";
/** Inline crown. `label` is read out; without it the crown is decoration beside a visible name. */
export function crown(opts: { tone?: CrownTone; size?: 32 | 64 | 120; label?: string } = {}): Raw {
  const cls = ["ak-crown", opts.tone && opts.tone !== "auto" ? `ak-crown--${opts.tone}` : "", opts.size ? `ak-crown--${opts.size}` : ""].filter(Boolean).join(" ");
  return html`<svg class="${cls}" viewBox="0 0 64 64"${opts.label ? attr("role", "img") : attr("aria-hidden", "true")}${attr("aria-label", opts.label)}><rect class="tile" width="64" height="64"/><g class="mark">${new Raw(CROWN_MARK)}</g></svg>`;
}

/** The standalone file: explicit colours, for a favicon or an app icon. `inset` shrinks the mark towards the centre (0 to 0.3). */
export function crownFile(o: { tile: string; mark: string; rounded?: boolean; inset?: number }): string {
  const k = 1 - (o.inset ?? 0), t = (32 * (o.inset ?? 0)).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"${o.rounded ? ' rx="14"' : ""} fill="${o.tile}"/>` +
    `<g fill="${o.mark}" stroke="${o.mark}" stroke-width="2.5" stroke-linejoin="round" transform="translate(${t} ${t}) scale(${k})">${CROWN_MARK}</g></svg>`;
}
