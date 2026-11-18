// Screens (DOC2; docs/DECISIONS.md, "Founder decisions, 18 November 2026", 7): the screenshots sessions made of the console and the website, listed
// by session, each page beside the design reference's matching screen. They are in the private Supabase Storage bucket `screens`, never in the
// repository, and reach the browser only as short-lived signed links made here, on the server. Read only: the page writes nothing, and the
// screenshots are made, replaced and deleted by the `screens` workflow (.github/workflows/screens.yml). Any staff role; functional only.
// Reading a screenshot's file name (the page, the width, the language, the theme) and finding a page's reference is packages/core/src/screens.mjs.
import { html, render, type Ctx, type Section } from "../app";
import { ALL } from "../roles";
import { pick, type Lang } from "../i18n";
import { chips, empty, errorState } from "@ak/ui/components";
import { groupScreens, referenceFor, type PageGroup, type Shot } from "@ak/core/screens.mjs";

const cls = (w: string | null) => (w === "390" ? "390" : "wide");
const LANGS: Lang[] = ["en", "ar"];

/** The one screenshot of a page that suits the filter: the width class, then the language (a page shot in one language only shows it), light before dark. */
export function chooseShot(shots: Shot[], width: "390" | "wide", lang: Lang): Shot | null {
  const fit = shots.filter((s) => s.width === null || cls(s.width) === width);
  if (!fit.length) return null;
  const score = (s: Shot) => (s.lang === lang ? 0 : s.lang === null ? 1 : 2) * 10 + (s.theme === "dark" ? 1 : 0) + (s.width === "1280" || s.width === null ? 0 : 0.5);
  return [...fit].sort((a, b) => score(a) - score(b) || a.file.localeCompare(b.file))[0]!;
}

const label = (s: Shot) => [s.width ? `${s.width} px` : null, s.lang === "ar" ? "العربية" : s.lang === "en" ? "English" : null, s.theme].filter(Boolean).join(" · ");

async function page(c: Ctx) {
  const L = c.lang;
  const words = (en: string, ar: string) => pick(L, en, ar);
  const title = words("Screens", "الشاشات");
  if (!c.deps.screens) return render(c, title, errorState({ title: words("The screenshots are not connected here", "الصور غير متصلة هنا"), text: words("This console has no screenshots bucket.", "ليس لهذه اللوحة مخزن صور.") }), { translated: true });
  let paths: string[];
  try { paths = await c.deps.screens.list(); }
  catch { return render(c, title, errorState({ title: words("The screenshots cannot be read", "تعذّرت قراءة الصور"), text: words("The private screens bucket did not answer. Run the screens workflow (Actions, screens), then reload.", "لم يردّ مخزن الصور الخاص. شغّل سير العمل screens (Actions) ثم أعد تحميل الصفحة.") }), { translated: true }); }
  const sessions = groupScreens(paths);
  if (!sessions.length) return render(c, title, empty({ title: words("No screenshots yet", "لا صور بعد"), text: words("Sessions put theirs here with the screens workflow.", "تضع الجلسات صورها هنا بسير العمل screens.") }), { translated: true });

  const q = c.url.searchParams;
  const session = sessions.find((s) => s.session === q.get("session")) ?? sessions[0]!;
  const width = q.get("w") === "wide" ? "wide" : "390";
  const lang: Lang = q.get("lang") === "ar" ? "ar" : q.get("lang") === "en" ? "en" : L;
  const href = (o: { session?: string; w?: string; lang?: string }) => `/screens?session=${o.session ?? session.session}&w=${o.w ?? width}&lang=${o.lang ?? lang}`;

  // Each page's screenshot and its reference's, signed together in one call.
  const rows = session.pages.map((p: PageGroup) => {
    const shot = chooseShot(p.shots, width, lang);
    const ref = shot ? referenceFor(p.key, shot.width ?? (width === "390" ? "390" : "1280"), paths) : referenceFor(p.key, width === "390" ? "390" : "1280", paths);
    return { p, shot, ref };
  });
  const want = [...new Set(rows.flatMap((r) => [...r.p.shots.map((x) => x.path), r.ref?.paths[0]]).filter((x): x is string => !!x))];
  let urls = new Map<string, string | null>();
  try { urls = new Map((await c.deps.screens.sign(want, 600)).map((x) => [x.path, x.url])); } catch { /* the cards say a screenshot cannot be opened */ }
  const img = (path: string | undefined, alt: string) => {
    const u = path ? urls.get(path) : null;
    return u ? html`<a class="shot" href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${alt}" loading="lazy"></a>` : html`<p class="muted">${words("This screenshot cannot be opened right now.", "تعذّر فتح هذه الصورة الآن.")}</p>`;
  };

  return render(c, title, html`
<p class="muted">${words("Screenshots made by sessions, from the private screens bucket, each page beside the design reference's matching screen. Invented data only.", "صور التقطتها الجلسات من مخزن الصور الخاص، كل صفحة بجانب شاشة المرجع المقابلة. بيانات مختلقة فقط.")}</p>
${chips(sessions.map((s) => ({ label: s.session.toUpperCase(), href: href({ session: s.session }), current: s.session === session.session, count: s.pages.length })), words("Sessions", "الجلسات"))}
${chips([["390", "390 px", "390 px"], ["wide", "1280 px and wider", "1280 بكسل وأعرض"]].map(([w, en, ar]) => ({ label: words(en!, ar!), href: href({ w }), current: w === width })), words("Width", "العرض"))}
${chips(LANGS.map((x) => ({ label: x === "ar" ? "العربية" : "English", href: href({ lang: x }), current: x === lang })), words("Language", "اللغة"))}
<p class="muted">${session.session.toUpperCase()}: ${words(`${session.pages.length} pages`, `${session.pages.length} صفحة`)}</p>
${rows.map(({ p, shot, ref }) => html`<section class="card">
<h2>${p.key}</h2>
<div class="pair">
<div><h3>${words("Built", "المنفّذ")}${shot ? html` <small class="muted">${label(shot)}</small>` : ""}</h3>
${shot ? img(shot.path, p.key) : html`<p class="muted">${words("No screenshot at this width.", "لا توجد صورة بهذا العرض.")}${p.widths.length ? html` ${p.widths.map((w, i) => html`${i ? " · " : ""}<a href="${href({ w: cls(w) })}">${w} px</a>`)}` : ""}</p>`}</div>
<div><h3>${words("Reference", "المرجع")}${ref ? html` <small class="muted">${ref.key}</small>` : ""}</h3>
${ref ? img(ref.paths[0], ref.key) : html`<p class="muted">${words("The reference has no matching screen.", "ليس للمرجع شاشة مطابقة.")}</p>`}</div>
</div>
${p.shots.length > 1 ? html`<p class="muted">${words("Also", "وأيضاً")}: ${p.shots.filter((s) => s !== shot).map((s, i) => html`${i ? " · " : ""}<a href="${urls.get(s.path) ?? "#"}" target="_blank" rel="noopener">${label(s) || s.file}</a>`)}</p>` : ""}
</section>`)}`, { translated: true });
}

export const screensSection: Section = {
  // Listed last in the Settings group (nav.ts), so More has it on a phone. Every staff role may look; nothing here changes anything.
  nav: { href: "/screens", label: "Screens", roles: ALL },
  routes: [{ method: "GET", path: "/screens", roles: ALL, handler: page }],
};
