// Server-rendered HTML as tagged templates. Every interpolated value is escaped unless it is itself a fragment built with `html`.
// The console's renderer (apps/console/src/html.ts) and the components here share this one definition, so a fragment made by a
// component is a fragment to the console too (the check is `instanceof Raw`).

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

/** ` name="value"` when the value is set, nothing otherwise. `true` writes the bare attribute. */
export function attr(name: string, value: string | number | boolean | null | undefined): Raw {
  if (value === null || value === undefined || value === false) return new Raw("");
  return new Raw(value === true ? ` ${name}` : ` ${name}="${escape(value)}"`);
}
