// The design system (session DS1, packages/ui): the tokens pass AA in both themes, both themes define the same roles, the generated
// files are the ones the sources give, the components escape what they are given and write no inline style or script, the crown is
// one drawing everywhere, and the fonts are our own files.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrast } from "@ak/ui/contrast";
import { CONTRAST_PAIRS, gallery } from "@ak/ui/gallery";
import { DARK, LIGHT } from "@ak/ui/tokens.generated";
import { badge, button, caseRow, dataTable, kpiTile, limitBar, productCard, sparkline, timerChip, timerState, TIMER_AMBER_SHARE } from "@ak/ui/components";
import { crown, crownFile, CROWN_BODY } from "@ak/ui/crown";
import { html } from "@ak/ui/h";
import { UI_CSS, UI_TOKENS } from "../../apps/console/src/ui.generated";
import { DICTS } from "../../apps/web/src/lib/i18n";
import { FONTS } from "../../apps/console/src/fonts.generated";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

describe("tokens", () => {
  it("every pair a page uses passes WCAG AA, in light and in dark", () => {
    for (const [name, T] of [["light", LIGHT], ["dark", DARK]] as const) for (const p of CONTRAST_PAIRS) {
      const r = contrast(T[p.fg]!, T[p.bg]!);
      expect(r, `${name}: ${p.fg} on ${p.bg} (${p.use}) is ${r.toFixed(2)}, needs ${p.min}`).toBeGreaterThanOrEqual(p.min);
    }
  });
  it("gold is never small text on paper: it fails there, and gold-deep is what passes", () => {
    expect(contrast(LIGHT.gold!, LIGHT.paper!)).toBeLessThan(3);
    expect(contrast(LIGHT["gold-deep"]!, LIGHT.paper!)).toBeGreaterThanOrEqual(4.5);
    expect(LIGHT.accent).toBe(LIGHT["gold-deep"]);
  });
  it("the brand is the decided ink, paper and gold, and green is only the ok colour", () => {
    expect(LIGHT).toMatchObject({ ink: "#0E0F12", "ink-soft": "#2A2D34", paper: "#FAF8F3", gold: "#C9A227", ok: "#14663B", warn: "#9A4D00", danger: "#A8231B" });
    expect(UI_TOKENS).toEqual({ ink: LIGHT.ink, paper: LIGHT.paper, gold: LIGHT.gold });
    const greenish = (hex: string) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return g > r + 24 && g > b + 16; };
    // DS2: WhatsApp green is the one other green, and only for a WhatsApp action (docs/DECISIONS.md, "Design reference, 17 November 2026")
    // WEB4a: the example WhatsApp chat on the home page is a picture of WhatsApp, drawn in its own colours (whatsapp-chat-*)
    for (const T of [LIGHT, DARK]) for (const [k, v] of Object.entries(T)) if (greenish(v)) expect(k, `${k} ${v} is green`).toMatch(/^(ok|whatsapp$|whatsapp-chat-)/);
    expect(LIGHT).toMatchObject({ "gold-deep": "#8A6A12", whatsapp: "#25D366" });
  });
  it("the dark theme is written twice (the system's choice and the console's switch) with the same values, and defines every role it changes", () => {
    const css = read("packages/ui/tokens.css");
    const media = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(css)![1]!;
    const attr = /:root\[data-theme="dark"\] \{([^}]*)\}/.exec(css)![1]!;
    const norm = (s: string) => s.split(";").map((x) => x.trim()).filter(Boolean).sort();
    expect(norm(media)).toEqual(norm(attr));
    for (const role of ["bg", "surface", "text", "muted", "primary", "on-primary", "accent", "ok", "warn", "danger", "line-strong"]) expect(attr, role).toContain(`--ak-${role}:`);
  });
});

