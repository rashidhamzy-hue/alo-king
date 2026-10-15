// The kapso-catalog workflow (DECISIONS §39.12): one Meta catalogue for the WhatsApp business account of a number, connected
// to that account, with the cart and the catalogue (storefront) icons on for the number. It finds a connected catalogue, or
// creates one ("Alo King") in the business portfolio that owns the account and connects it, by API: first through Kapso's
// Meta proxy (https://api.kapso.ai only, CLAUDE.md), then with META_CATALOG_TOKEN on the Graph API when that secret exists.
// It also probes which route can write catalogue items, records the result on staging (public.whatsapp_catalogs once that
// table exists), and prints a report. When neither route can create or connect the catalogue, it says exactly which step
// failed so the owner issue can carry the click steps (DECISIONS §25). Nothing is printed from a response but ids,
// statuses and error text.
//
// Env: KAPSO_API_KEY, PHONE_NUMBER_ID; optional META_CATALOG_TOKEN, DB_URL (staging). Writes `catalog_id`, `transport`
// and `blocked` to GITHUB_OUTPUT.
import { appendFileSync } from "node:fs";
import pg from "pg";

const KAPSO = "https://api.kapso.ai";
const GRAPH = "https://graph.facebook.com/v24.0";
const KAPSO_META = `${KAPSO}/meta/whatsapp/v24.0`;
const key = process.env.KAPSO_API_KEY ?? "";
const token = process.env.META_CATALOG_TOKEN ?? "";

export type Route = "kapso" | "graph";
export type Answer = { ok: boolean; status: number; body: any };

async function call(route: Route, path: string, init: RequestInit = {}): Promise<Answer> {
  if (route === "graph" && !token)
    return { ok: false, status: 0, body: { error: "META_CATALOG_TOKEN is not set" } };
  const url = route === "kapso" ? `${KAPSO_META}${path}` : `${GRAPH}${path}`;
  const headers: Record<string, string> =
    route === "kapso"
      ? { "X-API-Key": key, "content-type": "application/json" }
      : { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "error",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e).slice(0, 200) } };
  }
}

