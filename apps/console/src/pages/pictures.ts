// 3.18 Picture review (5.17 step 6): the item and its proposed picture side by side, with source and licence; approve or
// reject. Reads product_images_review(), writes only through review_product_image() (0050). The picture is in the private
// media bucket and reaches the browser only as a signed link made here on the server (P1's note).
// A licence-unknown picture can be approved as a guide, but it is never shown to a customer: the page says so beside it.
import { act, html, id, render, returnTo, text, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { LEADS } from "../roles";

export type Img = { image_id: string; product_id: string; sku: string | null; name_en: string; name_ar: string | null; brand: string | null; barcode: string | null;
  sell_unit: string; status: string; media_path: string; source_kind: string; source_url: string | null; page_url: string | null; licence: string;
  attribution: string | null; width_px: number | null; height_px: number | null; bytes: number | null; vision: Record<string, unknown> | null;
  customer_visible: boolean; fetched_at: string; reviewed_at: string | null; review_note: string | null;
  /** PIX4 (0242): where an upload came from when it has no address, why it needs a second look, and whether it was put aside ("Later"). */
  source_note?: string | null; needs_review?: boolean; check_notes?: string[] | null; deferred_at?: string | null };
const STATUSES = ["proposed", "approved", "rejected"] as const;
export const LICENCE: Record<string, string> = { cc_by_sa: "CC BY-SA (Open Food Facts): attribution must be shown", brand_own: "the brand's own site", own_photo: "our own photo", public_page: "a public page", founder_supplied: "the founder's own upload (a person approves it)", unknown: "unknown licence" };
// Links are only ever drawn to http(s) addresses; anything else is shown as text.
export const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

const PAGE = 20;
// Fastest sellers first: the fetch stores each item's rank among all catalog items (1 = fastest) in vision.rank (session PIX2).
// Items with no stored rank (older proposals) come after, by SKU.
export const bySpeed = (a: Img, b: Img) => {
  const ra = Number(a.vision?.rank) || Infinity; const rb = Number(b.vision?.rank) || Infinity;
  return ra - rb || String(a.sku ?? "").localeCompare(String(b.sku ?? ""));
};

async function page(c: Ctx) {
  const status = (STATUSES as readonly string[]).includes(c.url.searchParams.get("status") ?? "") ? (c.url.searchParams.get("status") as string) : "proposed";
  const all = ((await c.deps.db.rpc<Img[]>("product_images_review", { p_status: status, p_limit: 1000 })) ?? []).sort(bySpeed);
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const n = Math.min(pages, Math.max(1, Math.floor(Number(c.url.searchParams.get("page"))) || 1));
  const rows = all.slice((n - 1) * PAGE, n * PAGE);
  const links = await Promise.all(rows.map((r) => c.deps.media.sign(r.media_path, 600)));
  const intake = (await c.deps.db.rpc<unknown[]>("photograph_at_intake", {})) ?? [];
  return render(c, "Product pictures", html`
<p>${STATUSES.map((s, i) => html`${i ? " · " : ""}${s === status ? html`<strong>${s}</strong>` : html`<a href="/pictures?status=${s}">${s}</a>`}`)}
· ${intake.length} items on the photograph-at-intake list</p>
<p>${all.length} ${status}, fastest sellers first. Page ${n} of ${pages}${n > 1 ? html` · <a href="/pictures?status=${status}&page=${n - 1}">previous 20</a>` : ""}${n < pages ? html` · <a href="/pictures?status=${status}&page=${n + 1}">next 20</a>` : ""}</p>
<p class="muted">Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, shop logo or text on top.</p>
${rows.length === 0 ? html`<p class="muted">Nothing ${status}.</p>` : rows.map((r, i) => html`<div class="pair">
<div>${links[i] ? html`<a href="${links[i]}" target="_blank" rel="noopener"><img class="proof" src="${links[i]}" alt="proposed picture of ${r.name_en}"></a>` : html`<p class="warn">Picture not available.</p>`}
<p class="muted">${r.width_px ?? "?"} × ${r.height_px ?? "?"} px${r.bytes ? `, ${Math.round(r.bytes / 1024)} KB` : ""}</p></div>
<div><p>${r.vision?.rank ? html`#${String(r.vision.rank)} · ` : ""}<strong>${r.name_en}</strong>${r.name_ar ? html` · ${r.name_ar}` : ""}</p>
<p>${r.sku ?? ""} · ${r.brand ?? "no brand"} · ${r.sell_unit}${r.barcode ? html` · barcode ${r.barcode}` : ""}</p>
<p>Source: ${r.source_kind}${r.source_note ? html` · ${r.source_note}` : ""}${safeHref(r.page_url) ? html` · <a href="${safeHref(r.page_url)}" target="_blank" rel="noopener noreferrer">page</a>` : ""}
${safeHref(r.source_url) ? html` · <a href="${safeHref(r.source_url)}" target="_blank" rel="noopener noreferrer">original</a>` : ""}</p>
<p>Licence: <strong>${LICENCE[r.licence] ?? r.licence}</strong>${r.attribution ? html` · ${r.attribution}` : ""}</p>
${r.customer_visible ? "" : html`<p class="warn"><strong>Never shown to customers</strong> (licence unknown): approving keeps it only as a guide for the intake photo.</p>`}
<p class="muted">Fetched ${when(r.fetched_at)}${r.reviewed_at ? html` · reviewed ${when(r.reviewed_at)}${r.review_note ? `: ${r.review_note}` : ""}` : ""}</p>
${r.status === "proposed" || r.status === "approved" ? form(c.f, `/pictures/${r.image_id}`, html`<input name="note" maxlength="300" placeholder="note (why)">
${r.status === "proposed" ? html`<button name="decision" value="approve">Approve</button> ` : ""}<button name="decision" value="reject">Reject</button>`) : ""}
</div></div>`)}`);
}

async function review(c: Ctx) {
  const image = id(c, "image");
  const decision = c.form.decision === "approve" ? "approve" : c.form.decision === "reject" ? "reject" : null;
  if (!decision) throw new UserError("Choose approve or reject.");
  const note = text(c, "note", 300) || null;
  return act(c, `picture_${decision}`, { image, note }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean; status: string; customer_visible?: boolean; replaced?: string | null }>("review_product_image", {
      p_image: image, p_by: c.staff.partyId, p_decision: decision, p_note: note,
    });
    if (r.already) return `Already ${r.status}.`;
    if (r.status === "rejected") return "Rejected.";
    return `Approved${r.replaced ? ", replacing the earlier picture" : ""}.${r.customer_visible ? " Customers can now see it." : " Kept as a guide only: customers never see a licence-unknown picture."}`;
  }, returnTo(c, "/pictures"));
}

export const picturesSection: Section = {
  nav: { href: "/pictures", label: "Pictures", roles: LEADS },
  routes: [
    { method: "GET", path: "/pictures", roles: LEADS, handler: page },
    { method: "POST", path: "/pictures/:image", roles: LEADS, handler: review },
  ],
};