describe("generated files", () => {
  it("are what the sources give: the stylesheet, the icons, the fonts, the tokens and the crown files", () => {
    const out = execFileSync(process.execPath, [root + "packages/ui/scripts/build.mjs", "--check"], { cwd: root, encoding: "utf8" });
    expect(out).toContain("generated files are current");
  }, 60_000);
  it("the console's sheet carries the tokens, both themes, our own font files, and nothing from another site", () => {
    expect(UI_CSS).toContain("--ak-gold:#c9a227"); expect(UI_CSS).toContain('[data-theme=dark]'); expect(UI_CSS).toContain("prefers-color-scheme:dark");
    expect([...UI_CSS.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!.replace(/["']/g, "")).sort()).toEqual(["/fonts/plex-arabic-400.woff2", "/fonts/plex-arabic-600.woff2", "/fonts/plex-latin-400.woff2", "/fonts/plex-latin-600.woff2"]);
    expect(UI_CSS).not.toMatch(/https?:\/\/(?!tailwindcss\.com)/);
    // UX2a raised this from 60,000 to 66,000: the link tile, the escalation steps, the picker's runner, Dispatch and Stock added 3.7 KB (the sheet is staff-only and compresses to about a fifth).
    // CON1 raised it to 70,000: Today's "needs attention" list, the assistant's button and panel, and the name's Settings link (about 3 KB).
    expect(UI_CSS.length, "the console's sheet").toBeLessThan(70_000);
  });
  it("the fonts are four small WOFF2 files, the same bytes the website builds from, with their licence beside them", () => {
    expect(Object.keys(FONTS).sort()).toEqual(["plex-arabic-400.woff2", "plex-arabic-600.woff2", "plex-latin-400.woff2", "plex-latin-600.woff2"]);
    let total = 0;
    for (const [name, b64] of Object.entries(FONTS)) {
      const file = readFileSync(root + "packages/ui/fonts/" + name);
      expect(file.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
      expect(file.toString("base64"), name).toBe(b64);
      total += file.length;
    }
    expect(total).toBeLessThan(50_000);
    expect(read("packages/ui/fonts/OFL.txt")).toContain("SIL Open Font License");
  });
});

describe("the crown", () => {
  it("is one drawing: inline, as a file, and in both apps' icons", () => {
    expect(crown().s).toContain(CROWN_BODY);
    expect(read("packages/ui/crown.svg")).toContain(CROWN_BODY);
    expect(read("apps/web/public/icons/icon.svg")).toBe(read("packages/ui/crown.svg"));
    expect(read("packages/ui/crown.svg")).toContain(`fill="${LIGHT.ink}"`); expect(read("packages/ui/crown.svg")).toContain(`fill="${LIGHT.gold}"`);
    expect(crownFile({ tile: "#000000", mark: "#ffffff" })).toContain(CROWN_BODY);
    for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) expect(statSync(root + "apps/web/public/icons/" + f).size).toBeGreaterThan(1000);
    expect(read("apps/console/src/icons.ts")).toContain("the crown");
  });
  it("is decoration beside a name, and a labelled picture when it stands alone", () => {
    expect(crown().s).toContain('aria-hidden="true"');
    expect(crown({ label: "Alo King" }).s).toContain('role="img" aria-label="Alo King"');
  });
});

describe("components", () => {
  const sample = [
    button({ label: `<b>"x"</b>`, href: `/a?b=1&c="2"` }), badge("<i>late</i>", "danger"), kpiTile({ label: "<x>", value: "<1>", compare: [{ label: "<y>", text: "<+1>", direction: "up", good: true }], trend: [1, 2, 3] }),
    caseRow({ href: "/inbox/1", timer: timerChip({ minutes: 3, promise: null, text: "<3>" }), title: "<script>alert(1)</script>", order: "AK-<1>", last: "<img src=x>", openLabel: "<open>" }),
    dataTable({ caption: "<c>", columns: [{ label: "<h>" }], rows: [{ cells: ["<td>"] }] }),
    productCard({ href: "/p/x", name: "<n>", price: "$1.00", inStock: false, picture: null, labels: { inStock: "in", outOfStock: "<out>", noPicture: "<none>" } }),
  ].map((r) => r.s).join("");
  it("escape everything they are given", () => {
    expect(sample).not.toMatch(/<script>|<b>|<i>late|<img src=x>|<td><td>/i);
    expect(sample).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(sample).toContain('href="/a?b=1&amp;c=&quot;2&quot;"');
    expect(html`${"<x>"}${html`<b>${"&"}</b>`}`.s).toBe("&lt;x&gt;<b>&amp;</b>");
  });
  it("write no inline style and no script, in either language, so both apps' content policy holds", () => {
    for (const l of ["en", "ar"] as const) { const g = gallery(l).s; expect(g).not.toMatch(/\sstyle="|<script|<style|\son[a-z]+="/); expect(g.length).toBeGreaterThan(5000); }
    expect(gallery("ar").s).toContain("التاج"); expect(gallery("en", { theme: "dark" }).s).toContain(DARK.bg!);
  });
  it("a timer is green, then amber from three quarters of the promise, then red past it; with no promise it is neutral", () => {
    expect(TIMER_AMBER_SHARE).toBe(0.75);
    expect([timerState(10, 40), timerState(30, 40), timerState(40, 40), timerState(41, 40), timerState(5, null)]).toEqual(["ok", "warn", "warn", "late", "idle"]);
    expect(timerChip({ minutes: 41, promise: 40, text: "41 min" }).s).toContain("ak-timer--late");
  });
  it("a bar against a limit says in words what it draws, and turns amber at the soft limit and red at the hard one", () => {
    expect(limitBar({ value: 10, soft: 150, hard: 200, label: "$10 of $200" }).s).toMatch(/class="ak-bar" role="img" aria-label="\$10 of \$200"/);
    expect(limitBar({ value: 160, soft: 150, hard: 200, label: "x" }).s).toContain("ak-bar--warn");
    expect(limitBar({ value: 200, soft: 150, hard: 200, label: "x" }).s).toContain("ak-bar--danger");
  });
  it("a trend line needs two points, and a flat one still draws", () => {
    expect(sparkline([5]).s).toBe(""); expect(sparkline([3, 3, 3]).s).toContain("<polyline");
  });
  it("a product card with no picture shows a neutral placeholder with words, never a broken image", () => {
    const c = productCard({ href: "/p/x", name: "n", price: "$1.00", inStock: true, picture: null, labels: { inStock: "In stock", outOfStock: "Out", noPicture: "No picture yet" } }).s;
    expect(c).toContain('role="img" aria-label="No picture yet"'); expect(c).not.toContain("<img");
  });
});

describe("Arabic for a person to read", () => {
  it("docs/ARABIC_REVIEW.md lists every customer-facing Arabic line DS1 added to the website, word for word", () => {
    const review = read("docs/ARABIC_REVIEW.md");
    const start = review.indexOf("## DS1, the website's redesigned pages");
    const section = review.slice(start, review.indexOf("\n## ", start + 10));          // this section only: later sessions' tables come after it
    const listed = [...section.matchAll(/^\| `(\w+)` \| (.*?) \| (.*?) \| /gm)].map((m) => ({ key: m[1]!, ar: m[2]!, en: m[3]! }));
    expect(listed.length).toBeGreaterThan(30);
    for (const row of listed) { expect(DICTS.ar[row.key], row.key).toBe(row.ar); expect(DICTS.en[row.key], row.key).toBe(row.en); }
    // every key the site gained after the lines read before DS1 (the last of those is footer_note's neighbour, live below) is in the list
    const ds1 = Object.keys(DICTS.ar).slice(Object.keys(DICTS.ar).indexOf("hero_title"), Object.keys(DICTS.ar).indexOf("gallery"));
    expect(listed.map((r) => r.key)).toEqual(ds1);
    for (const row of listed) expect(row.ar, row.key).not.toMatch(/الأفضل|صحي|مميز|أجود|ألذ/);        // no praise, no health word (invariants 14, 15)
  });
});
