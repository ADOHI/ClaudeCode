// Validation of the bust field and of baked blend shapes.
//
// These checks are what decide whether the method is safe to port:
//   fieldCheck  - injectivity (det(I + sum w_k J_k) > 0 => no fold-over, no
//                 new cloth/body intersections) and local volume change
//   meshCheck   - seam / cross-mesh consistency and triangle flips on the
//                 actual baked deltas
//   normalCheck - analytic normal deltas (F^-T) vs. geometric recomputation

import { m3Det, cross, dot, normalize } from './vec.js';
import { sliderToWeights } from './field.js';

// Every corner of the slider space (size, style, lift, spread).
export function extremeCombos() {
  const combos = [];
  for (const size of [-1, 1])
    for (const style of size > 0 ? [0, 1] : [0])
      for (const lift of [-1, 0, 1])
        for (const spread of [-1, 0, 1]) combos.push({ size, style, lift, spread });
  return combos;
}

const label = (c) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ');

export function fieldCheck(field, { res = 14, combos = extremeCombos() } = {}) {
  const T = field.targets;
  const weights = combos.map((c) => sliderToWeights(c));
  let minDet = Infinity, minAt = null, minCombo = null, samples = 0;
  const vol = Object.fromEntries(T.map((t) => [t, { sum: 0, absMax: 0 }]));
  let wsum = 0;

  for (const side of field.sides) {
    const { x, y, z } = field.box;
    for (let i = 0; i < res; i++)
      for (let j = 0; j < res; j++)
        for (let k = 0; k < res; k++) {
          const q = [
            x[0] + ((i + 0.5) / res) * (x[1] - x[0]),
            y[0] + ((j + 0.5) / res) * (y[1] - y[0]),
            z[0] + ((k + 0.5) / res) * (z[1] - z[0]),
          ];
          const qv = field.fromSideVec(side, q);
          const p = [side.base[0] + qv[0], side.base[1] + qv[1], side.base[2] + qv[2]];
          const w = field.weight(p);
          if (w === 0) continue;
          samples++;
          const J = {};
          for (const t of T) {
            J[t] = field.jacobian(t, p);
            const det = m3Det(addI(J[t], 1)) - 1;
            vol[t].sum += det * w;
            vol[t].absMax = Math.max(vol[t].absMax, Math.abs(det));
          }
          wsum += w;
          weights.forEach((wt, ci) => {
            const F = [1, 0, 0, 0, 1, 0, 0, 0, 1];
            for (const t of T) {
              const a = wt[t];
              if (!a) continue;
              for (let e = 0; e < 9; e++) F[e] += a * J[t][e];
            }
            const d = m3Det(F);
            if (d < minDet) {
              minDet = d;
              minAt = p;
              minCombo = combos[ci];
            }
          });
        }
  }
  const volume = Object.fromEntries(
    T.map((t) => [t, { meanChange: vol[t].sum / Math.max(wsum, 1e-12), maxAbsChange: vol[t].absMax }]),
  );
  return { minDet, minAt, minCombo: minCombo && label(minCombo), samples, volume, injective: minDet > 0 };
}

function addI(J, s) {
  return [s * J[0] + 1, s * J[1], s * J[2], s * J[3], s * J[4] + 1, s * J[5], s * J[6], s * J[7], s * J[8] + 1];
}

/**
 * @param {Array<{name:string, pos:Float32Array, index:ArrayLike<number>|null, deltas:Object<string,Float32Array>}>} meshes
 *        positions and deltas in bind space
 * @param {number} S body scale (shoulder width)
 */
export function meshCheck(meshes, S, combos = extremeCombos()) {
  const T = Object.keys(meshes[0]?.deltas ?? {});
  // 1) coincident vertices (UV seams, across meshes) must move identically.
  const q = 1e-5 * S;
  const buckets = new Map();
  const seam = Object.fromEntries(T.map((t) => [t, 0]));
  let maxDelta = 0, coincident = 0;
  for (const [mi, m] of meshes.entries()) {
    const n = m.pos.length / 3;
    for (let v = 0; v < n; v++) {
      const key = `${Math.round(m.pos[v * 3] / q)},${Math.round(m.pos[v * 3 + 1] / q)},${Math.round(m.pos[v * 3 + 2] / q)}`;
      const prev = buckets.get(key);
      if (!prev) {
        buckets.set(key, [mi, v]);
        continue;
      }
      coincident++;
      const pm = meshes[prev[0]], pv = prev[1];
      for (const t of T) {
        const a = m.deltas[t], b = pm.deltas[t];
        const e = Math.hypot(a[v * 3] - b[pv * 3], a[v * 3 + 1] - b[pv * 3 + 1], a[v * 3 + 2] - b[pv * 3 + 2]);
        if (e > seam[t]) seam[t] = e;
      }
    }
    for (const t of T) {
      const a = m.deltas[t];
      for (let i = 0; i < a.length; i += 3) maxDelta = Math.max(maxDelta, Math.hypot(a[i], a[i + 1], a[i + 2]));
    }
  }

  // 2) triangle orientation flips at every slider extreme.
  let flips = 0, worstCombo = null, worstFlips = 0, triangles = 0;
  for (const c of combos) {
    const w = sliderToWeights(c);
    let f = 0;
    for (const m of meshes) {
      const n = m.pos.length / 3;
      const tri = m.index ?? Array.from({ length: n }, (_, i) => i);
      const P = new Float32Array(m.pos);
      for (const t of T) {
        if (!w[t]) continue;
        const d = m.deltas[t];
        for (let i = 0; i < P.length; i++) P[i] += w[t] * d[i];
      }
      for (let i = 0; i + 2 < tri.length; i += 3) {
        const a = tri[i], b = tri[i + 1], cc = tri[i + 2];
        // only triangles that actually move
        let moved = false;
        for (const v of [a, b, cc]) if (P[v * 3] !== m.pos[v * 3] || P[v * 3 + 1] !== m.pos[v * 3 + 1] || P[v * 3 + 2] !== m.pos[v * 3 + 2]) moved = true;
        if (!moved) continue;
        if (c === combos[0]) triangles++;
        const n0 = triNormal(m.pos, a, b, cc), n1 = triNormal(P, a, b, cc);
        const l0 = Math.hypot(...n0);
        if (l0 < 1e-12 * S * S) continue; // degenerate
        if (dot(n0, n1) <= 0) f++;
      }
    }
    flips += f;
    if (f > worstFlips) {
      worstFlips = f;
      worstCombo = label(c);
    }
  }

  return {
    coincidentVertices: coincident,
    seamMismatch: seam, // absolute, bind-space units
    seamMismatchRel: Object.fromEntries(T.map((t) => [t, maxDelta > 0 ? seam[t] / maxDelta : 0])),
    maxDelta,
    movingTriangles: triangles,
    flippedTriangles: flips,
    worstFlips,
    worstCombo,
  };
}

