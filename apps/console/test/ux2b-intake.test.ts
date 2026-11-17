// UX2b: Intake on one frame. Progress (the board, the steps to selling-requires-a-label, the pack check), Photograph (LB1's capture), Label approvals
// (LB1's list) and Readiness (sellable, fact-complete, label-ready per template) share a tab bar by role. The switch is shown, never changed, here.
import { beforeAll, describe, expect, it } from "vitest";
import { rig, type Rig } from "./kit";

let r: Rig;
const who = async (role: "admin" | "ops_lead" | "picker", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };
const tabs = (html: string) => [...html.matchAll(/<a[^>]*href="(\/intake|\/capture|\/label-queue|\/readiness)"[^>]*class="ak-tab[^"]*"|<a class="ak-tab[^"]*"[^>]*href="(\/intake|\/capture|\/label-queue|\/readiness)"/g)].map((m) => m[1] ?? m[2]);

beforeAll(async () => { r = await rig(); }, 120_000);

describe("the tab bar", () => {
  it("a picker sees Progress and Photograph; a lead and the admin see all four, on every Intake page", async () => {
    const p = await who("picker", "Pia");
    for (const path of ["/intake", "/capture"]) { const t = (await p.b.get(path)).text; expect(t, path).toContain('href="/capture"'); expect(t, path).toContain('href="/intake"'); expect(t).not.toMatch(/ak-tab[^>]*>[^<]*Label approvals/); }
    const lead = await who("ops_lead", "Maya");
    for (const path of ["/intake", "/capture", "/label-queue", "/readiness"]) {
      const t = (await lead.b.get(path)).text;
      for (const label of ["Progress", "Photograph", "Label approvals", "Readiness"]) expect(t, `${path} ${label}`).toContain(label);
    }
  });
  it("marks the page you are on", async () => {
    const lead = await who("ops_lead", "Maya2");
    expect((await lead.b.get("/readiness")).text).toMatch(/aria-current="page"[^>]*>(?:<[^>]*>)*Readiness|Readiness[^<]*<\/a>/);
  });
});

describe("the progress board", () => {
  it("counts the label day's photographs and links to the photographing", async () => {
    const lead = await who("ops_lead", "Maya3");
    let t = (await lead.b.get("/intake")).text;
    expect(t).toMatch(/Photographed[\s\S]*?0 \/ 291/);
    const [a] = await r.db.all(`select id from products where is_active order by sku limit 1`);
    for (const s of ["front", "back"]) await r.db.rpc("record_label_capture", { p_product: a.id, p_shot: s, p_media_path: `labels/${a.id}/2026-11-17/${s}.jpg`, p_by: lead.partyId });
    t = (await lead.b.get("/intake")).text;
    expect(t).toMatch(/Photographed[\s\S]*?1 \/ 291/);
    expect(t).toContain('href="/capture"');
    expect(t).toMatch(/Label-ready[\s\S]*?0 \/ \d+/);
    expect(t).toContain('href="/readiness?show=label"');
  });
  it("shows selling-requires-a-label read only, with the steps to turn it on, and nothing that changes it", async () => {
    const lead = await who("ops_lead", "Maya4");
    const t = (await lead.b.get("/intake")).text;
    expect(t).toContain("Selling requires a label");
    expect(t).toMatch(/Off/);
    expect(t).toContain("The steps to turn it on");
    for (const s of ["Photograph every pack", "Run the label reading", "Approve the readings", "Nothing in stock is left unlabelled", "Switch it on in Settings"]) expect(t, s).toContain(s);
    expect(t).not.toMatch(/<form[^>]*action="\/(settings|intake\/switch)/);
    expect(t).not.toContain("sell_requires_label\" value");
    expect(t).not.toContain('href="/settings#switches"');                                // only the admin is sent to the Settings page
    const admin = await who("admin", "Rasheed");
    expect((await admin.b.get("/intake")).text).toContain('href="/settings#switches"');
    await r.db.pg.query(`update settings set value = '{"enabled": true}' where key = 'sell_requires_label'`);
    expect((await lead.b.get("/intake")).text).toMatch(/On<\/span>|>On</);
    await r.db.pg.query(`update settings set value = '{"enabled": false}' where key = 'sell_requires_label'`);
  });
  it("still has the pack check: scanning a pack and the items waiting to be checked", async () => {
    const lead = await who("ops_lead", "Maya5");
    const t = (await lead.b.get("/intake")).text;
    expect(t).toContain('action="/intake/scan"');
    expect(t).toContain("Waiting to be checked against the pack (0 items)");
  });
  it("a picker sees the photographs and the pack check, not the lead's counts", async () => {
    const p = await who("picker", "Pia2");
    const t = (await p.b.get("/intake")).text;
    expect(t).toMatch(/Photographed/);
    expect(t).not.toMatch(/Waiting for a person|Label-ready/);
  });
});

describe("readiness per template", () => {
  it("lists every template with its items, sellable, fact-complete, packaged and label-ready counts", async () => {
    const lead = await who("ops_lead", "Maya6");
    const t = (await lead.b.get("/readiness")).text;
    expect(t).toMatch(/<th scope="col">Template<\/th><th scope="col" class="num">Items<\/th><th scope="col" class="num">Sellable<\/th><th scope="col" class="num">Fact-complete<\/th><th scope="col" class="num">Packaged<\/th><th scope="col" class="num">Label-ready<\/th>/);
    expect(t).toMatch(/Sellable[\s\S]*?\d+ \/ 291/);
    expect(t).toContain("Selling requires a label: off");
  });
});

describe("Arabic", () => {
  it("the tabs, the board, the steps and the readiness table are in Arabic, right to left", async () => {
    const lead = await who("ops_lead", "Maya7", "ar");
    const t = (await lead.b.get("/intake")).text;
    expect(t).toMatch(/<html lang="ar" dir="rtl">/);
    for (const w of ["التقدّم", "التصوير", "موافقات الملصقات", "الجاهزية", "لا بيع قبل الملصق", "خطوات التفعيل", "صوّر كل عبوة"]) expect(t, w).toContain(w);
    const ready = (await lead.b.get("/readiness")).text;
    for (const w of ["قابل للبيع", "حقائقه مكتملة", "ملصقه جاهز", "القالب"]) expect(ready, w).toContain(w);
  });
});
