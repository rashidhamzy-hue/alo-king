#!/usr/bin/env node
// Builds public/chouf-contours.svg: the quiet background texture of the site (DECISIONS §37.2), contour lines of an
// imagined mountain range in the spirit of the Chouf. Deterministic (seeded), static, no runtime cost.
//   node scripts/web/build-contours.mjs
import { writeFileSync } from "node:fs";

const W = 1600, H = 1000, CELL = 25;
const NX = W / CELL, NY = H / CELL;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(1971);

// Several separate summits along a ridge from lower-left to upper-right, with valleys between them.
const peaks = [];
for (let i = 0; i < 14; i++) {
  const t = i / 13;
  peaks.push({
    x: W * (0.04 + 0.92 * t) + (rand() - 0.5) * 220,
    y: H * (0.86 - 0.7 * t) + (rand() - 0.5) * 420,
    h: 0.35 + rand() * 0.75,
    r: 70 + rand() * 120,
    sx: 1 + rand() * 1.4,
    rot: (rand() - 0.5) * 1.6,
  });
}
const waves = Array.from({ length: 9 }, (_, n) => ({ fx: 0.003 + rand() * 0.011, fy: 0.003 + rand() * 0.011, p: rand() * 6.28, a: 0.07 / (1 + n * 0.35) }));
function height(x, y) {
  // Domain warp so the lines wander instead of forming tidy ovals.
  const wx = x + 38 * Math.sin(y * 0.011 + 1.3) + 22 * Math.sin(y * 0.027 + x * 0.004);
  const wy = y + 38 * Math.sin(x * 0.009 + 0.4) + 22 * Math.sin(x * 0.023 - y * 0.005);
  let h = 0;
  for (const p of peaks) {
    const c = Math.cos(p.rot), sn = Math.sin(p.rot);
    const ux = (wx - p.x) * c + (wy - p.y) * sn, uy = -(wx - p.x) * sn + (wy - p.y) * c;
    const dx = ux / (p.r * p.sx), dy = uy / p.r;
    h += p.h * Math.exp(-(dx * dx + dy * dy));
  }
  for (const w of waves) h += w.a * Math.sin(wx * w.fx + wy * w.fy * 1.7 + w.p);
  return h;
}

const grid = [];
for (let j = 0; j <= NY; j++) {
  const row = [];
  for (let i = 0; i <= NX; i++) row.push(height(i * CELL, j * CELL));
  grid.push(row);
}

const LEVELS = 18;
const lo = 0.1, hi = 1.0;
const lines = [];
for (let k = 0; k < LEVELS; k++) {
  const lv = lo + ((hi - lo) * k) / (LEVELS - 1);
  const segs = [];
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = i * CELL, y0 = j * CELL;
      const lerp = (p, q) => (lv - p) / (q - p);
      const top = [x0 + CELL * lerp(a, b), y0];
      const right = [x0 + CELL, y0 + CELL * lerp(b, c)];
      const bottom = [x0 + CELL * lerp(d, c), y0 + CELL];
      const left = [x0, y0 + CELL * lerp(a, d)];
      const table = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
        5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]],
        9: [[top, bottom]], 10: [[left, bottom], [top, right]], 11: [[top, right]], 12: [[left, right]],
        13: [[bottom, right]], 14: [[left, bottom]],
      };
      for (const s of table[idx] ?? []) segs.push(s);
    }
  }
  // Chain segments into polylines.
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const ends = new Map();
  segs.forEach((s, n) => { for (const p of s) { const kk = key(p); (ends.get(kk) ?? ends.set(kk, []).get(kk)).push(n); } });
  const used = new Array(segs.length).fill(false);
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = true;
    let chain = [segs[n][0], segs[n][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir === 1 ? chain[chain.length - 1] : chain[0];
        const next = (ends.get(key(tip)) ?? []).find((m) => !used[m]);
        if (next === undefined) break;
        used[next] = true;
        const [p, q] = segs[next];
        const other = key(p) === key(tip) ? q : p;
        if (dir === 1) chain.push(other); else chain.unshift(other);
      }
    }
    if (chain.length >= 6) lines.push({ k, chain });
  }
}

const r1 = (n) => Math.round(n);
let paths = "";
for (const { chain } of lines) {
  // Quadratic smoothing through segment midpoints, in relative coordinates to keep the file small.
  let d = `M${r1(chain[0][0])} ${r1(chain[0][1])}`;
  let cx = r1(chain[0][0]), cy = r1(chain[0][1]);
  for (let i = 1; i < chain.length - 1; i++) {
    const mx = r1((chain[i][0] + chain[i + 1][0]) / 2), my = r1((chain[i][1] + chain[i + 1][1]) / 2);
    d += `q${r1(chain[i][0]) - cx} ${r1(chain[i][1]) - cy} ${mx - cx} ${my - cy}`;
    cx = mx; cy = my;
  }
  paths += `<path d="${d}"/>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#F4B63C" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="1">${paths}</svg>\n`;
writeFileSync("public/chouf-contours.svg", svg);
console.log(`${lines.length} contour lines, ${svg.length} bytes`);
