import { useEffect, useId, useState } from "react";
import { DIASPORA_ZONES } from "@/lib/site-config";
import { useSite } from "./context";

const fmtTime = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(d);

/** Both clocks (DECISIONS §37.3.6): where the visitor is, and Beirut. Client-only, so the server HTML never shows a stale time. */
export function Clocks({ here, there, pick }: { here: string; there: string; pick: string }) {
  const { lang } = useSite();
  const [zone, setZone] = useState<string>(DIASPORA_ZONES[0].id);
  const [now, setNow] = useState<Date | null>(null);
  const id = useId();
  useEffect(() => {
    // The visitor's own time zone, when it is one of ours; otherwise the first city.
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (DIASPORA_ZONES.some((z) => z.id === own)) setZone(own);
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);
  const cell = (label: string, tz: string) => (
    <div className="rounded-2xl border border-tone-line bg-tone-surface p-4 text-center">
      <p className="text-sm text-tone-mute">{label}</p>
      <p className="ak-num mt-1 text-4xl font-extrabold tracking-tight" aria-live="off">
        <bdi>{now ? fmtTime(now, tz) : "--:--"}</bdi>
      </p>
    </div>
  );
  const zoneName = (z: (typeof DIASPORA_ZONES)[number]) => z[lang];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        {cell(here, zone)}
        <label className="block text-sm text-tone-mute" htmlFor={id}>
          {pick}
          <select
            id={id}
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="mt-1 block h-11 w-full rounded-xl border border-tone-line bg-tone-surface-2 px-3 text-base font-semibold text-tone-fg"
          >
            {DIASPORA_ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {zoneName(z)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>{cell(there, "Asia/Beirut")}</div>
    </div>
  );
}
