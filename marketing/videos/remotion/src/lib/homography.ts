/**
 * CSS matrix3d that maps a w×h element onto a quad (four projected screen corners): top-left, top-right, bottom-right,
 * bottom-left, in pixels. This is how the HTML chat sits exactly on the 3D phone's glass at any angle.
 */
type P = [number, number];

const solve = (A: number[][], b: number[]) => {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
};

export const quadToMatrix3d = (w: number, h: number, q: [P, P, P, P]) => {
  const src: P[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const [a, bb, c, d, e, f, g, hh] = solve(A, b);
  // Column-major 4×4 for CSS: maps (x, y, 0, 1).
  const m = [a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((x) => +x.toFixed(10)).join(',')})`;
};
