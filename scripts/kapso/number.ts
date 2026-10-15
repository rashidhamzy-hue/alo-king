// The kapso-number workflow (DECISIONS §39.8, owner issue #170): once the US test number is connected in the Kapso project
// "Alo King", this records it, submits every template in supabase/functions/_shared/whatsapp-templates.ts to Meta (once
// per name and language) and mirrors Meta's answers into public.whatsapp_templates. It runs daily and on demand, and
// changes nothing while the project has only the sandbox number. Kapso is reached only at https://api.kapso.ai
// (CLAUDE.md). Nothing is printed from a response body except error text and template statuses.
//
// Env: KAPSO_API_KEY, DB_URL (staging, scripts/staging-db-url.sh). Writes `new_number=<id>` and `numbers=<ids>` to
// GITHUB_OUTPUT when a number was added, so the workflow re-registers the webhooks and uploads the Flows.
import { appendFileSync } from "node:fs";
import pg from "pg";
import {
  TEMPLATES,
  TEMPLATE_LANGS,
  metaTemplateCreate,
} from "../../supabase/functions/_shared/whatsapp-templates";

const KAPSO = "https://api.kapso.ai";
const key = process.env.KAPSO_API_KEY ?? "";

export type KapsoNumber = {
  phone_number_id: string;
  business_account_id: string | null;
  kind: string | null;
  display_phone_number: string | null;
  /** Meta's messaging limit (TIER_250, TIER_2K, ...); null when Kapso does not say. */
  messaging_tier?: string | null;
};

async function kapso(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${KAPSO}${path}`, {
    ...init,
    redirect: "error",
    headers: { "X-API-Key": key, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new KapsoError(res.status, path, body?.error ?? body);
  return body;
}

export class KapsoError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: any,
  ) {
    super(`kapso ${status} ${path}: ${JSON.stringify(detail).slice(0, 600)}`);
  }
}

/** The project's numbers that can send templates: everything but Kapso's shared sandbox. */
export function productionNumbers(rows: any[]): KapsoNumber[] {
  return rows
    .filter(
      (r) =>
        r && r.kind !== "sandbox" && /^[0-9]{3,30}$/.test(String(r.phone_number_id ?? r.id ?? "")),
    )
    .map((r) => ({
      phone_number_id: String(r.phone_number_id ?? r.id),
      business_account_id: r.business_account_id ? String(r.business_account_id) : null,
      kind: r.kind ?? null,
      display_phone_number: r.display_phone_number_normalized ?? r.display_phone_number ?? null,
      messaging_tier: r.whatsapp_business_manager_messaging_limit ?? r.messaging_limit_tier ?? null,
    }));
}

/** Meta's messaging limit as a number of conversations a day (TIER_250 -> 250, TIER_2K -> 2000, TIER_UNLIMITED -> ∞). */
export function tierLimit(tier: string | null | undefined): number | null {
  const m = /^TIER_(\d+)(K)?$/i.exec(String(tier ?? ""));
  if (m) return Number(m[1]) * (m[2] ? 1000 : 1);
  return /UNLIMITED/i.test(String(tier ?? "")) ? Infinity : null;
}

/**
 * Why a template could not be submitted. `blocked`: Meta will not take this kind of template on this number yet, which
 * no change to the template can fix (authentication templates need the 2K messaging tier, normally reached through
 * business verification: error 10 / 2388185). `refused`: everything else, which the workflow fails on.
 */
export function classifySubmitError(
  category: string,
  detail: any,
  tier: string | null | undefined,
): { kind: "blocked" | "refused"; reason: string } {
  const code = Number(detail?.code);
  const sub = Number(detail?.error_subcode);
  const msg = String(
    detail?.error_user_msg ?? detail?.message ?? JSON.stringify(detail ?? ""),
  ).slice(0, 300);
  const limit = tierLimit(tier);
  if (
    category === "AUTHENTICATION" &&
    code === 10 &&
    sub === 2388185 &&
    (limit === null || limit < 2000)
  )
    return {
      kind: "blocked",
      reason: `authentication templates need Meta's 2K messaging tier (this number: ${tier ?? "unknown"}); business verification of the portfolio unlocks it`,
    };
  return { kind: "refused", reason: msg };
}

/** One line per registry template and language (45 today), with Meta's answer. */
export function statusReport(
  rows: {
    name: string;
    language: string;
    category: string;
    status: string;
    reason: string | null;
  }[],
  blocked: Map<string, string>,
  refused: Map<string, string>,
) {
  const by = new Map(rows.map((r) => [`${r.name}/${r.language}`, r]));
  return TEMPLATES.flatMap((t) =>
    TEMPLATE_LANGS.map((lang) => {
      const k = `${t.name}/${lang}`;
      const r = by.get(k);
      const status =
        r?.status ?? (blocked.has(k) ? "blocked" : refused.has(k) ? "refused" : "missing");
      return {
        name: t.name,
        language: lang,
        ours: t.category,
        meta_category: r?.category ?? null,
        status,
        note: r?.reason ?? blocked.get(k) ?? refused.get(k) ?? null,
      };
    }),
  );
}

/** What to submit: every registry template and language Meta does not have yet on this account. */
export function missingTemplates(existing: { name: string; language: string }[]) {
  const have = new Set(existing.map((t) => `${t.name}/${t.language}`));
  return TEMPLATES.flatMap((t) => TEMPLATE_LANGS.map((lang) => ({ t, lang }))).filter(
    ({ t, lang }) => !have.has(`${t.name}/${lang}`),
  );
}

