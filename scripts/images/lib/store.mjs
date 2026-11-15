// Supabase from the Action: the private `media` bucket and the 0050 functions, with the service key. Never prints the key.
import { fetchRetry } from "./http.mjs";

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
    async upload(path, data, contentType = "image/jpeg") {
      const res = await fetchRetry(`${url}/storage/v1/object/media/${path}`, { method: "POST", headers: { ...h, "content-type": contentType, "x-upsert": "true" }, body: data }, { fetchImpl });
      if (!res.ok) throw new Error(`upload_${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
