// AST1: the console assistant through the console itself (the rig: real migrations, real routes), with a scripted model.
//   - an ops lead and the admin ask from the panel and get the answer; the admin sees its cost; a picker has no assistant;
//   - the ops lead's model is never offered the money tools; the prompt and tools are cached; the turn and its cost are recorded;
//   - honesty: an answer with a figure no tool gave is rewritten once, and is not shown if it still has one; links only to console pages;
//   - over the cap the panel says so and the model is not called; off, it says it is off;
//   - the nightly digest is written from the facts and shown on Today; the guard's number reading; Sentry's and GitHub's readers.
import { beforeAll, describe, expect, it } from "vitest";
import { rig, type Rig } from "./kit";
import { NOW, seedWorld } from "../../../evals/assistant/world";
import { scriptedModel, switchOn } from "../../../evals/assistant/eval";
import { answerNumbers, numbersIn, renderAnswer, safeLink, supported, unsupportedNumbers } from "../src/assistant/guard";
import { githubReader, sentryReader, toolsFor } from "../src/assistant/tools";
import { writeDigest } from "../src/assistant/digest";
import type { ModelFn } from "../src/assistant/run";
import type Anthropic from "@anthropic-ai/sdk";

let r: Rig;
beforeAll(async () => {
  r = await rig();
  await seedWorld(r.db);
  await switchOn(r.db);
  r.deps.now = () => NOW;
}, 120_000);
const who = async (role: "admin" | "ops_lead" | "picker", name: string) => { const p = await r.staff(role, name); const b = r.browser(); await b.signIn(p); return { ...p, b }; };
const ask = (b: Awaited<ReturnType<typeof who>>["b"], q: string) => b.post("/assistant", { q }, { headers: { "x-ak-assistant": "1" } });

/** A model that answers with these texts in turn after the given tool calls. */
function sequence(tools: { name: string; input: Record<string, unknown> }[], answers: string[]) {
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  let n = 0;
  const fn: ModelFn = async (p) => {
    calls.push(JSON.parse(JSON.stringify(p)));
    const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Messages.Usage;
    const done = p.messages.some((m) => Array.isArray(m.content) && m.content.some((x) => (x as { type: string }).type === "tool_result"));
    if (tools.length && !done) return { model: p.model, stop_reason: "tool_use", usage, content: tools.map((t, i) => ({ type: "tool_use", id: `t${i}`, name: t.name, input: t.input })) as unknown as Anthropic.Messages.ContentBlock[] };
    return { model: p.model, stop_reason: "end_turn", usage, content: [{ type: "text", text: answers[Math.min(n++, answers.length - 1)]! }] as unknown as Anthropic.Messages.ContentBlock[] };
  };
  return Object.assign(fn, { calls });
}

