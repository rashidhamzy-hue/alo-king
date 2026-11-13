// A short-lived signed link for a picture in the private `media` bucket. SQL cannot sign (the signing key is the project's),
// so whoever sends a picture calls product_image_for_customer() (0050) and passes its media_path here with its
// signed_link_seconds. Runs with the service key, server side only. Returns the link, or throws.
export async function signedImageLink({ url, key, path, seconds = 300, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_\-./]+$/.test(path) || path.includes("..")) throw new Error("bad_path");
  const res = await fetchImpl(`${url}/storage/v1/object/sign/media/${path}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: Math.max(30, Math.min(3600, Math.floor(seconds))) }),
  });
  if (!res.ok) throw new Error(`sign_${res.status}`);
  const { signedURL } = await res.json();
  if (!signedURL) throw new Error("sign_no_url");
  return `${url}/storage/v1${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
}
