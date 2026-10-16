// Sets the WhatsApp business profile of a number (session 5e): about, description, address, category, website and the
// profile photo (the Alo King crown), from whatsapp/business-profile.json, through Kapso's Meta proxy (https://api.kapso.ai
// only, CLAUDE.md). The photo goes as a handle from Meta's resumable upload (PROFILE_PICTURE_HANDLE, made with Kapso's
// media upload); without one the photo is left as it is. Meta's profile has no opening-hours field. Prints what Meta holds
// afterwards (never a key). Env: KAPSO_API_KEY, PHONE_NUMBER_ID; optional PROFILE_PICTURE_HANDLE.
// Usage: node --experimental-strip-types scripts/kapso/profile.ts
import { readFileSync } from "node:fs";

const KAPSO_META = "https://api.kapso.ai/meta/whatsapp/v24.0";

export type Profile = {
  about: string;
  description: string;
  address: string;
  vertical: string;
  websites: string[];
};

/** A website goes on the profile only when anyone can open it and it is the Alo King site (not a login wall). */
export function isPublicSite(status: number, html: string): boolean {
  return (
    status === 200 &&
    /Alo King|ألو كينغ/.test(html) &&
    !/Authentication Required|vercel\.com\/login|sso-api/i.test(html)
  );
}

async function publicWebsites(candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const url of candidates) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) }).catch(
      () => null,
    );
    const html = res ? await res.text().catch(() => "") : "";
    const ok = !!res && isPublicSite(res.status, html);
    console.log(`website ${url}: ${res?.status ?? "no answer"}${ok ? " (public)" : " (left out)"}`);
    if (ok) out.push(url);
  }
  return out.slice(0, 2);
}

/** Meta's limits for a business profile; an empty list means the profile can be sent. */
export function profileProblems(p: Profile): string[] {
  const len = (s: string) => [...s].length;
  const out: string[] = [];
  if (len(p.about) < 1 || len(p.about) > 139)
    out.push(`about is ${len(p.about)} characters (1-139)`);
  if (len(p.description) > 512)
    out.push(`description is ${len(p.description)} characters (512 at most)`);
  if (len(p.address) > 256) out.push(`address is ${len(p.address)} characters (256 at most)`);
  if (p.websites.length > 2) out.push(`${p.websites.length} websites (2 at most)`);
  for (const w of p.websites)
    if (!/^https?:\/\/[^\s]+$/.test(w) || w.length > 256) out.push(`bad website ${w}`);
  if (/https?:\/\//.test(p.about)) out.push("about must not hold a link");
  return out;
}

export function profileBody(p: Profile, handle: string | null) {
  return {
    messaging_product: "whatsapp",
    about: p.about,
    description: p.description,
    address: p.address,
    vertical: p.vertical,
    websites: p.websites,
    ...(handle ? { profile_picture_handle: handle } : {}),
  };
}

async function main() {
  const key = process.env.KAPSO_API_KEY ?? "";
  const pn = process.env.PHONE_NUMBER_ID ?? "";
  if (!key || !/^[0-9]{5,30}$/.test(pn))
    throw new Error("KAPSO_API_KEY and PHONE_NUMBER_ID are required");
  const file = JSON.parse(readFileSync("whatsapp/business-profile.json", "utf8"));
  const p: Profile = { ...file, websites: await publicWebsites(file.website_candidates ?? []) };
  const problems = profileProblems(p);
  if (problems.length) throw new Error(`profile breaks Meta's limits: ${problems.join("; ")}`);
  const handle = (process.env.PROFILE_PICTURE_HANDLE ?? "").trim() || null;
  const headers = { "X-API-Key": key, "content-type": "application/json" };
  const res = await fetch(`${KAPSO_META}/${pn}/whatsapp_business_profile`, {
    method: "POST",
    headers,
    body: JSON.stringify(profileBody(p, handle)),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? body;
    throw new Error(
      `profile refused: ${res.status} ${String(e?.message ?? JSON.stringify(e)).slice(0, 300)}`,
    );
  }
  console.log(`profile set${handle ? " with the photo" : " (photo unchanged: no handle given)"}`);
  const got = await fetch(
    `${KAPSO_META}/${pn}/whatsapp_business_profile?fields=about,address,description,vertical,websites,profile_picture_url`,
    { headers, redirect: "error", signal: AbortSignal.timeout(30_000) },
  );
  const now: any = await got.json().catch(() => ({}));
  const d = now?.data?.[0] ?? now;
  console.log(
    [
      `| field | on Meta |`,
      `|---|---|`,
      `| about | ${d?.about ?? "?"} |`,
      `| description | ${String(d?.description ?? "?").slice(0, 120)}… |`,
      `| address | ${d?.address ?? "?"} |`,
      `| category | ${d?.vertical ?? "?"} |`,
      `| websites | ${(d?.websites ?? []).join(", ")} |`,
      `| photo | ${d?.profile_picture_url ? "set" : "none"} |`,
    ].join("\n"),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
