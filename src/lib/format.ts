export const usd = (n: number | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;

export const isCOD = (method: string | null | undefined) => {
  const m = (method || "cod").toLowerCase();
  return m.includes("cod") || m.includes("cash");
};

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

export const ageLabel = (iso: string, now: number) => {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

export const hasArabic = (s: string) => /[\u0600-\u06FF]/.test(s);

export const errMsg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
