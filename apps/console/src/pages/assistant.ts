// AST1 (docs/DECISIONS.md, "AST1, the console assistant, 19 November 2026"): the assistant's page (/assistant) and the answer route that
// the side panel and the page both post to. For leads only (admin, ops lead); a picker has no assistant. It reads and never acts.
import { html, redirect, render, type Ctx, type Section } from "../app";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { renderAnswer } from "../assistant/guard";
import { askAssistant, normaliseSpend, readSpend, type Outcome } from "../assistant/run";
import type { Raw } from "@ak/ui/h";

export const STARTERS: { en: string; ar: string }[] = [
  { en: "What's late right now?", ar: "ما المتأخر الآن؟" },
  { en: "Which restaurant was slowest today?", ar: "أي مطعم كان الأبطأ اليوم؟" },
  { en: "What should I fix first?", ar: "ما الذي يجب أن أصلحه أولاً؟" },
];

type Turn = { question: string; answer: string | null; usd: number | string; outcome: Outcome; at: string };

export function outcomeText(L: Lang, o: Outcome, reason?: string | null): string {
  if (o === "over_cap") return reason === "monthly_cap"
    ? pick(L, "This month's assistant budget is used up, so it has stopped until next month. The admin can change the cap in Settings.", "انتهت ميزانية المساعد لهذا الشهر، فتوقّف حتى الشهر القادم. يستطيع المدير تغيير السقف في الإعدادات.")
    : pick(L, "Today's assistant budget is used up, so it has stopped until tomorrow. The admin can change the cap in Settings.", "انتهت ميزانية المساعد لليوم، فتوقّف حتى الغد. يستطيع المدير تغيير السقف في الإعدادات.");
  if (o === "off") return pick(L, "The assistant is off.", "المساعد متوقّف.");
  if (o === "unverified") return pick(L, "I could not answer this with figures from the data alone, so I am not showing a guess. Ask more narrowly, or open the page.", "لم أستطع الإجابة بأرقام من البيانات وحدها، لذلك لا أعرض تخميناً. اسأل بشكل أضيق، أو افتح الصفحة.");
  if (o === "failed") return pick(L, "The assistant did not answer. Try again in a minute.", "لم يُجب المساعد. حاول مجدداً بعد دقيقة.");
  return "";
}

/** One question and its answer (or what happened instead). The admin sees what the answer cost, in small text. */
export function turnHtml(L: Lang, t: { question: string; answer: string | null; usd: number | string; outcome: Outcome; reason?: string | null }, admin: boolean): Raw {
  const body = t.outcome === "answered" && t.answer ? html`<div class="ak-answer">${renderAnswer(t.answer)}</div>` : html`<p class="ak-answer note">${outcomeText(L, t.outcome, t.reason)}</p>`;
  const cost = admin && Number(t.usd) > 0 ? html`<p class="ak-cost"><bdi>$${Number(t.usd).toFixed(4)}</bdi></p>` : "";
  return html`<li class="ak-turn"><p class="ak-q">${t.question}</p>${body}${cost}</li>`;
}

export function askForm(c: Pick<Ctx, "lang" | "staff">, compact = false): Raw {
  const L = c.lang;
  const starters = STARTERS.map((s) => { const q = pick(L, s.en, s.ar); return html`<form method="post" action="/assistant" data-ask><input type="hidden" name="_csrf" value="${c.staff.csrf}"><input type="hidden" name="q" value="${q}"><button class="ak-chip">${q}</button></form>`; });
  return html`<div class="ak-starters">${starters}</div>
<form method="post" action="/assistant" class="ak-ask" data-ask><input type="hidden" name="_csrf" value="${c.staff.csrf}">
<label class="${compact ? "visually-hidden" : ""}" for="ak-q${compact ? "-p" : ""}">${pick(L, "Your question", "سؤالك")}</label>
<textarea id="ak-q${compact ? "-p" : ""}" name="q" rows="2" maxlength="600" required placeholder="${pick(L, "Ask about orders, places, riders, stock…", "اسأل عن الطلبات، الأماكن، المناديب، المخزون…")}"></textarea>
<button>${pick(L, "Ask", "اسأل")}</button><p class="muted ak-wait" data-ask-wait hidden>${pick(L, "Reading the data…", "أقرأ البيانات…")}</p></form>`;
}

