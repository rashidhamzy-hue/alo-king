// The menu-harvest source list (DECISIONS §39.4 source 2): every merchant's `website_or_menu_link` from the Shouf
// file, plus the links in supabase/seed/shouf/menu_sources_extra.csv (menu pages known for merchants whose row has
// none, e.g. INDINER time on Omega). Each link gets the adapter that reads it, or the reason it is skipped:
// Instagram, Facebook and other login-walled or social pages are never fetched (terms, §39.4), and neither are
// chat links, raw IP addresses or personal profiles.
import { parseCsv } from "../vendors/normalize.ts";

export type Adapter =
  | "omega"
  | "qrscan"
  | "restbits"
  | "directory"
  | "coverbox"
  | "mymenus"
  | "scangow"
  | "menutigr"
  | "qr_order"
  | "gdrive_pdf"
  | "pdf"
  | "html";

export type MenuSource = {
  place_id: string;
  name: string;
  village: string;
  url: string;
  adapter: Adapter | null;
  skip: string | null;
};

const SKIP: [RegExp, string][] = [
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, "Instagram (login wall, terms)"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)faceboom\.com$/, "Facebook (login wall, terms)"],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, "WhatsApp chat link, not a menu"],
  [/(^|\.)linkedin\.com$/, "a personal profile, not a menu"],
  [/(^|\.)abnb\.me$|(^|\.)airbnb\./, "a rental listing, not a menu"],
  [/(^|\.)tiktok\.com$/, "TikTok (login wall, terms)"],
];

const PLATFORMS: [RegExp, Adapter][] = [
  [/(^|\.)omegasoftware\.ca$/, "omega"],
  [/(^|\.)qrscan-?menu\.[a-z]+$/, "qrscan"],
  [/(^|\.)(restbits|thrubits)\.[a-z]+$/, "restbits"],
  [/(^|\.)leb\.(directory|guide)$/, "directory"],
  [/(^|\.)coverbox\.[a-z]+$/, "coverbox"],
  [/(^|\.)mymenus\.site$/, "mymenus"],
  [/(^|\.)scangow\.[a-z]+$/, "scangow"],
  [/(^|\.)menutigr\.com$/, "menutigr"],
  [/(^|\.)qr-order\.online$/, "qr_order"],
  [/^(drive|docs)\.google\.com$/, "gdrive_pdf"],
];

/** The adapter for a link, or why it is skipped. */
export function classify(raw: string): {
  adapter: Adapter | null;
  skip: string | null;
  url: string;
} {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { adapter: null, skip: "not a URL", url: raw };
  }
  if (!/^https?:$/.test(u.protocol)) return { adapter: null, skip: "not a web link", url: raw };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host))
    return { adapter: null, skip: "a raw IP address", url: raw };
  for (const [re, why] of SKIP) if (re.test(host)) return { adapter: null, skip: why, url: raw };
  for (const [re, a] of PLATFORMS)
    if (re.test(host)) return { adapter: a, skip: null, url: u.toString() };
  if (/\.pdf$/i.test(u.pathname)) return { adapter: "pdf", skip: null, url: u.toString() };
  // Link pages (linktr.ee) and plain sites: read as HTML; the harvest follows a "menu" link one level down.
  return { adapter: "html", skip: null, url: u.toString() };
}

export function menuSources(merchantsCsv: string, extraCsv: string | null): MenuSource[] {
  const rows = parseCsv(merchantsCsv) as unknown as Record<string, string>[];
  const byId = new Map(rows.map((r) => [r.place_id, r]));
  const out: MenuSource[] = [];
  const add = (r: Record<string, string>, link: string) => {
    const c = classify(link);
    out.push({
      place_id: r.place_id,
      name: (r.name_en || r.name_ar || "").trim(),
      village: (r.locality_raw || "").trim(),
      url: c.url,
      adapter: c.adapter,
      skip: c.skip,
    });
  };
  for (const r of rows) if (r.website_or_menu_link?.trim()) add(r, r.website_or_menu_link.trim());
  if (extraCsv) {
    for (const e of parseCsv(extraCsv) as unknown as Record<string, string>[]) {
      const r = byId.get(e.place_id);
      if (!r) throw new Error(`menu_sources_extra.csv: unknown place_id ${e.place_id}`);
      if (out.some((s) => s.place_id === e.place_id && s.url === e.url)) continue;
      add(r, e.url);
    }
  }
  return out;
}
