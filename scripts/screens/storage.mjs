// The private `screens` bucket over Supabase Storage's REST API, with the service key (never printed). Used by run.mjs (the screens workflow).
// `fetchImpl` is injectable so a test can stand in for Storage. Paths are `<session>/<file>` (packages/core/src/screens.mjs).
import { BUCKET, isImage, safeScreenPath } from "../../packages/core/src/screens.mjs";

export function screensStore({ url, key, fetchImpl = fetch }) {
  const auth = { apikey: key, authorization: `Bearer ${key}` };
  const api = `${url}/storage/v1`;
  const json = async (res, what) => {
    const text = await res.text();
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  };
  /** Every item directly under a prefix ("" for the top); folders come back with a null id. */
  const listFolder = async (prefix) => {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetchImpl(`${api}/object/list/${BUCKET}`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }) });
      const page = (await json(res, `list ${prefix || "/"}`)) ?? [];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  };
  return {
    /** Every image in the bucket, as `<session>/<file>`. */
    async list() {
      const out = [];
      for (const top of await listFolder("")) {
        if (top.id !== null && top.id !== undefined) continue;   // a file at the top is not a session's
        for (const f of await listFolder(top.name)) if (f.id && isImage(f.name)) out.push(`${top.name}/${f.name}`);
      }
      return out.sort();
    },
    /** FIX2: every image with its upload time and size: `{ path, at, size }` (for the retention step and its before/after report). */
    async listDetailed() {
      const out = [];
      for (const top of await listFolder("")) {
        if (top.id !== null && top.id !== undefined) continue;
        for (const f of await listFolder(top.name)) if (f.id && isImage(f.name))
          out.push({ path: `${top.name}/${f.name}`, at: f.updated_at ?? f.created_at ?? new Date(0).toISOString(), size: Number(f.metadata?.size ?? 0) });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    async put(path, body, contentType) {
      if (!safeScreenPath(path)) throw new Error(`bad path ${path}`);
      const res = await fetchImpl(`${api}/object/${BUCKET}/${path}`, { method: "POST", headers: { ...auth, "content-type": contentType, "x-upsert": "true" }, body });
      await json(res, `put ${path}`);
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const res = await fetchImpl(`${api}/object/${BUCKET}`, { method: "DELETE", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
        await json(res, "remove");
      }
    },
    /** Signed links (a list of `{ path, url }`; url null when the object cannot be signed). */
    async sign(paths, seconds = 600) {
      if (!paths.length) return [];
      const res = await fetchImpl(`${api}/object/sign/${BUCKET}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: seconds, paths }) });
      const rows = (await json(res, "sign")) ?? [];
      return rows.map((r) => ({ path: r.path, url: r.signedURL ? `${api}${r.signedURL.startsWith("/") ? "" : "/"}${r.signedURL}` : null }));
    },
    /** The object's bytes through its signed link: proves it opens. Returns the byte length, or throws. */
    async open(path) {
      const [s] = await this.sign([path], 60);
      if (!s?.url) throw new Error(`cannot sign ${path}`);
      const res = await fetchImpl(s.url);
      if (!res.ok) throw new Error(`open ${path}: HTTP ${res.status}`);
      return (await res.arrayBuffer()).byteLength;
    },
  };
}