function triNormal(P, a, b, c) {
  const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
  const e1 = [P[b * 3] - pa[0], P[b * 3 + 1] - pa[1], P[b * 3 + 2] - pa[2]];
  const e2 = [P[c * 3] - pa[0], P[c * 3 + 1] - pa[1], P[c * 3 + 2] - pa[2]];
  return cross(e1, e2);
}

// Area-weighted vertex normals with position welding (ignores UV splits).
export function weldedNormals(P, index, S) {
  const n = P.length / 3;
  const q = 1e-6 * S;
  const ids = new Int32Array(n);
  const map = new Map();
  for (let v = 0; v < n; v++) {
    const key = `${Math.round(P[v * 3] / q)},${Math.round(P[v * 3 + 1] / q)},${Math.round(P[v * 3 + 2] / q)}`;
    if (!map.has(key)) map.set(key, map.size);
    ids[v] = map.get(key);
  }
  const acc = new Float64Array(map.size * 3);
  const tri = index ?? Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i + 2 < tri.length; i += 3) {
    const nn = triNormal(P, tri[i], tri[i + 1], tri[i + 2]);
    for (const v of [tri[i], tri[i + 1], tri[i + 2]]) {
      acc[ids[v] * 3] += nn[0];
      acc[ids[v] * 3 + 1] += nn[1];
      acc[ids[v] * 3 + 2] += nn[2];
    }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const k = normalize([acc[ids[v] * 3], acc[ids[v] * 3 + 1], acc[ids[v] * 3 + 2]]);
    out.set(k, v * 3);
  }
  return out;
}

// Rotation-equivalence test: the analytic normal (n + dn) should equal the
// original normal rotated the same way the geometric normal rotated.
// Returns angle error stats in degrees over moving vertices.
export function normalCheck(P, index, normals, dPos, dNrm, S) {
  const g0 = weldedNormals(P, index, S);
  const P1 = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) P1[i] = P[i] + dPos[i];
  const g1 = weldedNormals(P1, index, S);
  const errs = [];
  for (let v = 0; v < P.length / 3; v++) {
    if (!dPos[v * 3] && !dPos[v * 3 + 1] && !dPos[v * 3 + 2]) continue;
    const a = [g0[v * 3], g0[v * 3 + 1], g0[v * 3 + 2]];
    const b = [g1[v * 3], g1[v * 3 + 1], g1[v * 3 + 2]];
    const n0 = normalize([normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]);
    const exp = normalize(rotateLike(a, b, n0));
    const got = normalize([n0[0] + dNrm[v * 3], n0[1] + dNrm[v * 3 + 1], n0[2] + dNrm[v * 3 + 2]]);
    errs.push((Math.acos(Math.min(1, Math.max(-1, dot(exp, got)))) * 180) / Math.PI);
  }
  errs.sort((x, y) => x - y);
  const pick = (f) => (errs.length ? errs[Math.min(errs.length - 1, Math.floor(f * errs.length))] : 0);
  return { count: errs.length, median: pick(0.5), p95: pick(0.95), max: pick(1) };
}

// Apply the minimal rotation taking unit a -> unit b to v (Rodrigues).
function rotateLike(a, b, v) {
  const c = dot(a, b);
  const k = cross(a, b);
  const s = Math.hypot(...k);
  if (s < 1e-9) return v;
  const ax = [k[0] / s, k[1] / s, k[2] / s];
  const kv = cross(ax, v), kd = dot(ax, v);
  return [
    v[0] * c + kv[0] * s + ax[0] * kd * (1 - c),
    v[1] * c + kv[1] * s + ax[1] * kd * (1 - c),
    v[2] * c + kv[2] * s + ax[2] * kd * (1 - c),
  ];
}