async function page(c: Ctx) {
  const L = c.lang;
  const admin = c.staff.role === "admin";
  let spend = normaliseSpend(null);
  let turns: Turn[] = [];
  try { [spend, turns] = await Promise.all([readSpend(c.deps.db, c.deps.now()), c.deps.db.rpc<Turn[]>("ast_turns_recent", { p_party: c.staff.partyId, p_limit: 8 }).then((x) => x ?? [])]); }
  catch { return render(c, pick(L, "Assistant", "المساعد"), html`<p class="note">${pick(L, "The assistant is not available yet: the database does not have it (migrations 0261 and 0262).", "المساعد غير متاح بعد: قاعدة البيانات لا تحتويه (الترحيلان 0261 و0262).")}</p>`, { translated: true }); }
  const intro = html`<p class="muted">${pick(L, "It answers from read-only reports, in plain words, and never changes anything: every change stays a button on its own page. Every number comes from the data it read for that answer.", "يجيب من تقارير للقراءة فقط، بكلمات بسيطة، ولا يغيّر شيئاً أبداً: كل تغيير يبقى زراً في صفحته. كل رقم يأتي من البيانات التي قرأها لتلك الإجابة.")}</p>`;
  const state = !c.deps.assistantModel ? html`<p class="note">${pick(L, "The assistant is not connected: the console has no model key.", "المساعد غير موصول: لا يملك الكونسول مفتاح النموذج.")}</p>`
    : !spend.enabled ? html`<p class="note">${outcomeText(L, "off")}${admin ? html` <a href="/settings">${pick(L, "Settings", "الإعدادات")}</a>` : ""}</p>`
    : !spend.allowed ? html`<p class="note">${outcomeText(L, "over_cap", spend.reason)}</p>` : "";
  const budget = admin ? html`<p class="ak-cost">${pick(L, "Spent today", "المصروف اليوم")} <bdi>$${spend.day_usd.toFixed(4)}</bdi> / <bdi>$${spend.daily_cap_usd.toFixed(2)}</bdi> · ${pick(L, "this month", "هذا الشهر")} <bdi>$${spend.month_usd.toFixed(4)}</bdi> / <bdi>$${spend.monthly_cap_usd.toFixed(2)}</bdi></p>` : "";
  const log = html`<ol class="ak-log" data-assistant-log aria-live="polite">${turns.map((t) => turnHtml(L, t, admin))}</ol>`;
  return render(c, pick(L, "Assistant", "المساعد"), html`<div class="ak-assistant-page">${intro}${state}${log}${c.deps.assistantModel && spend.allowed ? askForm(c) : ""}${budget}</div>`, { translated: true });
}

async function ask(c: Ctx) {
  const L = c.lang;
  const q = (c.form.q ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const partial = c.req.headers.get("x-ak-assistant") === "1";
  const admin = c.staff.role === "admin";
  const done = (frag: Raw) => partial ? new Response(frag.s, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }) : redirect("/assistant#latest");
  if (!q) return done(html``);
  if (!c.deps.assistantModel) return done(turnHtml(L, { question: q, answer: null, usd: 0, outcome: "off" }, admin));
  const now = c.deps.now();
  const history = ((await c.deps.db.rpc<Turn[]>("ast_turns_recent", { p_party: c.staff.partyId, p_limit: 3 }).catch(() => [])) ?? [])
    .filter((t) => t.outcome === "answered" && t.answer).map((t) => ({ question: t.question, answer: t.answer! }));
  const r = await askAssistant({ db: c.deps.db, model: c.deps.assistantModel, role: c.staff.role, question: q, lang: L, now, history,
    sentry: c.deps.assistantSentry, github: c.deps.assistantGithub });
  try {
    await c.deps.db.rpc("ast_turn_log", { p_party: c.staff.partyId, p_role: c.staff.role, p_lang: L, p_question: q, p_answer: r.answer || null,
      p_tools: r.tools.map((x) => ({ name: x.name, input: x.input, ok: x.ok })), p_model: r.model, p_usd: r.usd, p_outcome: r.outcome });
  } catch (e) { console.error(JSON.stringify({ level: "error", event: "assistant_log_failed", err: String(e).slice(0, 200) })); }
  return done(turnHtml(L, { question: q, answer: r.answer, usd: r.usd, outcome: r.outcome, reason: r.reason }, admin));
}

export const assistantSection: Section = {
  // No menu entry of its own: the button on every page and the side panel open it (CON1's reserved place).
  nav: { href: "/assistant", label: "Assistant", roles: [] },
  routes: [
    { method: "GET", path: "/assistant", roles: LEADS, handler: page },
    { method: "POST", path: "/assistant", roles: LEADS, handler: ask },
  ],
};
