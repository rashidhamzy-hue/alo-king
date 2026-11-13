// Server-rendered pages, built plain (BUILD_PLAN Phase 3: "no design work until the pilot shows what ops uses").
// Every interpolated value is escaped unless it is itself a fragment built with `html`.

export class Raw { constructor(readonly s: string) {} toString() { return this.s; } }

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

function piece(v: unknown): string {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(piece).join("");
  if (v === null || v === undefined || v === false) return "";
  return escape(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => { out += piece(v) + strings[i + 1]!; });
  return new Raw(out);
}

export const usd = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `$${Number(n).toFixed(2)}`);
export const lbp = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `${Math.round(Number(n)).toLocaleString("en-US")} LBP`);
export const when = (t: unknown) => {
  if (!t) return "";
  const d = new Date(String(t));
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString("en-GB", { timeZone: "Asia/Beirut", dateStyle: "short", timeStyle: "short" });
};
export const minutesSince = (t: unknown, now: Date) => (t ? Math.floor((now.getTime() - new Date(String(t)).getTime()) / 60000) : null);

export interface FormCtx { csrf: string; nonce: () => string }

/** A POST form. Every form carries the CSRF token and a one-time key, so a double tap is recognised downstream. */
export function form(f: FormCtx, action: string, body: Raw | Raw[], opts: { cls?: string; confirm?: boolean } = {}) {
  return html`<form method="post" action="${action}" class="${opts.cls ?? ""}">
<input type="hidden" name="_csrf" value="${f.csrf}"><input type="hidden" name="_key" value="${f.nonce()}">${body}</form>`;
}

export interface NavItem { href: string; label: string }

export function page(opts: { title: string; staff?: { name: string; role: string; csrf: string } | null; nav?: NavItem[];
                             flash?: { ok?: string; err?: string } | null; environment: string; body: Raw | Raw[] }): Response {
  const nav = opts.nav?.length ? html`<nav>${opts.nav.map((n) => html`<a href="${n.href}">${n.label}</a>`)}</nav>` : "";
  const who = opts.staff ? html`<div class="who">${opts.staff.name} (${opts.staff.role.replace("_", " ")})
<form method="post" action="/sign-out"><input type="hidden" name="_csrf" value="${opts.staff.csrf}"><button>Sign out</button></form></div>` : "";
  const banner = opts.environment === "production" ? "" : html`<div class="env">${opts.environment.toUpperCase()}: test data only</div>`;
  const flash = opts.flash?.err ? html`<p class="flash err">${opts.flash.err}</p>` : opts.flash?.ok ? html`<p class="flash ok">${opts.flash.ok}</p>` : "";
  const doc = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · Alo King console</title><link rel="stylesheet" href="/console.css"></head>
<body>${banner}<header><strong>Alo King console</strong>${who}</header>${nav}<main><h1>${opts.title}</h1>${flash}${opts.body}</main></body></html>`;
  return new Response(doc.s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const CSS = `
body{font:15px/1.4 system-ui,sans-serif;margin:0;color:#111;background:#fff}
header{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:#123;color:#fff}
header form{display:inline;margin-left:8px}
.env{background:#c60;color:#fff;padding:4px 16px;font-weight:bold}
nav{padding:6px 16px;background:#eef;display:flex;flex-wrap:wrap;gap:12px}
main{padding:12px 16px;max-width:1200px}
table{border-collapse:collapse;margin:8px 0 16px;width:100%}
th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f4f4f4}
.late{background:#fde2e2}
.warn{color:#a40}
.muted{color:#666}
.flash{padding:8px;border-radius:4px}
.flash.ok{background:#e3f6e3}
.flash.err{background:#fde2e2}
form.inline{display:inline}
input,select,textarea,button{font:inherit;margin:2px 0}
input[type=number]{width:7em}
img.proof{max-width:320px;max-height:420px;border:1px solid #ccc}
.pair{display:flex;gap:16px;flex-wrap:wrap;border:1px solid #ccc;padding:8px;margin:8px 0}
.note{background:#fff7e0;border:1px solid #e8c96b;padding:8px;margin:8px 0}
`;
