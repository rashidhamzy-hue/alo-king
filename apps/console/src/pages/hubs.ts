// The hubs behind the bottom navigation (session D5): Approve, Stock and More list the pages of their group with a badge on each
// that has something waiting; More also holds the language choice, the install guide and the alerts switch for this phone.
// They link to existing pages and change nothing. The push routes only store or remove this browser's subscription (0158).
import { audit, html, render, type Ctx, type Section } from "../app";
import type { Raw } from "../html";
import { badgeText, buildNav, type NavGroup } from "../nav";
import { t, type Lang } from "../i18n";
import { isPushEndpoint } from "../push";
import { ALL, LEADS } from "../roles";

const badge = (n: number) => (n > 0 ? html` <span class="badge">${badgeText(n)}</span>` : "");

function links(g: NavGroup | undefined, lang: Lang): Raw {
  if (!g || g.links.length === 0) return html`<p class="muted">${t(lang, "hub_empty")}</p>`;
  return html`<ul class="hub">${g.links.map((l) => html`<li><a href="${l.href}"><span>${l.label}</span>${badge(l.badge)}</a></li>`)}</ul>`;
}
const groupOf = (c: Ctx, id: string) => buildNav(c.sections, c.staff.role, c.lang, c.url.pathname, c.badges).groups.find((g) => g.id === id);

const approve = async (c: Ctx) => render(c, t(c.lang, "nav_approve"), html`<p class="muted">${t(c.lang, "hub_approve_intro")}</p>${links(groupOf(c, "approve"), c.lang)}`, { translated: true });
const stock = async (c: Ctx) => render(c, t(c.lang, "g_stock"), html`<p class="muted">${t(c.lang, "hub_stock_intro")}</p>${links(groupOf(c, "stock"), c.lang)}`, { translated: true });

async function more(c: Ctx) {
  const L = c.lang;
  const push = LEADS.includes(c.staff.role) ? pushBox(c) : html`<p class="muted">${t(L, "push_leads_only")}</p>`;
  return render(c, t(L, "nav_more"), html`<p class="muted">${t(L, "hub_more_intro")}</p>
<h2>${t(L, "g_run")}</h2>${links(groupOf(c, "run"), L)}
${groupOf(c, "other") ? html`<h2>${t(L, "g_other")}</h2>${links(groupOf(c, "other"), L)}` : ""}
<h2>${t(L, "language")}</h2>
<p class="chips"><a href="/lang?to=en&amp;next=/more"${L === "en" ? html` aria-current="true"` : ""}>${t("en", "lang_en")}</a><a href="/lang?to=ar&amp;next=/more"${L === "ar" ? html` aria-current="true"` : ""}>${t("ar", "lang_ar")}</a></p>
<p class="muted">${t(L, "lang_note")}</p>
<h2>${t(L, "push_h")}</h2>${push}
<h2>${t(L, "install_h")}</h2><p><a class="btn" href="/install">${t(L, "install_link")}</a></p>`, { translated: true });
}

function pushBox(c: Ctx): Raw {
  const L = c.lang;
  const key = c.deps.pushPublicKey;
  if (!key) return html`<p class="note">${t(L, "push_not_configured")}</p>`;
  return html`<div data-push data-vapid="${key}" data-msg-unsupported="${t(L, "push_unsupported")}" data-msg-denied="${t(L, "push_denied")}" data-msg-saved="${t(L, "push_saved")}"
 data-msg-on="${t(L, "push_on")}" data-msg-removed="${t(L, "push_removed")}" data-msg-failed="${t(L, "push_denied")}">
<p class="muted">${t(L, "push_intro")}</p>
<p><button type="button" data-push-enable>${t(L, "push_enable")}</button> <button type="button" class="secondary" data-push-disable hidden>${t(L, "push_disable")}</button></p>
<p role="status" data-push-status></p></div>`;
}

async function install(c: Ctx) {
  const L = c.lang;
  return render(c, t(L, "install_h"), html`
<div class="card"><h2>${t(L, "install_ios_h")}</h2><ol><li>${t(L, "install_ios_1")}</li><li>${t(L, "install_ios_2")}</li><li>${t(L, "install_ios_3")}</li><li>${t(L, "install_ios_4")}</li></ol></div>
<div class="card"><h2>${t(L, "install_android_h")}</h2><ol><li>${t(L, "install_android_1")}</li></ol></div>
<p><a class="btn" href="/more">${t(L, "nav_more")}</a></p>`, { translated: true });
}

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function subscribe(c: Ctx) {
  const endpoint = (c.form.endpoint ?? "").slice(0, 1000), p256dh = (c.form.p256dh ?? "").slice(0, 200), auth = (c.form.auth ?? "").slice(0, 100);
  if (!isPushEndpoint(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return json(400, { ok: false, error: "bad_subscription" });
  try {
    await c.deps.db.rpc("save_push_subscription", { p_party: c.staff.partyId, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: (c.req.headers.get("user-agent") ?? "").slice(0, 200) });
  } catch { return json(503, { ok: false, error: "not_saved" }); }
  await audit(c.deps, c.staff, { action: "push_subscribe", phase: "event", ok: true }).catch(() => undefined);
  return json(200, { ok: true });
}

async function unsubscribe(c: Ctx) {
  const endpoint = (c.form.endpoint ?? "").slice(0, 1000);
  if (!endpoint) return json(400, { ok: false });
  try { await c.deps.db.rpc("remove_push_subscription", { p_party: c.staff.partyId, p_endpoint: endpoint }); } catch { return json(503, { ok: false }); }
  await audit(c.deps, c.staff, { action: "push_unsubscribe", phase: "event", ok: true }).catch(() => undefined);
  return json(200, { ok: true });
}

export const hubsSection: Section = {
  // No menu entry of its own: the bottom navigation links to these three.
  nav: { href: "/more", label: "More", roles: [] },
  routes: [
    { method: "GET", path: "/approve", roles: ALL, handler: approve },
    { method: "GET", path: "/stock", roles: ALL, handler: stock },
    { method: "GET", path: "/more", roles: ALL, handler: more },
    { method: "GET", path: "/install", roles: ALL, handler: install },
    { method: "POST", path: "/push/subscribe", roles: LEADS, handler: subscribe },
    { method: "POST", path: "/push/unsubscribe", roles: LEADS, handler: unsubscribe },
  ],
};
