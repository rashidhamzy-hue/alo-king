// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens`
// workflow (action shoot, this test file, session cx2) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// CX2 stage 1: every customer message of test/screens/cx2-messages.ts, before and after, drawn as WhatsApp draws it (the chat, the bubble, its
// buttons, a list message with its rows opened under it, the location button), at 390 px, Arabic and English. Files `cx2-<message>-<before|after>-390-<lang>.png`.
// Skipped unless SCREENS names a folder (it needs Playwright's Chromium):  SCREENS=/tmp/shots/cx2 npx vitest run test/screens/cx2.test.ts
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LS, screens, type Bubble, type L } from "./cx2-messages";

const OUT = process.env.SCREENS;
const font = (pkg: string, file: string) => readFileSync(fileURLToPath(new URL(`../../node_modules/@fontsource/${pkg}/files/${file}`, import.meta.url))).toString("base64");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** WhatsApp's own formatting: *bold*, _italic_, ~strike~, ```mono```; each line takes its own direction, as WhatsApp does. */
export function waHtml(text: string): string {
  return text.split("\n").map((line) => {
    const h = esc(line).replace(/```([^`]+)```/g, "<code>$1</code>").replace(/(^|[\s(«“])\*([^*\n]+)\*(?=$|[\s.,:;!?)»”؟،])/gu, "$1<b>$2</b>")
      .replace(/(^|[\s(«“])_([^_\n]+)_(?=$|[\s.,:;!?)»”؟،])/gu, "$1<i>$2</i>").replace(/(^|\s)~([^~\n]+)~(?=$|\s)/gu, "$1<s>$2</s>");
    return `<div class="ln" dir="auto">${h || "&nbsp;"}</div>`;
  }).join("");
}

function page(bubbles: Bubble[], lang: L, label: string): string {
  const rtl = lang === "ar";
  const time = (i: number) => `09:${String(12 + i).padStart(2, "0")}`;
  const body = bubbles.map((b, i) => {
    const tick = b.them ? `<span class="tick">✓✓</span>` : "";
    const main = `<div class="bubble ${b.them ? "them" : "us"}">${b.template ? `<div class="tpl">template</div>` : ""}<div class="txt">${waHtml(b.body)}</div>
      ${b.list ? `<div class="listbtn" dir="auto">☰ ${esc(b.list.button)}</div>` : ""}<div class="time">${time(i)} ${tick}</div></div>`;
    const btns = b.buttons?.length ? `<div class="btns">${b.buttons.map((t) => `<div class="btn" dir="auto">${esc(t)}</div>`).join("")}</div>` : "";
    const loc = b.location ? `<div class="btns"><div class="btn" dir="auto">📍 ${esc(b.location)}</div></div>` : "";
    const sheet = b.list ? `<div class="sheet"><div class="sheet-h" dir="auto">${esc(b.list.button)}</div>${b.list.rows.map((r) =>
      `<div class="row"><div class="rt" dir="auto">${esc(r.title)}</div>${r.description ? `<div class="rd" dir="auto">${esc(r.description)}</div>` : ""}<span class="radio"></span></div>`).join("")}</div>` : "";
    return `<div class="msg ${b.them ? "right" : "left"}">${main}${btns}${loc}${sheet}</div>`;
  }).join("");
  return `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>
    @font-face { font-family: Plex; src: url(data:font/woff2;base64,${font("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2")}) format("woff2"); font-weight: 400; }
    @font-face { font-family: Plex; src: url(data:font/woff2;base64,${font("ibm-plex-sans", "ibm-plex-sans-latin-700-normal.woff2")}) format("woff2"); font-weight: 700; }
    @font-face { font-family: PlexAr; src: url(data:font/woff2;base64,${font("ibm-plex-sans-arabic", "ibm-plex-sans-arabic-arabic-400-normal.woff2")}) format("woff2"); font-weight: 400; }
    @font-face { font-family: PlexAr; src: url(data:font/woff2;base64,${font("ibm-plex-sans-arabic", "ibm-plex-sans-arabic-arabic-700-normal.woff2")}) format("woff2"); font-weight: 700; }
    * { box-sizing: border-box; } body { margin: 0; background: #EFEAE2; font: 15px/1.38 Plex, PlexAr, "Noto Color Emoji", sans-serif; color: #111B21; }
    .bar { background: #008069; color: #fff; padding: 12px 14px; display: flex; gap: 10px; align-items: center; }
    .av { width: 34px; height: 34px; border-radius: 50%; background: #C9A227; color: #0E0F12; display: grid; place-items: center; font-weight: 700; }
    .nm { font-weight: 700; } .sub { font-size: 12px; opacity: .85; } .tag { margin-inline-start: auto; font-size: 11px; background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 10px; }
    .chat { padding: 12px 10px 24px; display: flex; flex-direction: column; gap: 8px; }
    .msg { display: flex; flex-direction: column; max-width: 88%; gap: 3px; } .left { align-self: flex-start; } .right { align-self: flex-end; }
    .bubble { background: #fff; border-radius: 8px; padding: 6px 8px 4px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
    .them { background: #D9FDD3; } .txt { overflow-wrap: anywhere; } .ln { min-height: 1em; unicode-bidi: plaintext; }
    .time { font-size: 11px; color: #667781; text-align: end; margin-top: 2px; } .tick { color: #53BDEB; }
    .tpl { font-size: 11px; color: #667781; margin-bottom: 2px; }
    code { font-family: monospace; font-size: 13px; }
    .btns { display: flex; flex-direction: column; gap: 3px; } .btn { background: #fff; border-radius: 8px; text-align: center; padding: 9px; color: #027EB5; font-weight: 500; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
    .listbtn { border-top: 1px solid #E9EDEF; margin-top: 6px; padding-top: 8px; text-align: center; color: #027EB5; }
    .sheet { background: #fff; border-radius: 12px; margin-top: 6px; box-shadow: 0 2px 6px rgba(11,20,26,.2); overflow: hidden; }
    .sheet-h { padding: 10px 14px; font-weight: 700; border-bottom: 1px solid #E9EDEF; text-align: center; }
    .row { position: relative; padding: 9px 44px 9px 14px; border-bottom: 1px solid #F0F2F5; } [dir=rtl] .row { padding: 9px 14px 9px 44px; }
    .rt { font-weight: 500; } .rd { font-size: 13px; color: #667781; }
    .radio { position: absolute; inset-inline-end: 14px; top: 50%; width: 18px; height: 18px; margin-top: -9px; border: 2px solid #8696A0; border-radius: 50%; }
  </style></head><body><div class="bar"><div class="av">A</div><div><div class="nm">Alo King</div><div class="sub">${rtl ? "حساب أعمال" : "Business account"}</div></div><div class="tag">${esc(label)}</div></div>
  <div class="chat">${body}</div></body></html>`;
}

describe.skipIf(!OUT)("CX2 screenshots: every customer message, before and after, as WhatsApp shows it", () => {
  it("draws them", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
    mkdirSync(OUT!, { recursive: true });
    const browser = await chromium.launch();
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    let n = 0;
    for (const s of screens()) for (const lang of LS) for (const when of ["before", "after"] as const) {
      const label = `${when === "before" ? (lang === "ar" ? "قبل" : "Before") : (lang === "ar" ? "بعد" : "After")} · ${s.key}`;
      await pg.setContent(page(s[when][lang], lang, label), { waitUntil: "load" });
      await pg.evaluate(() => document.fonts.ready);
      const h = await pg.evaluate(() => document.body.scrollHeight);
      expect(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${s.key} ${lang} ${when}`).toBe(true);
      await pg.screenshot({ path: join(OUT!, `cx2-${s.key}-${when}-390-${lang}.png`), clip: { x: 0, y: 0, width: 390, height: Math.min(Math.max(h, 300), 4000) } });
      n++;
    }
    await browser.close();
    expect(n).toBe(screens().length * 4);
  }, 300_000);
});
