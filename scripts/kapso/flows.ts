// The whatsapp-flows workflow (DECISIONS §12, §39.8): uploads every Flow in whatsapp/flows/ to Kapso on one WhatsApp number,
// sets up Flow encryption on the number's business account, publishes the drafts when asked, switches each published Flow
// on (a dated `flows_enabled` row), and can send one test of each Flow to the owner. Replaces the `flowso deploy` loop,
// whose output was not pure JSON (run 38762070639 stopped after the first upload with jq exit code 5).
//
// Kapso is reached only at https://api.kapso.ai (CLAUDE.md). Env: KAPSO_API_KEY, PHONE_NUMBER_ID; PUBLISH=true to publish;
// DB_URL (staging) to switch published Flows on and for the test sends; SEND_TESTS=true to send the tests. The test
// recipient is read from the number's inbound log (the one Lebanese number that wrote to it in the last 24 hours and is an
// owner phone on staging), never configured: a Flow is free-form, so it only reaches someone inside their 24-hour window.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  flowMessage,
  publishedFlowName,
  type FlowName,
} from "../../supabase/functions/_shared/flows";

const KAPSO = "https://api.kapso.ai";
const key = process.env.KAPSO_API_KEY ?? "";
const DIR = "whatsapp/flows";

export type KapsoFlow = { id: string; name: string; status: string; meta_flow_id?: string | null };
export type FlowFile = { flow: FlowName; lang: "ar" | "en"; name: string; json: any; path: string };

