// The private `media` bucket (payment screenshots, receipts, product pictures; the console's action log only until migration 0113 is applied).
// Pictures reach the browser only as short-lived signed links made here, with the service key, on the server.
export interface Media {
  /** A signed link that lives `seconds`, or null if the object cannot be signed (missing, or a bad path). */
  sign(path: string, seconds: number): Promise<string | null>;
  /** Writes a new object. Refuses to overwrite. Throws on failure. */
  put(path: string, body: string | ArrayBuffer, contentType: string): Promise<void>;
}

export const safePath = (p: string) => /^[A-Za-z0-9_\-./]+$/.test(p) && !p.includes("..") && !p.startsWith("/");

export function supabaseMedia(opts: { url: string; key: string; fetchImpl?: typeof fetch }): Media {
  const f = opts.fetchImpl ?? fetch;
  const auth = { apikey: opts.key, authorization: `Bearer ${opts.key}` };
  return {
    async sign(path, seconds) {
      if (!safePath(path)) return null;
      try {
        const res = await f(`${opts.url}/storage/v1/object/sign/media/${path}`, {
          method: "POST", headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: Math.max(30, Math.min(3600, Math.floor(seconds))) }),
        });
        if (!res.ok) return null;
        const { signedURL } = (await res.json()) as { signedURL?: string };
        return signedURL ? `${opts.url}/storage/v1${signedURL.startsWith("/") ? "" : "/"}${signedURL}` : null;
      } catch { return null; }
    },
    async put(path, body, contentType) {
      if (!safePath(path)) throw new Error("bad_path");
      const res = await f(`${opts.url}/storage/v1/object/media/${path}`, {
        method: "POST", headers: { ...auth, "content-type": contentType, "x-upsert": "false" }, body,
      });
      if (!res.ok) throw new Error(`storage_${res.status}`);
    },
  };
}
