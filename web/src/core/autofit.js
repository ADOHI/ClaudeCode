// Automatic placement of the breast anchors from the mesh itself.
//
// Rasterizes the torso triangles into a front height map (max forward
// coordinate per cell of a grid over the chest band, in body-frame x/y), then
// erodes it (min filter): thin protrusions such as straps, buttons, ribbons or
// hair strands vanish, broad mounds stay. The highest eroded cell on each side
// is the apex; the base centre is `depth` behind it. Left/right results are
// symmetrized so the blend shapes stay mirror-symmetric.
//
// If the chest has (almost) no prominence over the surrounding torso, the
// apex height/spacing fall back to an anatomical prior relative to the body
// frame, keeping only the measured surface depth.

import { toBody } from './field.js';

export const ANATOMY_PRIOR = { x: 0.24, yFrac: 0.62 }; // x in S; y as fraction hips->neck

/**
 * @param {object} frame body frame (buildBodyFrame)
 * @param {Array<{pos: Float32Array, index: ArrayLike<number>|null, mask: Float32Array|null}>} meshes bind-space
 * @param {number} depth base->apex distance in S units
 */
export function autoFitAnchor(frame, meshes, depth, { cell = 0.02, erode = 0.05, minProminence = 0.03, xRange = [0.14, 0.42] } = {}) {
  const S = frame.S;
  const H = frame.neckY - frame.hipsY;
  const yMin = frame.hipsY + 0.45 * H, yMax = frame.hipsY + 0.92 * H;
  const c = cell * S;
  const nx = Math.ceil((0.6 * S) / c), ny = Math.ceil((yMax - yMin) / c);
  const maps = { 1: new Float64Array(nx * ny).fill(-Infinity), '-1': new Float64Array(nx * ny).fill(-Infinity) };

  for (const m of meshes) {
    const n = m.pos.length / 3;
    const B = new Float64Array(n * 3);
    for (let v = 0; v < n; v++) B.set(toBody(frame, [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]]), v * 3);
    const triCount = m.index ? m.index.length / 3 : n / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = m.index ? m.index[t * 3] : t * 3, ib = m.index ? m.index[t * 3 + 1] : t * 3 + 1, ic = m.index ? m.index[t * 3 + 2] : t * 3 + 2;
      if (m.mask && (m.mask[ia] < 0.5 || m.mask[ib] < 0.5 || m.mask[ic] < 0.5)) continue;
      rasterize(B, ia, ib, ic, (x, y, z) => {
        const s = x >= 0 ? 1 : -1;
        const ix = Math.floor(Math.abs(x) / c), iy = Math.floor((y - yMin) / c);
        if (ix < 0 || ix >= nx || iy < 0 || iy >= ny) return;
        const k = iy * nx + ix;
        if (z > maps[s][k]) maps[s][k] = z;
      }, c, yMin, yMax);
    }
  }

  const r = Math.max(1, Math.round(erode / cell));
  const apex = {};
  let prominence = Infinity;
  let onEdge = false;
  const ixLo = Math.max(r, Math.floor((xRange[0] * S) / c)), ixHi = Math.min(nx - r, Math.ceil((xRange[1] * S) / c));
  for (const s of [1, -1]) {
    const M = maps[s];
    let best = null, bi = null;
    const vals = [];
    for (let iy = r; iy < ny - r; iy++)
      for (let ix = ixLo; ix < ixHi; ix++) {
        let mn = Infinity;
        for (let dy = -r; dy <= r && mn > -Infinity; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const z = M[(iy + dy) * nx + ix + dx];
            if (z < mn) mn = z;
          }
        if (mn === -Infinity) continue;
        vals.push(mn);
        if (!best || mn > best[2]) {
          best = [(ix + 0.5) * c, yMin + (iy + 0.5) * c, mn];
          bi = [ix, iy];
        }
      }
    if (!best) return null;
    vals.sort((a, b) => a - b);
    prominence = Math.min(prominence, (best[2] - vals[Math.floor(vals.length * 0.5)]) / S);
    // A real apex is a local maximum: a best cell on the search boundary means
    // the surface just keeps rising (loose shirt centre, belly...).
    if (bi[0] <= ixLo || bi[0] >= ixHi - 1 || bi[1] <= r || bi[1] >= ny - r - 1) onEdge = true;
    apex[s] = best;
  }
  const L = apex[1], R = apex[-1];
  let x = (L[0] + R[0]) / 2 / S;
  let y = (L[1] + R[1]) / 2 / S;
  let zApex = (L[2] + R[2]) / 2 / S;
  let usedPrior = false;
  if (prominence < minProminence || onEdge) {
    // No clear mound: trust anatomy for placement, measure the surface depth there.
    usedPrior = true;
    x = ANATOMY_PRIOR.x;
    y = (frame.hipsY + ANATOMY_PRIOR.yFrac * H) / S;
    const ix = Math.floor((x * S) / c), iy = Math.floor((y * S - yMin) / c);
    const z1 = maps[1][iy * nx + ix], z2 = maps[-1][iy * nx + ix];
    if (Number.isFinite(z1) && Number.isFinite(z2)) zApex = (z1 + z2) / 2 / S;
  }
  return { anchor: { x, y, z: zApex - depth }, apexL: L, apexR: [-R[0], R[1], R[2]], prominence, onEdge, usedPrior };
}

// Visit cell centres covered by the triangle's projection on the body x/y
// plane, with z interpolated barycentrically.
function rasterize(B, a, b, c3, visit, cell, yMin, yMax) {
  const ax = B[a * 3], ay = B[a * 3 + 1], az = B[a * 3 + 2];
  const bx = B[b * 3], by = B[b * 3 + 1], bz = B[b * 3 + 2];
  const cx = B[c3 * 3], cy = B[c3 * 3 + 1], cz = B[c3 * 3 + 2];
  const y0 = Math.max(Math.min(ay, by, cy), yMin), y1 = Math.min(Math.max(ay, by, cy), yMax);
  if (y0 > y1) return;
  const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx);
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(det) < 1e-18) return;
  // Snap to cell centres on a grid anchored at x = 0 and y = yMin, so both
  // sides of the body share the same lattice.
  const gx0 = Math.ceil(x0 / cell - 0.5), gx1 = Math.floor(x1 / cell - 0.5);
  const gy0 = Math.ceil((y0 - yMin) / cell - 0.5), gy1 = Math.floor((y1 - yMin) / cell - 0.5);
  for (let gy = gy0; gy <= gy1; gy++) {
    const py = yMin + (gy + 0.5) * cell;
    for (let gx = gx0; gx <= gx1; gx++) {
      const px = (gx + 0.5) * cell;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
      const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      visit(px, py, l1 * az + l2 * bz + l3 * cz);
    }
  }
}