describe("asking from the panel", () => {
  it("an ops lead asks what's late: the answer from the orders tool, a link to the page, no cost shown; money tools never offered", async () => {
    const m = scriptedModel({ tools: [{ name: "orders", input: {} }], answer: "One order is late: **AK-2006**, 30 minutes past its promise. [Orders](/orders)" });
    r.deps.assistantModel = m;
    const { b } = await who("ops_lead", "Lea");
    const res = await ask(b, "What's late right now?");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<strong>AK-2006</strong>");
    expect(res.text).toContain('<a href="/orders">Orders</a>');
    expect(res.text).not.toContain("ak-cost");
    const offered = m.calls[0]!.tools!.map((t) => (t as { name: string }).name);
    expect(offered).toContain("orders"); expect(offered).not.toContain("money"); expect(offered).not.toContain("model_spend");
    expect(offered).not.toContain("failed_runs");                                    // no GitHub token in the rig: not offered
    // cached: the fixed system prompt and the last tool carry a cache mark; the day and the role come in the message
    expect((m.calls[0]!.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect((m.calls[0]!.tools!.at(-1) as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    expect(m.calls[0]!.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(m.calls[0]!.messages)).toContain("Today is Wednesday 2026-11-18");
    expect(JSON.stringify(m.calls[0]!.messages)).toContain("an ops lead");
    const t = await r.db.one<any>(`select question, answer, outcome, tools, usd from assistant_turns where question = 'What''s late right now?'`);
    expect(t).toMatchObject({ outcome: "answered" }); expect(t.tools[0].name).toBe("orders"); expect(Number(t.usd)).toBeGreaterThan(0);
    const cost = await r.db.one<any>(`select sum(calls)::int as calls from model_costs where workflow = 'assistant' and step = 'answer'`);
    expect(cost.calls).toBeGreaterThanOrEqual(2);
  });
  it("the admin sees each answer's cost in small text, and the day's spend against the caps on the page", async () => {
    r.deps.assistantModel = scriptedModel({ tools: [{ name: "money", input: {} }], answer: "Sales today: $101.00 of goods; cash still to collect $42.00." });
    const { b } = await who("admin", "Ada");
    const res = await ask(b, "How much did we sell today?");
    expect(res.text).toContain("$101.00");
    expect(res.text).toMatch(/<p class="ak-cost"><bdi>\$0\.\d{4}<\/bdi><\/p>/);
    const page = (await b.get("/assistant")).text;
    expect(page).toContain("How much did we sell today?");
    expect(page).toMatch(/Spent today <bdi>\$0\.\d{4}<\/bdi> \/ <bdi>\$5\.00<\/bdi>/);
  });
  it("without the page script the form posts and /assistant shows the conversation", async () => {
    r.deps.assistantModel = scriptedModel({ tools: [], answer: "I can only read; a person refunds on the [Refunds](/refunds) page." });
    const { b } = await who("ops_lead", "Lea3");
    const res = await b.post("/assistant", { q: "Refund AK-2002" }, { follow: false });
    expect(res.status).toBe(303);
    expect((await b.get("/assistant")).text).toContain('<a href="/refunds">Refunds</a>');
  });
  it("a picker has no assistant: no button, no panel, and the route is refused", async () => {
    const { b } = await who("picker", "Pia");
    expect((await b.get("/stock")).text).not.toContain("ak-assistant");
    expect((await b.post("/assistant", { q: "What's late?" }, { headers: { "x-ak-assistant": "1" } })).status).toBe(403);
  });
});

describe("honesty", () => {
  it("a figure no tool gave is sent back once; the rewrite without it is shown", async () => {
    const m = sequence([{ name: "orders", input: {} }], ["We had 99 orders today.", "We had 7 orders today."]);
    r.deps.assistantModel = m;
    const { b } = await who("ops_lead", "Lea4");
    const res = await ask(b, "How many orders today?");
    expect(res.text).toContain("We had 7 orders today."); expect(res.text).not.toContain("99");
    expect(JSON.stringify(m.calls.at(-1)!.messages)).toContain("These figures are not in this turn's tool results: 99");
    expect((m.calls.at(-1)!.tool_choice as { type: string }).type).toBe("none");
  });
  it("still unsupported after the rewrite: nothing is shown but the plain refusal", async () => {
    r.deps.assistantModel = sequence([{ name: "orders", input: {} }], ["About 99 orders.", "Roughly 98 orders."]);
    const { b } = await who("ops_lead", "Lea5");
    const res = await ask(b, "How many orders today?");
    expect(res.text).toContain("could not answer this with figures from the data alone"); expect(res.text).not.toMatch(/9[89] orders/);
    const t = await r.db.one<any>(`select outcome from assistant_turns where question = 'How many orders today?' order by created_at desc limit 1`);
    expect(t.outcome).toBe("unverified");
  });
  it("a link that is not a console page keeps its words and loses its address", () => {
    const h = renderAnswer("See [Orders](/orders?kind=food), [this](https://example.com/x) and [that](/no-such-page).").s;
    expect(h).toContain('<a href="/orders?kind=food">Orders</a>'); expect(h).not.toContain("example.com"); expect(h).toContain("this"); expect(h).not.toContain("/no-such-page");
    expect(safeLink("//evil.com")).toBeNull(); expect(safeLink("/approve?tab=photos")).toBe("/approve?tab=photos");
    expect(renderAnswer("<script>x</script>").s).not.toContain("<script>");
  });
  it("numbers: Arabic digits, rounding, dates and list markers", () => {
    expect(numbersIn("٢٢ دقيقة و ٧٫٢")).toEqual([22, 7.2]);
    expect(answerNumbers("1. Late orders: 4\n2. [Orders](/orders/2026)")).toEqual([4]);
    expect(supported(0.53, [0.5286])).toBe(true); expect(supported(43, [42.6])).toBe(true); expect(supported(44, [42.6])).toBe(false);
    expect(unsupportedNumbers("On 2026-11-17 at 14:30, 1,234 units", ["2026-11-17 14:30", "1234"])).toEqual([]);
  });
});

describe("caps and off", () => {
  it("over the daily cap the panel says so and the model is not called", async () => {
    const m = sequence([], ["never"]);
    r.deps.assistantModel = m;
    await r.db.pg.exec(`update settings set value = value || '{"daily_cap_usd": 0}'::jsonb where key = 'assistant'`);
    try {
      const { b } = await who("admin", "Ada2");
      const res = await ask(b, "What's late?");
      expect(res.text).toContain("assistant budget is used up");
      expect(m.calls).toHaveLength(0);
      expect((await b.get("/assistant")).text).toContain("assistant budget is used up");
    } finally { await r.db.pg.exec(`update settings set value = value || '{"daily_cap_usd": 5}'::jsonb where key = 'assistant'`); }
  });
  it("switched off, it says it is off", async () => {
    await r.db.pg.exec(`update settings set value = value || '{"enabled": false}'::jsonb where key = 'assistant'`);
    try {
      const { b } = await who("ops_lead", "Lea6");
      expect((await ask(b, "What's late?")).text).toContain("The assistant is off.");
    } finally { await switchOn(r.db); }
  });
  it("without a model key it says it is not connected", async () => {
    const keep = r.deps.assistantModel; delete r.deps.assistantModel;
    try { const { b } = await who("ops_lead", "Lea7"); expect((await b.get("/assistant")).text).toContain("not connected"); }
    finally { r.deps.assistantModel = keep; }
  });
});

describe("the nightly digest", () => {
  it("is written from the facts in English and Arabic (a text with a figure not in the facts is asked again), and Today shows it", async () => {
    const m = sequence([], [JSON.stringify({ en: "Went wrong: 9 late.", ar: "تأخر 9." }),
      JSON.stringify({ en: "Went well: 2 delivered on time.\nWent wrong: 4 late orders.\nTop 3 to fix:\n1. Late orders: 4 [Orders](/orders)", ar: "سار جيداً: 2 في الوقت.\nتأخر 4 طلبات.\n1. الطلبات المتأخرة: 4 [الطلبات](/orders)" })]);
    const out = await writeDigest(r.deps.db, m, NOW, "2026-11-18");
    expect(out).toMatchObject({ saved: true, text: true });
    expect(m.calls[0]!.model).toBe("claude-haiku-5-5");
    const row = await r.db.one<any>(`select facts, text_en from assistant_digests where day = '2026-11-18'`);
    expect(row.text_en).toContain("4 late orders"); expect(row.facts.orders.orders).toBe(7);
    const { b } = await who("ops_lead", "Lea8");
    const today = (await b.get("/")).text;
    expect(today).toContain("Digest of 2026-11-18"); expect(today).toContain("4 late orders");
  });
  it("is not written while the assistant is off", async () => {
    await r.db.pg.exec(`update settings set value = value || '{"enabled": false}'::jsonb where key = 'assistant'`);
    try { expect(await writeDigest(r.deps.db, sequence([], ["{}"]), NOW, "2026-11-16")).toMatchObject({ saved: false, reason: "off" }); }
    finally { await switchOn(r.db); }
  });
});

describe("the two outside reads", () => {
  it("Sentry: with the read-only token, the count and the top issues; a failure is null (unknown, never 0); absent without a token", async () => {
    const seen: string[] = [];
    const ok = (async (u: string | URL | Request, init?: RequestInit) => { seen.push(String(u) + " " + JSON.stringify(init?.headers)); return String(u).includes("/events/") ? Response.json({ data: [{ "count()": 3 }] }) : Response.json([{ title: "TypeError", count: "3", lastSeen: "2026-11-18T12:40:00Z" }]); }) as typeof fetch;
    const read = sentryReader({ SENTRY_READ_TOKEN: "tok", SENTRY_ORG: "alo-king", SENTRY_API: "https://de.sentry.io", ENVIRONMENT: "staging" }, ok)!;
    expect(await read()).toMatchObject({ count: 3, issues: [{ title: "TypeError", events: 3 }] });
    expect(seen[0]).toContain("https://de.sentry.io/api/0/organizations/alo-king/events/"); expect(seen[0]).toContain("Bearer tok");
    expect(await sentryReader({ SENTRY_READ_TOKEN: "tok", SENTRY_ORG: "alo-king" }, (async () => new Response("no", { status: 500 })) as typeof fetch)!()).toBeNull();
    expect(sentryReader({ SENTRY_ORG: "alo-king" })).toBeUndefined();
  });
  it("GitHub: failed runs in the last 24 hours with a read-only token; without it the tool is not offered", async () => {
    let url = "";
    const gh = githubReader({ GITHUB_READ_TOKEN: "t", GITHUB_REPO: "owner/repo" }, () => NOW, (async (u: string) => { url = String(u); return Response.json({ workflow_runs: [{ name: "ci", head_branch: "main", run_started_at: "2026-11-18T10:00:00Z", html_url: "https://github.com/x" }] }); }) as unknown as typeof fetch)!;
    expect((await gh())!.failed).toEqual([{ workflow: "ci", branch: "main", started: "2026-11-18T10:00", url: "https://github.com/x" }]);
    expect(url).toContain("status=failure"); expect(decodeURIComponent(url)).toContain("created=>=2026-11-17T13:00:00Z");
    expect(githubReader({ GITHUB_REPO: "owner/repo" }, () => NOW)).toBeUndefined();
    expect(toolsFor({ db: r.deps.db, now: NOW, role: "admin", github: gh }).map((t) => t.name)).toContain("failed_runs");
    expect(toolsFor({ db: r.deps.db, now: NOW, role: "picker" })).toEqual([]);
  });
});
