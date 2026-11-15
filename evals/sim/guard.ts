// SIM1: the one door between the simulation and the network. Installed over globalThis.fetch before anything else runs.
//   staging Supabase   GET only, and only while the catalogue is being copied; any other method, or any request after the copy,
//                      is refused and recorded (evals/sim/test/guard.test.ts proves it).
//   Kapso              never reached: every send is recorded and answered with an invented message id. The real Kapso host is
//                      refused like any other host.
//   media              a voice note's audio is answered with a few invented bytes.
//   Anthropic          the model calls (concierge, customer, judge) pass, through the metered clients only.
//   anything else      refused.
export interface Recorded { url: string; pnid: string | null; body: any; at: number }
export interface Refusal { method: string; url: string; phase: string; why: string }
export interface Guard {
  phase: "copy" | "run";
  kapso: Recorded[];
  refused: Refusal[];
  staging: { method: string; url: string }[];
  restore(): void;
}
export interface GuardOptions {
  stagingOrigin: string | null;
  kapsoOrigin: string;
  mediaOrigin: string;
  /** Hosts the run may call (the model API). */
  allowHosts: string[];
  /** What an allowed request really goes to; the original fetch unless a test passes a fake. */
  upstream?: typeof fetch;
}

export class GuardRefused extends Error {
  constructor(why: string) { super(`SIM_GUARD_REFUSED: ${why}`); this.name = "GuardRefused"; }
}

export function installFetchGuard(o: GuardOptions): Guard {
  const original = globalThis.fetch;
  const upstream = o.upstream ?? original.bind(globalThis);
  let seq = 0;
  const g: Guard = { phase: "copy", kapso: [], refused: [], staging: [], restore: () => { globalThis.fetch = original; } };
  const refuse = (method: string, url: string, why: string): never => {
    g.refused.push({ method, url: url.slice(0, 200), phase: g.phase, why });
    throw new GuardRefused(`${method} ${url.slice(0, 120)}: ${why}`);
  };
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : String(input);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    let u: URL;
    try { u = new URL(url); } catch { return refuse(method, url, "not a URL"); }
    if (o.stagingOrigin && u.origin === o.stagingOrigin) {
      g.staging.push({ method, url: u.pathname + u.search });
      if (g.phase !== "copy") return refuse(method, url, "staging is closed after the copy");
      if (method !== "GET") return refuse(method, url, "staging is read with GET only");
      return upstream(input as RequestInfo, init);
    }
    if (u.origin === o.kapsoOrigin) {
      let body: unknown = null;
      const raw = init?.body ?? (req ? await req.clone().text() : null);
      try { body = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { body = raw; }
      const m = /\/(\w+)\/messages$/.exec(u.pathname);
      g.kapso.push({ url: u.pathname, pnid: m?.[1] ?? null, body, at: Date.now() });
      if (!m) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.SIM${++seq}` }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.origin === o.mediaOrigin) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]), { status: 200, headers: { "content-type": "audio/ogg" } });
    if (o.allowHosts.includes(u.hostname)) return upstream(input as RequestInfo, init);
    return refuse(method, url, "host not allowed");
  };
  globalThis.fetch = guarded as typeof fetch;
  return g;
}