/** Meta's template list as rows for public.whatsapp_template_sync (only names in the registry). */
export function syncRows(meta: any[]) {
  const ours = new Set(TEMPLATES.map((t) => t.name));
  return meta
    .filter((t) => ours.has(String(t?.name)) && ["ar", "en", "fr"].includes(String(t?.language)))
    .map((t) => ({
      name: String(t.name),
      language: String(t.language),
      category: String(t.category ?? "UTILITY").toUpperCase(),
      status: String(t.status ?? "pending").toLowerCase(),
      meta_template_id: t.id ? String(t.id) : null,
      reason: t.rejected_reason && t.rejected_reason !== "NONE" ? String(t.rejected_reason) : null,
    }));
}

async function metaTemplates(waba: string): Promise<any[]> {
  const out: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({
      limit: "100",
      fields: "id,name,language,status,category,rejected_reason",
    });
    if (after) q.set("after", after);
    const j = await kapso(
      `/meta/whatsapp/v24.0/${encodeURIComponent(waba)}/message_templates?${q}`,
    );
    out.push(...(j?.data ?? []));
    after = j?.paging?.cursors?.after ?? null;
    if (!after || !j?.paging?.next) break;
  }
  return out;
}

async function main() {
  if (!key) throw new Error("KAPSO_API_KEY is not set");
  const list = await kapso("/platform/v1/whatsapp/phone_numbers?per_page=100");
  const numbers = productionNumbers(list?.data ?? []);
  if (!numbers.length) {
    console.log(
      "Only the sandbox number in the Kapso project: waiting on owner issue #170. Nothing changed.",
    );
    return;
  }
  const url = new URL(process.env.DB_URL ?? "");
  url.searchParams.delete("sslmode");
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const failures: string[] = [];
  try {
    const added: string[] = [];
    for (const n of numbers) {
      if (!n.business_account_id) {
        console.log(`number ${n.phone_number_id}: no business account yet (setup not finished)`);
        continue;
      }
      // The US test number speaks to both sides until cut-over (session 14 adds the company numbers by role).
      const r = await db.query(
        `insert into public.whatsapp_numbers (phone_number_id, role, waba_id, display_phone, active)
         values ($1, 'test', $2, case when $3 ~ '^\\+[1-9][0-9]{6,14}$' then $3 end, true)
         on conflict (phone_number_id) do update set waba_id = excluded.waba_id
         returning (xmax = 0) as inserted`,
        [n.phone_number_id, n.business_account_id, n.display_phone_number],
      );
      if (r.rows[0]?.inserted) added.push(n.phone_number_id);
      // Templates: submit what Meta does not have, then mirror every status.
      const before = await metaTemplates(n.business_account_id);
      const blocked = new Map<string, string>();
      const refused = new Map<string, string>();
      for (const { t, lang } of missingTemplates(before)) {
        try {
          await kapso(
            `/meta/whatsapp/v24.0/${encodeURIComponent(n.business_account_id)}/message_templates`,
            {
              method: "POST",
              body: JSON.stringify(metaTemplateCreate(t, lang)),
            },
          );
          console.log(`submitted ${t.name} (${lang})`);
        } catch (e) {
          const c = classifySubmitError(
            t.category,
            e instanceof KapsoError ? e.detail : String(e),
            n.messaging_tier,
          );
          (c.kind === "blocked" ? blocked : refused).set(`${t.name}/${lang}`, c.reason);
          console.log(
            `::${c.kind === "blocked" ? "warning" : "error"}::${t.name} (${lang}) ${c.kind}: ${c.reason}`,
          );
        }
      }
      const rows = syncRows(await metaTemplates(n.business_account_id));
      const report = statusReport(rows, blocked, refused);
      console.log(
        `\n| template | lang | our category | Meta category | Meta status | note |\n|---|---|---|---|---|---|`,
      );
      for (const x of report)
        console.log(
          `| ${x.name} | ${x.language} | ${x.ours} | ${x.meta_category ?? ""} | ${x.status} | ${(x.note ?? "").replace(/\|/g, "/")} |`,
        );
      for (const x of report.filter((x) => x.meta_category && x.meta_category !== x.ours))
        console.log(
          `::warning::${x.name} (${x.language}): Meta filed it as ${x.meta_category}, we registered ${x.ours}`,
        );
      for (const x of report.filter(
        (x) => x.status === "rejected" || x.status === "refused" || x.status === "missing",
      ))
        failures.push(`${x.name} (${x.language}) ${x.status}${x.note ? `: ${x.note}` : ""}`);
      await db.query("select public.whatsapp_template_sync($1, $2::jsonb)", [
        n.business_account_id,
        JSON.stringify(rows),
      ]);
      const by = (s: string) => rows.filter((x) => x.status === s).length;
      console.log(
        `account ${n.business_account_id}: ${rows.length} templates, ${by("approved")} approved, ${by("pending")} pending, ${by("rejected")} rejected`,
      );
      for (const x of rows.filter((x) => x.status === "rejected"))
        console.log(`::warning::rejected: ${x.name} (${x.language}) ${x.reason ?? ""}`);
    }
    if (added.length && process.env.GITHUB_OUTPUT) {
      const all = (
        await db.query(
          "select phone_number_id from public.whatsapp_numbers where active order by created_at",
        )
      ).rows
        .map((x) => x.phone_number_id)
        .join(" ");
      appendFileSync(process.env.GITHUB_OUTPUT, `new_number=${added[0]}\nnumbers=${all}\n`);
    }
  } finally {
    await db.end();
  }
  // Any refused, rejected or missing template fails the run (a blocked one is reported, not failed: see classifySubmitError).
  if (failures.length) {
    for (const f of failures) console.log(`::error::${f}`);
    throw new Error(`${failures.length} template version(s) refused or rejected by Meta`);
  }
}

if (process.argv[1]?.endsWith("number.ts")) {
  main().catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  });
}
