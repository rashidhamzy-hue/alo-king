// MENU2 (19 November 2026): the text of a menu file, for the menu-read workflow. docs/DECISIONS.md, "MENU2, menus from any source".
//   docx   a Word file: its paragraphs in order, each table row on one line with its cells joined by " | "
//   xlsx   an Excel file: each sheet's rows, cells joined by " | " (in column order, an empty cell kept as empty), one page per sheet
//   csv    a CSV file (comma, semicolon or tab; quotes as RFC 4180): rows joined the same way. UTF-8, or Windows Arabic (1256) if not UTF-8
//   text   pasted text, as given
// A long text is cut into parts of at most PART_CHARS at line ends, so one reading's answer stays well inside the reader's output allowance.
// Nothing here calls the network or a model. Office files are zip files: a small reader is below (stored and deflated entries, with a cap on
// the unpacked size so a crafted file cannot fill the runner's memory), so no package is added for it.
import { inflateRawSync } from "node:zlib";

export const PART_CHARS = 6000;
export const MAX_UNPACKED = 25 * 1024 * 1024;

/** The entries of a zip file: Map(name -> () => Uint8Array). */
export function unzip(bytes) {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not_a_zip: the file is not a Word or Excel file");
  const count = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16);
  const out = new Map(); let total = 0;
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("bad_zip: a broken file");
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28), elen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue;
    total += usize;
    if (total > MAX_UNPACKED) throw new Error("too_large: the file unpacks to more than 25 MB");
    out.set(name, () => {
      if (b.readUInt32LE(local) !== 0x04034b50) throw new Error("bad_zip: a broken file");
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const data = b.subarray(start, start + csize);
      if (method === 0) return new Uint8Array(data);
      if (method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(usize, 1) + 1024 }));
      throw new Error(`bad_zip: compression ${method} is not read`);
    });
  }
  return out;
}

const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENT[e.toLowerCase()]);
const text8 = (u8) => new TextDecoder("utf-8").decode(u8);
const tidy = (s) => s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** The text inside a run of WordprocessingML: text, tabs and breaks. */
function runsText(xml) {
  let s = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) s += m[1] !== undefined ? unxml(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n";
  return s;
}

/** A Word file's text: paragraphs in order, a table row per line. */
export function docxText(bytes) {
  const z = unzip(bytes);
  const doc = z.get("word/document.xml");
  if (!doc) throw new Error("not_a_docx: the file has no Word document in it");
  const xml = text8(doc());
  const body = xml.slice(Math.max(0, xml.indexOf("<w:body")));
  const lines = [];
  // walk top-level paragraphs and tables in order
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const m of body.matchAll(re)) {
    const block = m[0];
    if (block.startsWith("<w:tbl>")) {
      for (const row of block.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) => tidy(runsText(c[0]).replace(/\n/g, " ")));
        if (cells.some((c) => c !== "")) lines.push(cells.join(" | "));
      }
    } else lines.push(runsText(block));
  }
  return tidy(lines.join("\n"));
}

const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "A") n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const rowLine = (cells) => { while (cells.length && (cells[cells.length - 1] ?? "") === "") cells.pop(); return cells.map((c) => (c ?? "").replace(/\s+/g, " ").trim()).join(" | "); };

/** An Excel file's sheets: [{ name, text }]. */
export function xlsxSheets(bytes) {
  const z = unzip(bytes);
  const wb = z.get("xl/workbook.xml");
  if (!wb) throw new Error("not_an_xlsx: the file has no Excel workbook in it");
  const strings = [];
  const ss = z.get("xl/sharedStrings.xml");
  if (ss) for (const si of text8(ss()).matchAll(/<si>([\s\S]*?)<\/si>/g)) strings.push([...si[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => unxml(t[1])).join(""));
  const rels = new Map();
  const rx = z.get("xl/_rels/workbook.xml.rels");
  if (rx) for (const r of text8(rx()).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(r[0])?.[1]; const target = /Target="([^"]+)"/.exec(r[0])?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const sheets = [];
  for (const s of text8(wb()).matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = unxml(/name="([^"]*)"/.exec(s[0])?.[1] ?? "Sheet");
    const rid = /r:id="([^"]+)"/.exec(s[0])?.[1];
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const f = z.get(path);
    if (!f) continue;
    const lines = [];
    for (const row of text8(f()).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const inner = c[2] ?? "";
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]; const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        let val = "";
        if (t === "s") val = strings[Number(v)] ?? "";
        else if (t === "inlineStr") val = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => unxml(x[1])).join("");
        else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) val = unxml(v);
        cells[ref ? colIndex(ref) : cells.length] = val;
      }
      const line = rowLine(Array.from(cells, (x) => x ?? ""));
      if (line.replace(/[ |]/g, "") !== "") lines.push(line);
    }
    sheets.push({ name, text: lines.join("\n") });
  }
  return sheets;
}

/** A CSV file's text: UTF-8 (a BOM is dropped), else Windows Arabic. */
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, ""); }
  catch { return new TextDecoder("windows-1256").decode(u8); }
}
export function csvRows(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, first.split(d).length - 1]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
  const rows = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === "") q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export const csvText = (bytes) => csvRows(decodeText(bytes)).map((r) => rowLine([...r])).filter((l) => l.replace(/[ |]/g, "") !== "").join("\n");

/** A long text in parts at line ends, each at most max characters. */
export function split(text, max = PART_CHARS) {
  const parts = []; let cur = "";
  for (const line of text.split("\n")) {
    const l = line.length > max ? line.slice(0, max) : line;
    if (cur && cur.length + 1 + l.length > max) { parts.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** The kind of an uploaded menu file, by its name and type: pdf, docx, sheet (xlsx or csv), photo, or null (refused). */
export function fileKind(name, type) {
  const n = (name ?? "").toLowerCase();
  if (/^image\/(jpeg|png|webp)$/.test(type ?? "") || /\.(jpe?g|png|webp)$/.test(n)) return "photo";
  if (type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || n.endsWith(".docx")) return "docx";
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || n.endsWith(".xlsx")) return "sheet";
  if (type === "text/csv" || n.endsWith(".csv")) return "sheet";
  return null;
}

/** A fetched file's pages for record_menu_source_pages: [{position, title, body}]. kind docx or sheet; name decides xlsx or csv. */
export function filePages(kind, name, bytes) {
  const label = (name ?? "").slice(0, 120) || (kind === "docx" ? "Word file" : "Sheet");
  let blocks;
  if (kind === "docx") blocks = [{ title: label, text: docxText(bytes) }];
  else if (/\.csv$/i.test(name ?? "") || !isZip(bytes)) blocks = [{ title: label, text: csvText(bytes) }];
  else blocks = xlsxSheets(bytes).map((s) => ({ title: `${label}: ${s.name}`.slice(0, 200), text: s.text }));
  const pages = [];
  for (const b of blocks) {
    const parts = split(b.text);
    parts.forEach((t, i) => pages.push({ position: pages.length, title: parts.length > 1 ? `${b.title} (part ${i + 1} of ${parts.length})`.slice(0, 200) : b.title, body: t }));
  }
  return pages;
}
const isZip = (bytes) => { const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); return u8[0] === 0x50 && u8[1] === 0x4b; };

/** A PDF's page count (from its page objects; a hint for the cap, not a parser). */
export const pdfPages = (bytes) => (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