/** A short, safe description of a failed answer (Meta's message and codes, never headers or tokens). */
export function why(a: Answer): string {
  const e = a.body?.error ?? a.body;
  const msg =
    typeof e === "string" ? e : (e?.error_user_msg ?? e?.message ?? JSON.stringify(e ?? {}));
  const code =
    typeof e === "object" && e?.code
      ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})`
      : "";
  return `${a.status} ${String(msg).slice(0, 240)}${code}`;
}

/** The catalogue connected to the account, from GET /{waba}/product_catalogs. */
export function connectedCatalog(body: any): { id: string; name: string | null } | null {
  const c = (body?.data ?? []).find((x: any) => /^[0-9]{5,30}$/.test(String(x?.id ?? "")));
  return c ? { id: String(c.id), name: c.name ?? null } : null;
}

/** The id of the portfolio's catalogue with this name, from GET /{business}/owned_product_catalogs. */
export function ownedCatalog(body: any, name: string): string | null {
  const c = (body?.data ?? []).find(
    (x: any) => String(x?.name ?? "").trim() === name && /^[0-9]{5,30}$/.test(String(x?.id ?? "")),
  );
  return c ? String(c.id) : null;
}

/** The business portfolio that owns the account, from GET /{waba}?fields=owner_business_info. */
export function ownerBusiness(body: any): string | null {
  const id = String(body?.owner_business_info?.id ?? body?.on_behalf_of_business_info?.id ?? "");
  return /^[0-9]{5,30}$/.test(id) ? id : null;
}

async function firstOk(
  label: string,
  routes: Route[],
  f: (r: Route) => Promise<Answer>,
  notes: string[],
) {
  for (const r of routes) {
    const a = await f(r);
    if (a.ok) {
      notes.push(`${label}: ok through ${r}`);
      return { route: r, answer: a };
    }
    notes.push(`${label}: ${r} refused: ${why(a)}`);
  }
  return null;
}

async function main() {
  const pn = process.env.PHONE_NUMBER_ID ?? "";
  if (!key) throw new Error("KAPSO_API_KEY is not set");
  if (!/^[0-9]{6,20}$/.test(pn)) throw new Error("PHONE_NUMBER_ID is not a phone number id");
  const notes: string[] = [];
  const routes: Route[] = token ? ["kapso", "graph"] : ["kapso"];

  const res = await fetch(`${KAPSO}/platform/v1/whatsapp/phone_numbers/${pn}`, {
    headers: { "X-API-Key": key },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Kapso answered ${res.status} for the number`);
  const num = await res.json();
  const waba = String(num?.data?.business_account_id ?? "");
  if (!/^[0-9]{5,30}$/.test(waba)) throw new Error("the number has no business account in Kapso");
  notes.push(`number ${pn}, business account ${waba}`);

  // 1. A catalogue already connected to the account?
  let catalog: { id: string; name: string | null } | null = null;
  const listed = await firstOk(
    "list connected catalogues",
    routes,
    (r) => call(r, `/${waba}/product_catalogs`),
    notes,
  );
  if (listed) catalog = connectedCatalog(listed.answer.body);

  // 2. Otherwise create one in the owning portfolio and connect it.
  let blocked: string | null = null;
  if (!catalog) {
    const owner = await firstOk(
      "owning business",
      routes,
      (r) => call(r, `/${waba}?fields=owner_business_info,name`),
      notes,
    );
    const business = owner ? ownerBusiness(owner.answer.body) : null;
    if (!business) blocked = "create";
    else {
      // A catalogue named "Alo King" made by an earlier run (created, then refused to connect) is reused, never duplicated.
      const owned = await firstOk(
        "list the portfolio's catalogues",
        routes,
        (r) => call(r, `/${business}/owned_product_catalogs?fields=id,name&limit=100`),
        notes,
      );
      const reuse = ownedCatalog(owned?.answer.body, "Alo King");
      const made = reuse
        ? { answer: { body: { id: reuse } } }
        : owned
          ? await firstOk(
              "create catalogue",
              routes,
              (r) =>
                call(r, `/${business}/owned_product_catalogs`, {
                  method: "POST",
                  body: JSON.stringify({ name: "Alo King", vertical: "commerce" }),
                }),
              notes,
            )
          : null;
      if (reuse) notes.push(`create catalogue: reused ${reuse}`);
      const id = String(made?.answer.body?.id ?? "");
      if (!/^[0-9]{5,30}$/.test(id)) blocked = "create";
      else {
        catalog = { id, name: "Alo King" };
        const linked = await firstOk(
          "connect catalogue to the account",
          routes,
          (r) =>
            call(r, `/${waba}/product_catalogs`, {
              method: "POST",
              body: JSON.stringify({ catalog_id: id }),
            }),
          notes,
        );
        if (!linked) blocked = `connect:${id}`;
      }
    }
  }

  // 3. The cart and the catalogue icon on the number (Meta: cart on by default, storefront icon off by default).
  let settings = "not changed";
  let commerceOn = false;
  if (catalog && !blocked) {
    const set = await firstOk(
      "cart and catalogue icons",
      routes,
      (r) =>
        call(r, `/${pn}/whatsapp_commerce_settings?is_cart_enabled=true&is_catalog_visible=true`, {
          method: "POST",
        }),
      notes,
    );
    const got = await firstOk(
      "read commerce settings",
      routes,
      (r) => call(r, `/${pn}/whatsapp_commerce_settings`),
      notes,
    );
    const s = got?.answer.body?.data?.[0] ?? {};
    settings = set
      ? `cart ${s.is_cart_enabled ?? "?"}, catalogue icon ${s.is_catalog_visible ?? "?"}`
      : "refused";
    commerceOn = s.is_cart_enabled === true && s.is_catalog_visible === true;
  }

  // 4. Which route can write items (the sync in dispatch uses it).
  let transport: Route | null = null;
  if (catalog) {
    const probe = await firstOk(
      "read catalogue items",
      routes,
      (r) => call(r, `/${catalog!.id}/products?limit=1&fields=id`),
      notes,
    );
    transport = probe?.route ?? null;
  }

  console.log(`\n| step | result |\n|---|---|`);
  for (const n of notes) console.log(`| ${n.replace(/\|/g, "/")} |`);
  console.log(
    `\ncatalogue: ${catalog ? `${catalog.id} (${catalog.name ?? ""})` : "none"}; commerce settings: ${settings}; items route: ${transport ?? "none"}`,
  );
  if (blocked) console.log(`::warning::owner step needed: ${blocked}`);

  if (process.env.DB_URL && catalog) {
    const url = new URL(process.env.DB_URL);
    url.searchParams.delete("sslmode");
    const db = new pg.Client({
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    try {
      const has = (
        await db.query("select to_regclass('public.whatsapp_catalogs') is not null as ok")
      ).rows[0]?.ok;
      if (has)
        await db.query("select public.whatsapp_catalog_record($1, $2, $3, $4, $5)", [
          waba,
          catalog.id,
          // A catalogue that is not connected to the account is never offered to customers.
          blocked ? null : transport,
          commerceOn,
          blocked,
        ]);
      else console.log("public.whatsapp_catalogs does not exist yet: nothing recorded");
    } finally {
      await db.end();
    }
  }
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `catalog_id=${catalog?.id ?? ""}\ntransport=${transport ?? ""}\nblocked=${blocked ?? ""}\n`,
    );
}

if (process.argv[1]?.endsWith("catalog.ts")) {
  main().catch((e) => {
    console.error(String(e).slice(0, 1000));
    process.exit(1);
  });
}
