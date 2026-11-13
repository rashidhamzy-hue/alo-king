// Supabase from the Action, with the service key: the 0073 functions through PostgREST. Never prints the key.
import { fetchRetry } from "./http.mjs";

export function makeStore({ url, key, fetchImpl = fetch }) {
  const h = { apikey: key, authorization: `Bearer ${key}` };
  return {
    async rpc(fn, args = {}) {
      const res = await fetchRetry(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(args) }, { fetchImpl });
      const text = await res.text();
      if (!res.ok) throw new Error(`rpc_${fn}_${res.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
  };
}
