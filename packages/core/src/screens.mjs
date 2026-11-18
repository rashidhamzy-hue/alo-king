// Screenshots live in the private Supabase Storage bucket `screens`, never in the repository (DOC2; docs/DECISIONS.md, "Founder decisions,
// 18 November 2026", 7). One module, plain JavaScript, so the upload script (scripts/screens/), the workflow and the console's Screens page
// (apps/console/src/pages/screens.ts) all read a screenshot's file name the same way. No network and no storage here: pure functions.
//
// A screenshot is `<session>/<file>` in the bucket (the same path it had under docs/screens/). A file name is
//   <page>[-<width>][-<language>][-<theme>].<png|webp|jpg>      e.g. wh1a-bins-390-ar.png, console-pick-done-1440-en-dark.webp, ref-ops-today-1280.webp
// and `pageKey` is the name with the width, the language and the theme taken off: the "page" a set of screenshots shows.
// The design reference's own screens are the files named `ref-ops-<page>-<width>` (the console) and `ref-web-<page>-<width>` (the website).

export const BUCKET = "screens";
export const WIDTHS = ["390", "1280", "1440"];
/** Oldest first. A session not listed here is newer than all of them (the upload script moves them in this order, so a later one replaces an earlier one's page). */
export const SESSION_ORDER = ["ds1", "d4b", "lb1", "ld1", "ds2", "lv1", "ux2a", "ux2b", "ux3", "web2", "wh1a"];
export const isImage = (path) => /\.(png|webp|jpe?g)$/i.test(path);
export const contentType = (path) => (/\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : /\.jpe?g$/i.test(path) ? "image/jpeg" : "application/octet-stream");
/** A bucket path is `<session>/<file>`: letters, digits, dash, underscore and dot, one folder deep, no "..". */
export const safeScreenPath = (p) => /^[a-z0-9][a-z0-9_-]{0,40}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(p) && !p.includes("..");

/** `wh1a/wh1a-bins-390-ar.png` -> { session, file, key, width, lang, theme, ref }. Null when it is not an image path in a session folder. */
export function parseShot(path) {
  const m = /^([^/]+)\/([^/]+)$/.exec(path);
  if (!m || !isImage(path)) return null;
  const [, session, file] = m;
  const base = file.replace(/\.[A-Za-z0-9]+$/, "");
  let width = null, lang = null, theme = null;
  const keep = [];
  for (const tok of base.split("-")) {
    if (WIDTHS.includes(tok)) width = tok;
    else if (tok === "ar" || tok === "en") lang = tok;
    else if (tok === "light" || tok === "dark") theme = tok;
    else keep.push(tok);
  }
  return { path, session, file, key: keep.join("-"), width, lang, theme, ref: keep[0] === "ref" };
}

/**
 * What an upload removes. The pages in `incoming` (paths, `<session>/<file>`) replace every older screenshot of the same page, wherever it is
 * kept: the newest upload is the latest set, so the same page's files of another session, and files of the same session that the new set no
 * longer has (an earlier theme, a width dropped), are deleted. Pages not in `incoming` are left alone.
 */
export function planPrune(existing, incoming) {
  const keys = new Set(incoming.map((p) => parseShot(p)?.key).filter(Boolean));
  const keep = new Set(incoming);
  return existing.filter((p) => { const s = parseShot(p); return s && keys.has(s.key) && !keep.has(p); }).sort();
}

const ALIAS = { rider: "join-rider", vendor: "for-vendors" };
const PREFIXES = ["console", "web2", "web", "ux2a", "ux2b", "ux3", "wh1a", "d4b", "ds1", "ds2", "lb1", "ld1", "lv1"];
/**
 * The reference screen for a page: `ref-ops-<page>` or `ref-web-<page>` for the same width class (390 beside 390; 1280 and 1440 beside 1280).
 * The page's name is read without its session prefix and shortened from the end until a reference of that name exists
 * (dispatch-lead -> dispatch; riders-applicants -> riders). A `console-` page looks only at the console's references, a `web-` or `web2-`
 * page only at the website's; the others try the console's first. Null when the reference has no such screen.
 * @param {string} key a page key (see parseShot)  @param {string|null} width  @param {string[]} paths every path in the bucket
 */
export function referenceFor(key, width, paths) {
  const want = width === "390" ? "390" : "1280";
  const have = new Map();   // ref key -> the paths of its screens at this width class
  for (const p of paths) { const s = parseShot(p); if (s?.ref && (s.width === want)) have.set(s.key, [...(have.get(s.key) ?? []), p]); }
  const parts = key.split("-");
  const first = parts[0];
  const prefix = PREFIXES.includes(first) ? first : null;
  const rest = prefix ? parts.slice(1) : parts;
  const kinds = prefix === "console" ? ["ops"] : prefix === "web" || prefix === "web2" ? ["web"] : ["ops", "web"];
  for (let n = rest.length; n >= 1; n--) {
    const slug = rest.slice(0, n).join("-");
    for (const k of kinds) for (const name of [slug, ALIAS[slug]].filter(Boolean)) {
      const hit = have.get(`ref-${k}-${name}`);
      if (hit?.length) return { key: `ref-${k}-${name}`, paths: [...hit].sort() };
    }
  }
  return null;
}

/**
 * The Screens page's data: sessions (newest first by SESSION_ORDER, unknown ones first), each with its pages, each page with its screens and
 * the reference beside it. `paths` are all the images in the bucket.
 */
export function groupScreens(paths) {
  const bySession = new Map();
  for (const p of paths) {
    const s = parseShot(p);
    if (!s || s.ref) continue;
    const pages = bySession.get(s.session) ?? new Map();
    pages.set(s.key, [...(pages.get(s.key) ?? []), s]);
    bySession.set(s.session, pages);
  }
  const rank = (s) => { const i = SESSION_ORDER.indexOf(s); return i < 0 ? 1000 : i; };
  return [...bySession.entries()].sort((a, b) => rank(b[0]) - rank(a[0]) || a[0].localeCompare(b[0])).map(([session, pages]) => ({
    session,
    pages: [...pages.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, shots]) => ({
      key,
      shots: shots.sort((a, b) => a.file.localeCompare(b.file)),
      widths: [...new Set(shots.map((x) => x.width).filter(Boolean))].sort(),
    })),
  }));
}

/** The sessions that hold only reference screens (the design reference itself). */
export const referencePaths = (paths) => paths.filter((p) => parseShot(p)?.ref);