async function kapso(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${KAPSO}${path}`, {
    ...init,
    redirect: "error",
    headers: { "X-API-Key": key, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `kapso ${res.status} ${path.split("?")[0]}: ${JSON.stringify(body?.error ?? body).slice(0, 600)}`,
    );
  return body;
}

/** The Flow files, one per Flow and language: whatsapp/flows/<flow>.<lang>.json -> alo_<flow>_<lang>. */
export function flowFiles(dir = DIR): FlowFile[] {
  return readdirSync(dir)
    .filter((f) => /^[a-z_]+\.(ar|en)\.json$/.test(f))
    .sort()
    .map((f) => {
      const [flow, lang] = f.replace(/\.json$/, "").split(".") as [FlowName, "ar" | "en"];
      return {
        flow,
        lang,
        name: publishedFlowName(flow, lang),
        json: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")),
        path: f,
      };
    });
}

/**
 * A Flow needs a data endpoint when it exchanges data with a server while open (`data_api_version` or a `data_exchange`
 * action). The §12 Flows are navigate-only (the server sends their data with the message); the Alo King app
 * (DECISIONS §39.15.13) is the one dynamic Flow, served by flow-app through Kapso's data-endpoint function.
 */
export function needsDataEndpoint(json: any): boolean {
  return !!json?.data_api_version || JSON.stringify(json ?? {}).includes('"data_exchange"');
}

/** What to do with each file given the Flows already on the number. */
export function flowPlan(files: FlowFile[], existing: KapsoFlow[], publish: boolean) {
  const by = new Map(existing.map((f) => [f.name, f]));
  return files.map((f) => {
    const cur = by.get(f.name) ?? null;
    const action: "create" | "update" | "keep" = !cur
      ? "create"
      : cur.status === "draft"
        ? "update"
        : "keep";
    return { file: f, current: cur, action, publish: publish && action !== "keep" };
  });
}

/** Meta's validation errors from a create or version answer (an empty list means the JSON was accepted). */
export function validationErrors(answer: any): string[] {
  const d = answer?.data ?? answer ?? {};
  const list: any[] =
    d.validation_errors ?? d.flow_version?.validation_errors ?? d.version?.validation_errors ?? [];
  return list.map((e) => String(e?.message ?? e?.error ?? JSON.stringify(e)).slice(0, 200));
}

/**
 * The test recipient from the inbound log: the Lebanese numbers (+961) that wrote to this number in the last 24 hours,
 * kept only if they are owner phones on staging. Exactly one must remain, or nothing is sent.
 */
export function testRecipient(
  inbound: { from?: string | null; timestamp?: string | number | null }[],
  owners: string[],
  now = Date.now(),
): string | null {
  const recent = new Set<string>();
  for (const m of inbound) {
    const from = `+${String(m.from ?? "").replace(/^\+/, "")}`;
    const at = Number(m.timestamp) * 1000;
    if (!/^\+961[0-9]{7,8}$/.test(from) || !Number.isFinite(at) || now - at > 23.5 * 3600_000)
      continue;
    recent.add(from);
  }
  const owned = [...recent].filter((p) => owners.includes(p));
  return owned.length === 1 ? owned[0] : null;
}

async function listFlows(pn: string): Promise<KapsoFlow[]> {
  const j = await kapso(
    `/platform/v1/whatsapp/flows?phone_number_id=${encodeURIComponent(pn)}&per_page=100`,
  );
  return (j?.data ?? []).map((f: any) => ({
    id: String(f.id),
    name: String(f.name),
    status: String(f.status),
    meta_flow_id: f.meta_flow_id ?? null,
  }));
}

async function main() {
  const pn = process.env.PHONE_NUMBER_ID ?? "";
  if (!key) throw new Error("KAPSO_API_KEY is not set");
  if (!/^[0-9]{6,20}$/.test(pn)) throw new Error("PHONE_NUMBER_ID is not a phone number id");
  const publish = process.env.PUBLISH === "true";
  const files = flowFiles();
  const failures: string[] = [];
  for (const f of files)
    if (needsDataEndpoint(f.json) && f.flow !== "app")
      failures.push(
        `${f.name} exchanges data while open and needs a data endpoint, which only the app has`,
      );
  if (failures.length) throw new Error(failures.join("; "));

  const plan = flowPlan(files, await listFlows(pn), publish);
  const rows: { name: string; action: string; status: string; note: string }[] = [];
  for (const p of plan) {
    try {
      let id = p.current?.id ?? null;
      if (p.action === "create") {
        const a = await kapso("/platform/v1/whatsapp/flows", {
          method: "POST",
          body: JSON.stringify({
            phone_number_id: pn,
            name: p.file.name,
            flow_json: p.file.json,
            publish: false,
          }),
        });
        id = String(a?.data?.id ?? a?.id ?? "");
        const errs = validationErrors(a);
        if (errs.length) throw new Error(`Meta validation: ${errs.join(" | ")}`);
      } else if (p.action === "update") {
        const a = await kapso(`/platform/v1/whatsapp/flows/${id}/versions`, {
          method: "POST",
          body: JSON.stringify({ flow_json: p.file.json, phone_number_id: pn }),
        });
        const errs = validationErrors(a);
        if (errs.length) throw new Error(`Meta validation: ${errs.join(" | ")}`);
      }
      rows.push({
        name: p.file.name,
        action: p.action,
        status: p.current?.status ?? "draft",
        note: id ?? "",
      });
    } catch (e) {
      failures.push(`${p.file.name}: ${String(e).slice(0, 400)}`);
      rows.push({
        name: p.file.name,
        action: p.action,
        status: "failed",
        note: String(e).slice(0, 200),
      });
    }
  }

  let encryptionFailed = false;
  // Encryption is per business account; Kapso sets it up through any Flow of the number (and verifies it on Meta).
  const flows = await listFlows(pn);
  if (flows.length) {
    try {
      await kapso(`/platform/v1/whatsapp/flows/${flows[0].id}/setup_encryption`, {
        method: "POST",
        body: JSON.stringify({ phone_number_id: pn }),
      });
      console.log("Flow encryption: configured on the number's business account");
    } catch (e) {
      encryptionFailed = true;
      failures.push(`encryption: ${String(e).slice(0, 300)}`);
    }
  }
  // The app's data endpoint (§39.15.13): Kapso's function forwards each decrypted request to flow-app, signed with the
  // proxy key read from staging. Drafts only: a published Flow keeps the endpoint it was published with.
  for (const p of plan.filter((x) => needsDataEndpoint(x.file.json))) {
    const f = flows.find((x) => x.name === p.file.name && x.status === "draft");
    if (!f) continue;
    if (encryptionFailed) {
      failures.push(`${f.name}: no data endpoint without Flow encryption`);
      continue;
    }
    try {
      await attachEndpoint(f.id, pn, p.file.json);
      console.log(`Data endpoint: ${f.name} → flow-app (eu-central-1), registered`);
    } catch (e) {
      failures.push(`data endpoint ${f.name}: ${String(e).slice(0, 400)}`);
      const r = rows.find((x) => x.name === f.name);
      if (r) r.status = "failed";
    }
  }

  // Publish only what was uploaded without an error in this run (a failed upload never publishes an older draft).
  const published: string[] = [];
  if (publish) {
    const uploaded = new Set(rows.filter((r) => r.status !== "failed").map((r) => r.name));
    for (const p of plan.filter((x) => x.publish && uploaded.has(x.file.name))) {
      const f = flows.find((x) => x.name === p.file.name && x.status === "draft");
      if (!f) continue;
      try {
        await kapso(`/platform/v1/whatsapp/flows/${f.id}/publish`, {
          method: "POST",
          body: JSON.stringify({ phone_number_id: pn }),
        });
        published.push(f.name);
        const r = rows.find((x) => x.name === f.name);
        if (r) r.status = "published";
      } catch (e) {
        failures.push(`publish ${f.name}: ${String(e).slice(0, 300)}`);
      }
    }
  }
  for (const p of plan.filter((x) => x.action === "keep"))
    console.log(
      `::notice::${p.file.name} is published and kept as it is (a published Flow cannot change; a new version needs a new name)`,
    );

  const final = await listFlows(pn);
  console.log("\n| Flow | action | status on Kapso/Meta |\n|---|---|---|");
  for (const f of files) {
    const k = final.find((x) => x.name === f.name);
    const r = rows.find((x) => x.name === f.name);
    console.log(
      `| ${f.name} | ${r?.action ?? ""} | ${k?.status ?? "missing"}${r?.status === "failed" ? ` (failed: ${r.note.replace(/\|/g, "/")})` : ""} |`,
    );
  }

  // Live: both languages published on the number. Switched on: each Flow that became live through a publish in this run
  // (a failure of another Flow does not hold it back: a published Flow is never published again, so it would stay off for
  // good); a failed encryption set-up holds back all. A Flow an operator switched off, or one the §12 kill-gate stopped,
  // is never switched on again by a later run (a new flows_enabled row also restarts every Flow's kill-gate window).
  const both = (flow: string) => files.filter((f) => f.flow === flow);
  const live = [...new Set(files.map((f) => f.flow))].filter((flow) =>
    both(flow).every((f) => final.find((x) => x.name === f.name)?.status === "published"),
  );
  // The app is switched on by its own dated row (flow_app_live), not flows_enabled.
  const appOn = live.includes("app") && both("app").some((f) => published.includes(f.name));
  const switchOn = live.filter(
    (flow) => flow !== "app" && both(flow).some((f) => published.includes(f.name)),
  );
  // Staging only: DB_URL comes from scripts/staging-db-url.sh, which refuses any other project (never production).
  if (process.env.DB_URL && (switchOn.length || appOn || process.env.SEND_TESTS === "true")) {
    const url = new URL(process.env.DB_URL);
    url.searchParams.delete("sslmode");
    const db = new pg.Client({
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    try {
      if (publish && switchOn.length && !encryptionFailed) {
        const cur =
          (await db.query("select public.config_value('flows_enabled') as v")).rows[0]?.v ?? {};
        const next = { ...cur, ...Object.fromEntries(switchOn.map((f) => [f, true])) };
        await db.query(
          "insert into public.app_config (key, value, effective_from, note) values ('flows_enabled', $1::jsonb, now(), $2)",
          [
            JSON.stringify(next),
            `Flows published on ${pn} by whatsapp-flows (DECISIONS §12, §39.8)`,
          ],
        );
        console.log(`flows_enabled: ${switchOn.join(", ")} switched on`);
      }
      if (publish && appOn && !encryptionFailed) {
        await db.query(
          "insert into public.app_config (key, value, effective_from, note) values ('flow_app_live', 'true'::jsonb, now(), $1)",
          [`Alo King app published on ${pn} by whatsapp-flows (DECISIONS §39.15.13)`],
        );
        console.log(
          "flow_app_live: on (the bot opens the app from Order, Explore and the ice breakers)",
        );
      }
      if (process.env.SEND_TESTS === "true") {
        const enabled =
          (await db.query("select public.config_value('flows_enabled') as v")).rows[0]?.v ?? {};
        failures.push(
          ...(await sendTests(
            db,
            pn,
            live.filter(
              (f) => f !== "app" && (enabled === true || enabled?.[f] === true),
            ) as FlowName[],
          )),
        );
      }
    } finally {
      await db.end();
    }
  }
  if (failures.length) {
    for (const f of failures) console.log(`::error::${f}`);
    throw new Error(`${failures.length} Flow step(s) failed`);
  }
}

/** The proxy function's code (whatsapp/flows/endpoint/flow-app-proxy.js), its secrets, registration, then a compile. */
async function attachEndpoint(flowId: string, pn: string, json: any) {
  const ref = process.env.SUPABASE_PROJECT_REF ?? "";
  if (!/^[a-z]{20}$/.test(ref)) throw new Error("SUPABASE_PROJECT_REF is not a project ref");
  if (!process.env.DB_URL)
    throw new Error("DB_URL is not set (the proxy key is read from staging)");
  const url = new URL(process.env.DB_URL);
  url.searchParams.delete("sslmode");
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  let key: string;
  try {
    key = String((await db.query("select public.flow_app_proxy_key() as k")).rows[0]?.k ?? "");
  } finally {
    await db.end();
  }
  if (!/^[0-9a-f]{64}$/.test(key))
    throw new Error("no proxy key on staging (migration 20261017180000 not applied?)");
  // Never printed, even in an error body Kapso might echo.
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${key}`);
  const code = readFileSync(`${DIR}/endpoint/flow-app-proxy.js`, "utf8");
  const path = `/platform/v1/whatsapp/flows/${flowId}`;
  await kapso(`${path}/data_endpoint`, { method: "POST", body: JSON.stringify({ code }) });
  const dep = await kapso(`${path}/data_endpoint/deploy`, { method: "POST", body: "{}" });
  const depStatus = dep?.data?.status ?? dep?.status;
  if (depStatus && depStatus !== "deployed")
    throw new Error(`function not deployed (${depStatus})`);
  const ep = await kapso(`${path}/data_endpoint`);
  const fid = String(ep?.data?.function_id ?? ep?.function_id ?? "");
  if (!fid) throw new Error("Kapso returned no function id for the data endpoint");
  for (const [name, value] of [
    [
      "FLOW_APP_URL",
      `https://${ref}.supabase.co/functions/v1/flow-app?forceFunctionRegion=eu-central-1`,
    ],
    ["FLOW_APP_PROXY_KEY", key],
  ])
    await kapso(`/platform/v1/functions/${encodeURIComponent(fid)}/secrets`, {
      method: "POST",
      body: JSON.stringify({ secret: { name, value } }),
    });
  console.log(
    `Data endpoint function ${fid}: code ${createHash("sha256").update(code).digest("hex").slice(0, 12)}, 2 secrets set`,
  );
  const reg = await kapso(`${path}/data_endpoint/register`, {
    method: "POST",
    body: JSON.stringify({ phone_number_id: pn }),
  });
  if ((reg?.data ?? reg)?.flow_has_encryption === false)
    throw new Error("Kapso reports no Flow encryption");
  const compiled = await kapso(`${path}/versions`, {
    method: "POST",
    body: JSON.stringify({ flow_json: json, phone_number_id: pn }),
  });
  const errs = validationErrors(compiled);
  if (errs.length)
    throw new Error(`Meta validation after registering the endpoint: ${errs.join(" | ")}`);
}

