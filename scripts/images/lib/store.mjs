// Supabase from the Action: the private `media` bucket and the 0050 functions, with the service key. Never prints the key.
import { fetchRetry } from "./http.mjs";

/** PERF1: the header of every object in the public `catalog` bucket (a name is never given other bytes). */
export const CATALOG_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function makeStore({ url, key, fetchImpl = fetch }) {
  const h = { apikey: key, authorization: `Bearer ${key}` };
  return {
    async rpc(fn, args = {}) {
      const res = await fetchRetry(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(args) }, { fetchImpl });
      const text = await res.text();
      if (!res.ok) throw new Error(`rpc_${fn}_${res.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    },
    /** A read through PostgREST (service key). `query` is the part after ?, e.g. "select=a,b&outcome=eq.x". */
    async select(table, query) {
      const res = await fetchRetry(`${url}/rest/v1/${table}?${query}`, { headers: h }, { fetchImpl });
      if (!res.ok) throw new Error(`select_${table}_${res.status}`);
      return res.json();
    },
    /** One stored picture, by its path in the private bucket (service key). */
    async download(path) {
      const res = await fetchRetry(`${url}/storage/v1/object/media/${path}`, { headers: h }, { fetchImpl });
      if (!res.ok) throw new Error(`download_${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** WEB4b: one object into the PUBLIC `catalog` bucket (the feed's JPEG copy; PERF1: the website's copies). Only ever a path the
     *  database's work list named. PERF1: every name in it is never given other bytes, so it is cached for a year as immutable. */
    async uploadPublic(path, data, contentType = "image/jpeg") {
      const res = await fetchRetry(`${url}/storage/v1/object/catalog/${path}`, { method: "POST", headers: { ...h, "content-type": contentType, "x-upsert": "true", "cache-control": CATALOG_CACHE_CONTROL }, body: data }, { fetchImpl });
      if (!res.ok) throw new Error(`upload_public_${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
    /** PERF1: one object of the public `catalog` bucket (a feed JPEG, to upload it again with the long-lived header). */
    async downloadPublic(path) {
      const res = await fetchRetry(`${url}/storage/v1/object/catalog/${path}`, { headers: h }, { fetchImpl });
      if (!res.ok) throw new Error(`download_public_${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** PERF1: files out of the private `media` bucket (the clean-up of rejected pictures; only paths the database's work list named). */
    async removeMedia(paths) {
      if (!paths.length) return;
      const res = await fetchRetry(`${url}/storage/v1/object/media`, { method: "DELETE", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) }, { fetchImpl });
      if (!res.ok) throw new Error(`remove_media_${res.status}`);
    },
    /** WEB4b: objects out of the public `catalog` bucket. */
    async removePublic(paths) {
      if (!paths.length) return;
      const res = await fetchRetry(`${url}/storage/v1/object/catalog`, { method: "DELETE", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) }, { fetchImpl });
      if (!res.ok) throw new Error(`remove_public_${res.status}`);
    },
    async upload(path, data, contentType = "image/jpeg") {
      const res = await fetchRetry(`${url}/storage/v1/object/media/${path}`, { method: "POST", headers: { ...h, "content-type": contentType, "x-upsert": "true" }, body: data }, { fetchImpl });
      if (!res.ok) throw new Error(`upload_${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
