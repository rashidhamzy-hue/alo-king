// The only code allowed to call Google Places or read GOOGLE_PLACES_SERVER_KEY (guarded by
// scripts/google-places-guard.test.ts). Live Google lookups (claim case D, DECISIONS §15.1) are off unless the
// database config `google_places_enabled` is exactly true; the claim flow otherwise uses our own list and the
// "not in our list" registration path. While the flag is off (or cannot be read) the key is never read and no
// request is made. Pure and dependency-injected, so it runs in Deno and Node.

export type GooglePlacesDeps = {
  /** Reads a config value from the database (the `config_value` RPC); may throw. */
  readConfig: (key: string) => Promise<unknown>;
  /** Reads the secret. Only called after the flag has said yes. */
  getKey: () => string | undefined;
  fetch: typeof fetch;
};

export type GooglePlaceResult =
  | { status: "disabled" }
  | { status: "no_key" }
  | { status: "error"; http: number }
  | {
      status: "ok";
      place: { id: string; name: string | null; lat: number | null; lon: number | null };
    };

/** True only when the flag is the JSON value true; a missing row, a read error or any other value is off. */
export async function googlePlacesEnabled(
  readConfig: GooglePlacesDeps["readConfig"],
): Promise<boolean> {
  try {
    return (await readConfig("google_places_enabled")) === true;
  } catch {
    return false;
  }
}

export async function googlePlaceDetails(
  deps: GooglePlacesDeps,
  placeId: string,
): Promise<GooglePlaceResult> {
  if (!(await googlePlacesEnabled(deps.readConfig))) return { status: "disabled" };
  const key = deps.getKey();
  if (!key) return { status: "no_key" };
  const res = await deps.fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,location" } },
  );
  if (!res.ok) return { status: "error", http: res.status };
  const j = await res.json();
  return {
    status: "ok",
    place: {
      id: String(j.id ?? placeId),
      name: j.displayName?.text ?? null,
      lat: typeof j.location?.latitude === "number" ? j.location.latitude : null,
      lon: typeof j.location?.longitude === "number" ? j.location.longitude : null,
    },
  };
}