/** One test of each live Flow to the owner, opened by the server exactly as the bot would open it (real token and data). */
async function sendTests(db: pg.Client, pn: string, live: FlowName[]): Promise<string[]> {
  const inbound = await kapso(
    `/platform/v1/whatsapp/messages?phone_number_id=${encodeURIComponent(pn)}&direction=inbound&limit=100`,
  );
  const owners = (await db.query("select phone_e164 from app_private.owner_phones")).rows.map((r) =>
    String(r.phone_e164),
  );
  const to = testRecipient(inbound?.data ?? [], owners);
  if (!to)
    return [
      "test sends: no single owner phone wrote to this number in the last 24 hours (a Flow is free-form)",
    ];
  const out: string[] = [];
  const who = (
    await db.query(
      `select c.id as customer_id,
              (select a.id from public.addresses a where a.customer_id = c.id order by a.is_default desc, a.last_used_at desc nulls last limit 1) as address_id,
              (select m.id from public.vendor_members m join public.vendors v on v.id = m.vendor_id
                where m.phone_e164 = c.phone_e164 and m.status = 'active' and m.role in ('owner', 'manager') and v.is_test
                order by m.created_at limit 1) as member_id
         from public.customers c where c.phone_e164 = $1`,
      [to],
    )
  ).rows[0];
  if (!who?.customer_id) return ["test sends: the owner phone is not a customer on staging yet"];
  const vendor = who.member_id
    ? (await db.query("select vendor_id from public.vendor_members where id = $1", [who.member_id]))
        .rows[0]?.vendor_id
    : null;
  // An item with options at the test shop, and an open basket for the checkout test (one item is added when none is open).
  const item = vendor
    ? (
        await db.query(
          `select i.id from public.menu_items i
            where i.vendor_id = $1 and (select count(*) from public.menu_option_groups g where g.item_id = i.id) between 1 and 3
            order by (select count(*) from public.menu_option_groups g where g.item_id = i.id) desc, i.sort_order limit 1`,
          [vendor],
        )
      ).rows[0]?.id
    : null;
  for (const flow of live) {
    for (const lang of ["ar", "en"] as const) {
      // One test never stops the others: a refusal or a database error is reported and the loop carries on.
      try {
        const ctx: Record<string, unknown> = {};
        let member: string | null = null;
        if (
          !vendor &&
          ["checkout", "menu_section", "item_options", "merchant_claim", "merchant_hours"].includes(
            flow,
          )
        ) {
          out.push(
            `test ${flow} (${lang}): the owner phone is not an owner or manager of a staging test shop`,
          );
          continue;
        }
        if (flow === "address_capture") ctx.address_id = who.address_id;
        if (flow === "item_options") ctx.item_id = item;
        if (flow === "merchant_claim" || flow === "merchant_hours") member = who.member_id;
        if (flow === "checkout") {
          const open = (
            await db.query(
              "select 1 from public.baskets where customer_id = $1 and status = 'open'",
              [who.customer_id],
            )
          ).rows.length;
          if (!open && vendor) {
            const plain = (
              await db.query(
                `select i.id from public.menu_items i where i.vendor_id = $1 and i.available
                and not exists (select 1 from public.menu_option_groups g where g.item_id = i.id and g.min_select > 0) order by i.sort_order limit 1`,
                [vendor],
              )
            ).rows[0]?.id;
            if (plain)
              await db.query("select public.basket_add_item($1, $2, 1)", [who.customer_id, plain]);
          }
        }
        if (flow === "menu_section") {
          member = who.member_id;
          // A one-section draft on the test shop; confirming it adds one test item there (staging only).
          const d = (
            await db.query(
              `select public.menu_draft_create($1, 'text', $2::jsonb, '[]', null, $3) as r`,
              [
                vendor,
                JSON.stringify([
                  {
                    name_en: "Flow test",
                    currency: "USD",
                    items: [{ name_en: "Flow test item", price: 0.5, currency: "USD" }],
                  },
                ]),
                member,
              ],
            )
          ).rows[0]?.r;
          ctx.draft_id = d?.draft_id ?? d?.id ?? d;
          ctx.index = 0;
        }
        const r = (
          await db.query("select public.flow_open($1, $2, $3, $4, $5, $6::jsonb) as r", [
            flow,
            lang,
            to,
            member ? null : who.customer_id,
            member,
            JSON.stringify(ctx),
          ])
        ).rows[0]?.r;
        if (r?.status !== "ok") {
          out.push(
            `test ${flow} (${lang}): flow_open answered ${r?.status ?? "nothing"}${r?.reason ? ` (${r.reason})` : ""}`,
          );
          continue;
        }
        try {
          const sent = await kapso(`/meta/whatsapp/v24.0/${encodeURIComponent(pn)}/messages`, {
            method: "POST",
            body: JSON.stringify(
              flowMessage(to, { flow, lang, token: r.token, screen: r.screen, data: r.data }),
            ),
          });
          console.log(
            `test sent: ${publishedFlowName(flow, lang)} (${sent?.messages?.[0]?.id ? "accepted by Meta" : "sent"})`,
          );
        } catch (e) {
          out.push(`test ${flow} (${lang}): ${String(e).slice(0, 300)}`);
        }
      } catch (e) {
        out.push(`test ${flow} (${lang}): ${String(e).slice(0, 300)}`);
      }
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("flows.ts")) {
  main().catch((e) => {
    console.error(String(e).slice(0, 2000));
    process.exit(1);
  });
}
