// DS2: the design reference applied (docs/DECISIONS.md, "Design reference, 17 November 2026"). The status label table keeps the
// database's ids; the reference's rules for staff screens are part of packages/ui (44 px targets, no swipes, undo instead of "are you
// sure", timers with words and an icon); WhatsApp green is only on WhatsApp actions; one token file feeds both apps.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRANSITIONS } from "@ak/core/order-machine";
import { button, factRow, field, input, previewNotice, price, productCard, stepper, timerChip, toast } from "@ak/ui/components";
import { ORDER_STATUS_IDS, STATUS_LABELS, statusLabel, statusPill } from "@ak/ui/status";
import { gallery } from "@ak/ui/gallery";
import { LIGHT } from "@ak/ui/tokens.generated";
import { UI_CSS } from "../../apps/console/src/ui.generated";
import { SHELL_JS } from "../../apps/console/src/pwa";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

describe("the brand, from the reference", () => {
  it("is the decided ink, gold, gold-deep, paper, green and WhatsApp green, in one token file", () => {
    expect(LIGHT).toMatchObject({ ink: "#0E0F12", gold: "#C9A227", "gold-deep": "#8A6A12", paper: "#FAF8F3", ok: "#14663B", whatsapp: "#25D366", bg: "#FAF8F3", accent: "#8A6A12" });
    // one file: no other stylesheet in either app or in packages/ui defines an --ak- token
    const sheets = [...readdirSync(root + "packages/ui/styles").map((f) => "packages/ui/styles/" + f), "apps/web/src/styles/site.css", "apps/web/src/styles/gallery.css"];
    for (const f of sheets) expect(read(f), f).not.toMatch(/(?:^|[\s{;])--ak-[a-z0-9-]+\s*:/);
  });
  it("IBM Plex Sans is served from our own files, for Arabic and Latin, by both apps", () => {
    for (const f of ["packages/ui/styles/console.css", "apps/web/src/styles/site.css"]) {
      const css = read(f);
      // WEB2: the website adds the small figures font its Arabic pages use for digits and codes (two weights)
      // WEB4a: and a third weight, 700, for the reference's bold headings (Latin, Arabic, figures): 9 faces on the website
      expect(css.match(/@font-face/g)?.length, f).toBe(f.startsWith("apps/web") ? 9 : 4);
      expect(css, f).toContain('font-family: "IBM Plex Sans Arabic"'); expect(css, f).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\//);
    }
    expect(read("packages/ui/tokens.css")).toContain('--ak-font: "IBM Plex Sans", "IBM Plex Sans Arabic"');
  });
  it("WhatsApp green is only on a WhatsApp action: every button that wears it opens the chat", () => {
    const files = ["apps/web/src/layouts/Base.astro", ...readdirSync(root + "apps/web/src/pages", { recursive: true }).map((f) => "apps/web/src/pages/" + String(f)).filter((f) => f.endsWith(".astro")),
      ...readdirSync(root + "apps/console/src/pages").map((f) => "apps/console/src/pages/" + f), "apps/console/src/html.ts"];
    let seen = 0;
    for (const f of files) for (const line of read(f).split("\n")) if (/variant[=:]\s*\{?[^,}]*"whatsapp"/.test(line)) { seen++; expect(line, f).toMatch(/icon="chat"/); expect(line, f).toMatch(/href=\{(chat|ask|withGreeting)/); }
    expect(seen).toBeGreaterThanOrEqual(4);
    // and the colour itself is written by one rule only, in both sheets
    expect(UI_CSS.match(/var\(--ak-whatsapp\)/g)?.length).toBe(1);
    expect(read("apps/web/src/styles/site.css")).not.toContain("--ak-whatsapp");
  });
});

describe("order statuses: the database's ids, one label table", () => {
  it("has a row for every status of the order machine and no other", () => {
    expect([...ORDER_STATUS_IDS].sort()).toEqual(Object.keys(TRANSITIONS).sort());
    for (const id of ORDER_STATUS_IDS) for (const who of ["staff", "customer"] as const) for (const lang of ["en", "ar"] as const) {
      expect(STATUS_LABELS[id][who][lang].length, `${id} ${who} ${lang}`).toBeGreaterThan(2);
      if (lang === "ar") expect(STATUS_LABELS[id][who].ar, id).toMatch(/[؀-ۿ]/);
    }
  });
  it("words them as decided, for staff and for the customer", () => {
    const pair = (id: string, pickup = false) => [statusLabel(id, { audience: "customer", pickup }), statusLabel(id)];
    expect(pair("awaiting_confirmation")).toEqual(["Waiting for your Confirm", "Awaiting confirm"]);
    expect(pair("confirmed")).toEqual(["Confirmed", "To pick"]);
    expect(pair("preparing")).toEqual(["Packing at the hub", "Picking"]);
    expect(pair("ready")).toEqual(["Packed", "Packed"]); expect(pair("ready", true)[0]).toBe("Ready for pickup");
    expect(pair("out_for_delivery")).toEqual(["On the way", "On the way"]);
    expect(statusLabel("cancelled", { reason: "the customer asked" })).toBe("Cancelled: the customer asked");
    expect(statusLabel("delivered")).toMatch(/not paid/i);                                  // delivered is not paid (invariant 12): staff are told so
    expect(statusLabel("closed", { audience: "customer" })).toBe("Delivered");
    expect(statusLabel("preparing", { audience: "customer", lang: "ar" })).toMatch(/[؀-ۿ]/);
  });
  it("never guesses: an id it does not know is shown as it is", () => {
    expect(statusLabel("something_new")).toBe("something_new");
    expect(statusPill("something_new").s).toContain("something_new");
  });
  it("a pill carries an icon and its words, so the colour is never the only signal", () => {
    for (const id of ORDER_STATUS_IDS) { const p = statusPill(id).s; expect(p, id).toContain("<svg"); expect(p, id).toContain(statusLabel(id)); expect(p, id).toContain(`data-status="${id}"`); }
    expect(statusPill("confirmed", { audience: "customer", lang: "ar" }).s).toContain("مؤكد");
  });
  it("no word in the table praises, rates or promises (invariants 14 and 15)", () => {
    const all = ORDER_STATUS_IDS.flatMap((id) => [STATUS_LABELS[id].staff, STATUS_LABELS[id].customer, STATUS_LABELS[id].customerPickup ?? { en: "", ar: "" }]).flatMap((w) => [w.en, w.ar]).join(" ");
    expect(all).not.toMatch(/best|great|fresh|healthy|fast|الأفضل|صحي|مميز|أسرع/i);
  });
});

describe("the reference's rules for staff screens, in packages/ui", () => {
  const rules = [...UI_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  const px = (v: string) => { const token = /^var\((--[a-z-]+)\)$/.exec(v.trim())?.[1]; return token ? Number(new RegExp(`${token}:(\\d+)px`).exec(UI_CSS)?.[1]) : Number.parseFloat(v); };
  it("no tap target is under 44 px: buttons, chips, tabs, stepper buttons, the toast's Undo, the phone bar", () => {
    for (const sel of [".ak-btn", ".ak-btn--sm", ".ak-chip", ".ak-tab", ".ak-stepper button", ".ak-input,.ak-select", ".bottom-nav a", ".sidebar a", ".ak-case"]) {
      const rule = rules.find((r) => r.sel === sel && /min-block-size:/.test(r.body));
      expect(rule, `a min-block-size rule for ${sel}`).toBeTruthy();
      expect(px(/min-block-size:([^;]+)/.exec(rule!.body)![1]!), sel).toBeGreaterThanOrEqual(44);
    }
    const undo = rules.find((r) => r.sel.includes(".ak-toast-undo") && /min-block-size/.test(r.body))!;
    expect(px(/min-block-size:([^;]+)/.exec(undo.body)![1]!)).toBeGreaterThanOrEqual(44);
    expect(px(/min-inline-size:([^;]+)/.exec(undo.body)![1]!)).toBeGreaterThanOrEqual(44);
  });
  it("nothing is decided by a swipe: no script of either app listens for one", () => {
    for (const js of [SHELL_JS, read("apps/console/src/capture-js.ts"), read("apps/web/public/site.js")]) expect(js).not.toMatch(/touchstart|touchmove|touchend|swipe|pointermove/i);
    expect(UI_CSS).not.toMatch(/scroll-snap|touch-action:pan/);
  });
  it("a reversible action offers Undo in the toast, and no script asks \"are you sure\"", () => {
    const t = toast({ text: "Marked resolved.", undo: { href: "/undo/1", label: "Undo" } }).s;
    expect(t).toContain('role="status"'); expect(t).toContain('<a class="ak-toast-undo" href="/undo/1">Undo</a>');
    expect(toast({ text: "Saved." }).s).not.toContain("ak-toast-undo");
    for (const js of [SHELL_JS, read("apps/console/src/capture-js.ts"), read("apps/web/public/site.js")]) expect(js).not.toMatch(/\bconfirm\s*\(/);
  });
  it("a timer always carries an icon and words, in every state", () => {
    for (const [minutes, promise] of [[5, 40], [35, 40], [50, 40], [5, null]] as const) {
      const c = timerChip({ minutes, promise, text: `${minutes} min` }).s;
      expect(c).toContain("<svg"); expect(c).toContain(`${minutes} min`);
    }
    // @ts-expect-error a timer without words does not compile
    timerChip({ minutes: 1, promise: 2 });
  });
});

describe("the shared components the reference uses", () => {
  it("a fact with no approved value reads \"not confirmed yet\": never an empty line, never a value", () => {
    const open = factRow({ label: "Ingredients", value: null, notConfirmed: "Not confirmed yet" }).s;
    expect(open).toContain("ak-unconfirmed"); expect(open).toContain("Not confirmed yet"); expect(open).toContain("<svg");
    expect(factRow({ label: "Storage", value: "", notConfirmed: "Not confirmed yet" }).s).toContain("ak-unconfirmed");
    const known = factRow({ label: "Contains", value: "Milk", source: "(from the label photo)", notConfirmed: "Not confirmed yet" }).s;
    expect(known).toContain("<bdi>Milk</bdi>"); expect(known).toContain("(from the label photo)"); expect(known).not.toContain("ak-unconfirmed");
  });
  it("a price shows the unit price under it when one is given, and computes nothing", () => {
    expect(price({ amount: "$3.25", unit: { amount: "$6.50", per: "kg" } }).s).toBe('<span class="ak-price"><bdi>$3.25</bdi><small><bdi>$6.50</bdi>/kg</small></span>');
    expect(price({ amount: "$3.25", big: true }).s).toBe('<span class="ak-price ak-price--big"><bdi>$3.25</bdi></span>');
    const cardHtml = productCard({ href: "/p/x", name: "n", meta: "500 g", price: "$3.25", unitPrice: { amount: "$6.50", per: "kg" }, inStock: true, picture: null, labels: { inStock: "In", outOfStock: "Out", noPicture: "None" } }).s;
    expect(cardHtml).toContain('<span class="price"><bdi>$3.25</bdi></span>'); expect(cardHtml).toContain("500 g · <bdi>$6.50</bdi>/kg");
  });
  it("a stepper is two real buttons that send the next value; at the minimum, one less is off", () => {
    const labels = { less: "One less", more: "One more", quantity: "Quantity" };
    const two = stepper({ name: "qty", value: 2, labels }).s;
    expect(two).toContain('role="group" aria-label="Quantity"');
    expect(two).toContain('<button type="submit" name="qty" value="1" aria-label="One less">'); expect(two).toContain('<button type="submit" name="qty" value="3" aria-label="One more">');
    expect(two).toMatch(/<output[^>]*>2<\/output>/);
    expect(stepper({ name: "qty", value: 0, labels }).s).toContain('value="0" aria-label="One less" disabled');
    expect(stepper({ name: "qty", value: 5, max: 5, labels }).s).toContain('aria-label="One more" disabled');
  });
  it("a field says in words why a value was refused; a button has the reference's variants; the preview notice is a note", () => {
    const f = field({ label: "Counted cash", control: input({ name: "c", label: "Counted cash", hideLabel: true, invalid: true }), hint: "What you counted.", error: "Type a number." }).s;
    expect(f).toContain('role="alert"'); expect(f).toContain("Type a number."); expect(f).toContain("What you counted."); expect(f).toContain('aria-invalid="true"');
    for (const v of ["primary", "gold", "soft", "ghost", "whatsapp", "danger", "on-ink"] as const) expect(button({ label: "x", variant: v }).s).toContain(`ak-btn--${v}`);
    expect(previewNotice("STAGING: test data").s).toBe('<p class="ak-preview" role="note">STAGING: test data</p>');
  });
  it("the gallery shows every one of them, in both languages, with no inline style or script", () => {
    for (const l of ["en", "ar"] as const) {
      const g = gallery(l).s;
      for (const cls of ["ak-status", "ak-stepper", "ak-fact", "ak-unconfirmed", "ak-preview", "ak-toast-undo", "ak-price", "ak-btn--whatsapp", "ak-field--error", "ak-timer", "ak-kpi", "ak-tab", "ak-chip", "ak-card", "ak-empty"]) expect(g, `${l}: ${cls}`).toContain(cls);
      expect(g).not.toMatch(/\sstyle="|<script|<style|\son[a-z]+="/);
    }
  });
});

describe("the console's frame", () => {
  it("draws the test-data strip with the preview notice", () => {
    expect(read("apps/console/src/html.ts")).toContain("previewNotice(t(lang, \"test_data\"");
  });
});
