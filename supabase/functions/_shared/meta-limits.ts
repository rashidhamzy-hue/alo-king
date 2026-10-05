// WhatsApp Cloud API limits for interactive messages. One source of truth: the senders clip to these numbers and
// meta-limits.test.ts fails if any builder or hard-coded title would exceed them.
export const META = {
  maxButtons: 3,
  buttonTitle: 20,
  buttonId: 256,
  listRows: 10, // total rows across all sections
  listSections: 10,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  sectionTitle: 24,
  listButton: 20,
  header: 60,
  footer: 60,
  body: 1024,
} as const;

/** Every way an interactive payload breaks Meta's limits (empty array = fine). Template and plain-text payloads are not interactive and are ignored. */
export function checkInteractive(payload: any): string[] {
  const v: string[] = [];
  const i = payload?.interactive;
  if (!i) return v;
  const len = (s: unknown) => [...String(s ?? "")].length; // WhatsApp counts characters, not UTF-16 units (emoji = 1)
  if (len(i.body?.text) > META.body) v.push(`body ${len(i.body?.text)} > ${META.body}`);
  if (i.body && !String(i.body.text ?? "").trim()) v.push("empty body");
  if (len(i.footer?.text) > META.footer) v.push(`footer ${len(i.footer?.text)} > ${META.footer}`);
  if (i.header?.type === "text" && len(i.header.text) > META.header) v.push(`header ${len(i.header.text)} > ${META.header}`);
  if (i.type === "button") {
    const bs = i.action?.buttons ?? [];
    if (bs.length < 1) v.push("no buttons");
    if (bs.length > META.maxButtons) v.push(`${bs.length} buttons > ${META.maxButtons}`);
    const titles = new Set<string>();
    for (const b of bs) {
      const t = String(b.reply?.title ?? "");
      if (!t.trim()) v.push("empty button title");
      if (len(t) > META.buttonTitle) v.push(`button title "${t}" is ${len(t)} > ${META.buttonTitle}`);
      if (titles.has(t)) v.push(`duplicate button title "${t}"`);
      titles.add(t);
      if (len(b.reply?.id) > META.buttonId) v.push(`button id ${len(b.reply?.id)} > ${META.buttonId}`);
      if (!String(b.reply?.id ?? "").trim()) v.push("empty button id");
    }
  } else if (i.type === "list") {
    const secs = i.action?.sections ?? [];
    const rows = secs.flatMap((s: any) => s.rows ?? []);
    if (secs.length > META.listSections) v.push(`${secs.length} sections > ${META.listSections}`);
    if (rows.length < 1) v.push("no rows");
    if (rows.length > META.listRows) v.push(`${rows.length} rows > ${META.listRows}`);
    if (len(i.action?.button) > META.listButton) v.push(`list button "${i.action?.button}" > ${META.listButton}`);
    if (!String(i.action?.button ?? "").trim()) v.push("empty list button");
    for (const s of secs) if (len(s.title) > META.sectionTitle) v.push(`section title "${s.title}" > ${META.sectionTitle}`);
    const ids = new Set<string>();
    for (const r of rows) {
      if (len(r.title) > META.rowTitle) v.push(`row title "${r.title}" is ${len(r.title)} > ${META.rowTitle}`);
      if (!String(r.title ?? "").trim()) v.push("empty row title");
      if (len((r.description ?? "")) > META.rowDescription) v.push(`row description ${len(r.description)} > ${META.rowDescription}`);
      if (len(r.id) > META.rowId) v.push(`row id ${len(r.id)} > ${META.rowId}`);
      if (ids.has(r.id)) v.push(`duplicate row id "${r.id}"`);
      ids.add(r.id);
    }
  } else if (i.type === "location_request_message") {
    if (len(i.body?.text) > META.body) v.push("location request body too long");
  }
  return v;
}

export const assertMetaLimits = (payload: any): void => {
  const v = checkInteractive(payload);
  if (v.length) throw new Error(`Meta limits exceeded: ${v.join("; ")}`);
};

const clipTo = (v: unknown, n: number) => { const a = [...String(v ?? "")]; return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
/** Safety net applied to every interactive payload right before it is sent: truncates instead of letting Meta reject the whole message. Valid payloads come back unchanged. */
export function clampInteractive<T>(payload: T): T {
  const p: any = payload;
  if (!p?.interactive) return payload;
  const i = JSON.parse(JSON.stringify(p.interactive));
  if (i.body?.text !== undefined) i.body.text = clipTo(i.body.text, META.body);
  if (i.footer?.text !== undefined) i.footer.text = clipTo(i.footer.text, META.footer);
  if (i.header?.type === "text") i.header.text = clipTo(i.header.text, META.header);
  if (i.type === "button" && i.action?.buttons) {
    i.action.buttons = i.action.buttons.slice(0, META.maxButtons).map((b: any) => ({ ...b, reply: { ...b.reply, id: clipTo(b.reply?.id, META.buttonId), title: clipTo(b.reply?.title, META.buttonTitle) } }));
  } else if (i.type === "list" && i.action) {
    let left: number = META.listRows;
    i.action.button = clipTo(i.action.button, META.listButton);
    i.action.sections = (i.action.sections ?? []).slice(0, META.listSections).map((s: any) => {
      const rows = (s.rows ?? []).slice(0, left); left -= rows.length;
      return { ...s, title: s.title === undefined ? undefined : clipTo(s.title, META.sectionTitle), rows: rows.map((r: any) => ({ ...r, id: clipTo(r.id, META.rowId), title: clipTo(r.title, META.rowTitle), ...(r.description ? { description: clipTo(r.description, META.rowDescription) } : {}) })) };
    }).filter((s: any) => s.rows.length);
  } else if (i.type === "location_request_message" && i.body?.text !== undefined) i.body.text = clipTo(i.body.text, META.body);
  return { ...p, interactive: i };
}
