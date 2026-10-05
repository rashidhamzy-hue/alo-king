import { supabase } from "./supabase";
import { MEDIA_BUCKET } from "./config";

export class EdgeError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Invoke an edge function and surface the {error} message + status on failure. */
export async function invokeFn<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let status = 500;
    let parsed: Record<string, unknown> = {};
    if (ctx && typeof ctx.status === "number") {
      status = ctx.status;
      try {
        parsed = await ctx.clone().json();
      } catch {
        try {
          parsed = { error: await ctx.text() };
        } catch {
          /* ignore */
        }
      }
    }
    const msg =
      status === 429
        ? (parsed.error as string) || "You've reached today's AI limit. Please try again tomorrow."
        : (parsed.error as string) || error.message || "Request failed";
    throw new EdgeError(msg, status, parsed);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error)
    throw new EdgeError(String((data as { error: unknown }).error), 400, data as Record<string, unknown>);
  return data as T;
}

export const aiFriendly = (e: unknown) =>
  e instanceof EdgeError && e.status === 429
    ? "The assistant has reached today's limit. It will be back tomorrow."
    : e instanceof Error
      ? e.message
      : String(e);

/** Resize an image client-side to max dimension, returning a JPEG blob and base64 (no prefix). */
export async function resizeImage(file: Blob, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/jpeg", quality));
    const base64 = c.toDataURL("image/jpeg", quality).split(",")[1]!;
    return { blob, base64, media_type: "image/jpeg" as const };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToBase64(file: Blob) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Upload to vendor-media and return a cache-busted public URL. */
export async function uploadMedia(path: string, blob: Blob) {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
  if (error) throw error;
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
