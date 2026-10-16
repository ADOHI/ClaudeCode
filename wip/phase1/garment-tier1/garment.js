// Tier 1 garments (decision-v2 §3(b)): fitted clothes over the bust whose
// fabric bridges the cleavage or lifts off the skin (straps).
//
// The bind-space field (field.js) moves every layer with one spatial map. That
// keeps layer order (det(I+J) > 0) but it can only move fabric *parallel* to
// the skin under it: fabric spanning the cleavage stays behind while the apexes
// advance, and compression (size_down) thins the gap below the cloth thickness.
// Tier 1 keeps the field where the cloth clings and replaces it elsewhere:
//
//   1. split     body / garment triangles by mesh or material (explicit config)
//   2. cling     per garment vertex: signed distance to the body, nearest body
//                point, inward probe -> tight | bridge | free | locked
//   3. inpaint   bridge displacement from the matched region, minimizing
//                u^T Q u with Q = -L + L M^-1 L (Abdrashitov et al. 2023, robust
//                transfer; cotangent L, lumped M), sparse CG
//   4. relax     projective membrane iterations (edge springs at the inpainted
//                lengths, pins on matched vertices) + obstacle sd(x) >= thickness
//                against the field-deformed body, then a hard projection
//   5. check     clearance over every slider corner (superset of validate.js
//                extremeCombos) x w in {.25,.5,.75,1}; bridge vs
//                apex forward displacement
//   6. output    per-vertex deltas in bake.js layout (mesh local space)
//
// Lengths in options are in S units (shoulder width) like field.js; internally
// everything is bind space. No dependencies beyond the other core modules.

import { cross, dot, normalize, m4Linear, m3Inverse, m3Vec, m3Transpose } from './vec.js';
import { sliderToWeights, toBody } from './field.js';
import { bakeMesh } from './bake.js';

export const TIGHT = 0; // clings to the skin: follows the field
export const BRIDGE = 1; // body behind but out of reach: inpainted
export const FREE = 2; // no body behind (culled skin, floating parts): follows the field
export const LOCKED = 3; // shares/touches body vertices: must equal the body's delta
export const CLASS_NAMES = ['tight', 'bridge', 'free', 'locked'];

export const DEFAULT_GARMENT_OPTS = {
  thickness: 0.01, // required garment-body clearance
  tightDist: 0.03, // signed distance below which fabric counts as clinging
  maxProbe: 0.3, // inward probe: body hit within this => bridge, else free
  lockDist: 1e-4, // closer than this to the skin: stitched, moves with the body
  harmonic: 1, // alpha in Q = -alpha L + L M^-1 L (positions in S units)
  regularize: 1e-3, // eps * M pull toward the field value (unanchored islands)
  rings: 2, // ROI dilation beyond the support / bridge components
  relaxIters: 12,
  margin: 0.1, // extra clearance (fraction of thickness) when a vertex is pushed
  slop: 0.01, // grazing tolerance (fraction of thickness) before a push
  blendFix: true, // make linear blends of the targets clear the body too
  kEdge: 1,
  kPinMatched: 100,
  kPinBridge: 0.01,
  kObstacle: 1e4,
};

// Example split configs. Selectors match by mesh name and/or material name
// ('*' wildcard or RegExp); a triangle belongs to the first part (body first,
// then garments in order) whose selector matches it.
export const SPLIT_PRESETS = {
  // Wuthering Waves Changli (official MMD; private technical tests only):
  // one mesh, 34 material groups. Skin under the top is culled in the model.
  changli: {
    body: [{ material: 'UP_Skin' }, { material: 'Down_Skin' }],
    garments: [
      { name: 'UP', select: [{ material: 'UP' }] },
      { name: 'UP_Dressin', select: [{ material: 'UP_Dressin' }] },
      { name: 'UP_Belt', select: [{ material: 'UP_Belt' }] },
      { name: 'Cloth', select: [{ material: 'Cloth*' }] },
    ],
  },
  // Seed-san (VRM, flat chest): one mesh per layer; wear_1 is the body suit.
  seedsan: {
    body: [{ mesh: 'wear_1' }],
    garments: [
      { name: 'huku', select: [{ mesh: 'wear_4' }] },
      { name: 'jacket', select: [{ mesh: 'wear_10' }] },
      { name: 'strap', select: [{ mesh: 'wear_11' }, { mesh: 'wear_12' }] },
    ],
  },
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ---------------------------------------------------------------------------
// bust-bind/1 decoding (base64 little-endian typed arrays, see tools/README.md)

function b64ToBytes(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function decodeBind(json) {
  const f32 = (s) => (s ? new Float32Array(b64ToBytes(s).buffer) : null);
  const u32 = (s) => (s ? new Uint32Array(b64ToBytes(s).buffer) : null);
  return json.meshes.map((m) => ({
    name: m.name ?? '',
    pos: f32(m.positions),
    normals: f32(m.normals),
    index: u32(m.index),
    mask: f32(m.mask),
    bindMatrix: m.bindMatrix ?? IDENTITY,
    groups: m.groups ?? [],
  }));
}

// ---------------------------------------------------------------------------
// 1. Body / garment split

function pattern(p) {
  if (p == null) return null;
  if (p instanceof RegExp) return p;
  const parts = String(p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.*')}$`);
}

function indexOf(m) {
  if (!m._seqIndex) m._seqIndex = m.index ?? Uint32Array.from({ length: m.pos.length / 3 }, (_, i) => i);
  return m._seqIndex;
}

/**
 * @param {Array<{name:string,pos:Float32Array,normals:Float32Array|null,index:Uint32Array|null,
 *   mask:Float32Array|null,bindMatrix:number[],groups:Array<{start:number,count:number,material:string}>}>} meshes
 *   bind-space meshes (decodeBind)
 * @param {{body:object[], garments:Array<{name:string, select:object[], thickness?:number}>}} config
 */
export function splitScene(meshes, config) {
  const specs = [{ name: 'body', select: config.body }, ...config.garments];
  const triOwner = meshes.map((m) => new Int32Array(indexOf(m).length / 3).fill(-1));
  specs.forEach((spec, id) => {
    const sels = spec.select.map((s) => ({ mesh: pattern(s.mesh), material: pattern(s.material) }));
    meshes.forEach((m, mi) => {
      const idx = indexOf(m);
      const groups = m.groups?.length ? m.groups : [{ start: 0, count: idx.length, material: '' }];
      for (const g of groups) {
        const hit = sels.some((c) => (!c.mesh || c.mesh.test(m.name ?? '')) && (!c.material || c.material.test(g.material ?? '')));
        if (!hit) continue;
        const t1 = Math.floor((g.start + g.count) / 3);
        for (let t = Math.floor(g.start / 3); t < t1; t++) if (triOwner[mi][t] < 0) triOwner[mi][t] = id;
      }
    });
  });
  // A vertex referenced by several parts belongs to the first one (the body
  // wins): one vertex can only carry one delta.
  const vertOwner = meshes.map((m, mi) => {
    const vo = new Int32Array(m.pos.length / 3).fill(-1);
    const idx = indexOf(m), to = triOwner[mi];
    for (let t = 0; t < to.length; t++) {
      const id = to[t];
      if (id < 0) continue;
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        if (vo[v] < 0 || id < vo[v]) vo[v] = id;
      }
    }
    return vo;
  });
  const parts = specs.map((spec, id) => {
    const local = meshes.map((m) => new Int32Array(m.pos.length / 3).fill(-1));
    const srcMesh = [], srcVert = [], index = [];
    meshes.forEach((m, mi) => {
      const idx = indexOf(m), to = triOwner[mi];
      for (let t = 0; t < to.length; t++) {
        if (to[t] !== id) continue;
        for (let k = 0; k < 3; k++) {
          const v = idx[t * 3 + k];
          if (local[mi][v] < 0) {
            local[mi][v] = srcMesh.length;
            srcMesh.push(mi);
            srcVert.push(v);
          }
          index.push(local[mi][v]);
        }
      }
    });
    const n = srcMesh.length;
    const pos = new Float32Array(n * 3), mask = new Float32Array(n).fill(1), owned = new Uint8Array(n);
    const hasN = n > 0 && srcMesh.every((mi) => meshes[mi].normals);
    const normals = hasN ? new Float32Array(n * 3) : null;
    for (let i = 0; i < n; i++) {
      const m = meshes[srcMesh[i]], v = srcVert[i];
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = m.pos[v * 3 + k];
      if (normals) for (let k = 0; k < 3; k++) normals[i * 3 + k] = m.normals[v * 3 + k];
      if (m.mask) mask[i] = m.mask[v];
      owned[i] = vertOwner[srcMesh[i]][v] === id ? 1 : 0;
    }
    return {
      name: spec.name,
      thickness: spec.thickness,
      pos, normals, mask, owned,
      index: Uint32Array.from(index),
      srcMesh: Int32Array.from(srcMesh),
      srcVert: Int32Array.from(srcVert),
    };
  });
  return { meshes, body: parts[0], garments: parts.slice(1) };
}

// ---------------------------------------------------------------------------
// Welding: UV seams split vertices; solving on the split mesh would treat the
// seam as a free boundary and tear it open. Everything below runs on welded
// vertices and scatters back, so split copies get bit-identical deltas.

export function weld(pos, index, q) {
  const n = pos.length / 3;
  const wid = new Int32Array(n);
  const map = new Map();
  const rep = [];
  for (let v = 0; v < n; v++) {
    const key = `${Math.round(pos[v * 3] / q)},${Math.round(pos[v * 3 + 1] / q)},${Math.round(pos[v * 3 + 2] / q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = rep.length;
      map.set(key, id);
      rep.push(v);
    }
    wid[v] = id;
  }
  const nw = rep.length;
  const wpos = new Float64Array(nw * 3);
  rep.forEach((v, i) => {
    wpos[i * 3] = pos[v * 3];
    wpos[i * 3 + 1] = pos[v * 3 + 1];
    wpos[i * 3 + 2] = pos[v * 3 + 2];
  });
  // Drop collapsed triangles and duplicates (double-sided copies would cancel
  // area-weighted normals and make edges non-manifold).
  const seen = new Set();
  const tri = [];
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = wid[index[i]], b = wid[index[i + 1]], c = wid[index[i + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) continue;
    seen.add(s);
    tri.push(a, b, c);
  }
  return { n: nw, wid, rep: Int32Array.from(rep), pos: wpos, tri: Int32Array.from(tri) };
}

// Area-weighted vertex normals of a welded triangle mesh.
export function vertexNormals(pos, tri, n) {
  const N = new Float64Array(n * 3);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      N[v] += nx;
      N[v + 1] += ny;
      N[v + 2] += nz;
    }
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    if (l > 0) for (let k = 0; k < 3; k++) N[v * 3 + k] /= l;
  }
  return N;
}

// Flip all triangles if the geometric normals disagree with the authored ones.
function orient(w, normals) {
  if (!normals) return;
  const N = vertexNormals(w.pos, w.tri, w.n);
  let s = 0;
  for (let i = 0; i < w.n; i++) {
    const r = w.rep[i];
    s += N[i * 3] * normals[r * 3] + N[i * 3 + 1] * normals[r * 3 + 1] + N[i * 3 + 2] * normals[r * 3 + 2];
  }
  if (s < 0) for (let t = 0; t < w.tri.length; t += 3) [w.tri[t + 1], w.tri[t + 2]] = [w.tri[t + 2], w.tri[t + 1]];
}

// ---------------------------------------------------------------------------
// BVH over triangles: closest point and ray queries; refit after deformation.

const R_F = 0, R_A = 1, R_B = 2, R_C = 3, R_AB = 4, R_BC = 5, R_CA = 6;

// Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5).
// Writes [x, y, z, baryA, baryB, baryC, region] into o.
function closestPtTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, o) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return set7(o, ax, ay, az, 1, 0, 0, R_A);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set7(o, bx, by, bz, 0, 1, 0, R_B);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return set7(o, ax + v * abx, ay + v * aby, az + v * abz, 1 - v, v, 0, R_AB);
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set7(o, cx, cy, cz, 0, 0, 1, R_C);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return set7(o, ax + w * acx, ay + w * acy, az + w * acz, 1 - w, 0, w, R_CA);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return set7(o, bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz), 0, 1 - w, w, R_BC);
  }
  const den = va + vb + vc;
  if (!(den > 0)) return set7(o, ax, ay, az, 1, 0, 0, R_A); // degenerate
  const v = vb / den, w = vc / den;
  return set7(o, ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w, 1 - v - w, v, w, R_F);
}

function set7(o, x, y, z, u, v, w, r) {
  o[0] = x; o[1] = y; o[2] = z; o[3] = u; o[4] = v; o[5] = w; o[6] = r;
  return o;
}

export function buildBVH(pos, tri, leafSize = 4) {
  const nt = tri.length / 3;
  const cen = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) cen[t * 3 + k] = (pos[tri[t * 3] * 3 + k] + pos[tri[t * 3 + 1] * 3 + k] + pos[tri[t * 3 + 2] * 3 + k]) / 3;
  const order = Int32Array.from({ length: nt }, (_, i) => i);
  const maxNodes = Math.max(1, 2 * nt);
  const box = new Float64Array(maxNodes * 6);
  const child = new Int32Array(maxNodes).fill(-1); // left child; right = left + 1
  const start = new Int32Array(maxNodes), count = new Int32Array(maxNodes);
  let nodes = 1;
  const stack = [[0, 0, nt]];
  while (stack.length) {
    const [nd, s, e] = stack.pop();
    start[nd] = s;
    count[nd] = e - s;
    if (e - s <= leafSize) continue;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++)
      for (let k = 0; k < 3; k++) {
        const c = cen[order[i] * 3 + k];
        if (c < lo[k]) lo[k] = c;
        if (c > hi[k]) hi[k] = c;
      }
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const ax = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    if (!(ext[ax] > 0)) continue; // all centroids coincide: keep as a leaf
    const mid = (s + e) >> 1;
    nthElement(order, s, e, mid, (t) => cen[t * 3 + ax]);
    const l = nodes;
    nodes += 2;
    child[nd] = l;
    count[nd] = 0;
    stack.push([l, s, mid], [l + 1, mid, e]);
  }

  // Bounds bottom-up: children are always allocated after their parent.
  function refit(P) {
    for (let nd = nodes - 1; nd >= 0; nd--) {
      const b = nd * 6;
      if (child[nd] < 0) {
        box[b] = box[b + 1] = box[b + 2] = Infinity;
        box[b + 3] = box[b + 4] = box[b + 5] = -Infinity;
        for (let i = start[nd]; i < start[nd] + count[nd]; i++) {
          const t = order[i];
          for (let c = 0; c < 3; c++) {
            const v = tri[t * 3 + c] * 3;
            for (let k = 0; k < 3; k++) {
              if (P[v + k] < box[b + k]) box[b + k] = P[v + k];
              if (P[v + k] > box[b + 3 + k]) box[b + 3 + k] = P[v + k];
            }
          }
        }
      } else {
        const l = child[nd] * 6, r = l + 6;
        for (let k = 0; k < 3; k++) {
          box[b + k] = Math.min(box[l + k], box[r + k]);
          box[b + 3 + k] = Math.max(box[l + 3 + k], box[r + 3 + k]);
        }
      }
    }
  }

  const st = new Int32Array(128);
  const tmp = new Float64Array(7);
  function boxD2(nd, x, y, z) {
    const b = nd * 6;
    const dx = x < box[b] ? box[b] - x : x > box[b + 3] ? x - box[b + 3] : 0;
    const dy = y < box[b + 1] ? box[b + 1] - y : y > box[b + 4] ? y - box[b + 4] : 0;
    const dz = z < box[b + 2] ? box[b + 2] - z : z > box[b + 5] ? z - box[b + 5] : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  // Nearest triangle within sqrt(maxD2); fills out (closestPtTri layout) and
  // returns the triangle index or -1.
  function closest(P, x, y, z, maxD2, out) {
    let best = maxD2, bt = -1, sp = 0;
    st[sp++] = 0;
    while (sp) {
      const nd = st[--sp];
      if (boxD2(nd, x, y, z) >= best) continue;
      const l = child[nd];
      if (l < 0) {
        for (let i = start[nd]; i < start[nd] + count[nd]; i++) {
          const t = order[i];
          const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
          closestPtTri(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], tmp);
          const d2 = (tmp[0] - x) ** 2 + (tmp[1] - y) ** 2 + (tmp[2] - z) ** 2;
          if (d2 < best) {
            best = d2;
            bt = t;
            out.set(tmp);
          }
        }
      } else {
        const dl = boxD2(l, x, y, z), dr = boxD2(l + 1, x, y, z);
        // push the farther child first so the nearer one is visited first
        if (dl < dr) {
          if (dr < best) st[sp++] = l + 1;
          if (dl < best) st[sp++] = l;
        } else {
          if (dl < best) st[sp++] = l;
          if (dr < best) st[sp++] = l + 1;
        }
      }
    }
    return bt;
  }

  // First hit along o + t d, t in (tMin, tMax]; returns {t, tri}.
  function raycast(P, o, d, tMin, tMax) {
    const inv = d.map((v) => (Math.abs(v) > 1e-30 ? 1 / v : 1e30 * (v < 0 ? -1 : 1)));
    let bestT = tMax, bt = -1, sp = 0;
    st[sp++] = 0;
    while (sp) {
      const nd = st[--sp];
      const b = nd * 6;
      let t0 = tMin, t1 = bestT;
      for (let k = 0; k < 3; k++) {
        let ta = (box[b + k] - o[k]) * inv[k], tb = (box[b + 3 + k] - o[k]) * inv[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
      }
      if (t0 > t1) continue;
      const l = child[nd];
      if (l >= 0) {
        st[sp++] = l;
        st[sp++] = l + 1;
        continue;
      }
      for (let i = start[nd]; i < start[nd] + count[nd]; i++) {
        const t = order[i];
        const h = rayTri(P, o, d, tri[t * 3] * 3, tri[t * 3 + 1] * 3, tri[t * 3 + 2] * 3);
        if (h > tMin && h <= bestT) {
          bestT = h;
          bt = t;
        }
      }
    }
    return { t: bt < 0 ? Infinity : bestT, tri: bt };
  }

  refit(pos);
  return { refit, closest, raycast, nodes: () => nodes };
}

// Moller-Trumbore, two-sided.
function rayTri(P, o, d, a, b, c) {
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-30) return Infinity;
  const inv = 1 / det;
  const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

function nthElement(a, s, e, k, key) {
  let l = s, r = e - 1;
  while (r > l) {
    const pivot = key(a[(l + r) >> 1]);
    let i = l, j = r;
    while (i <= j) {
      while (key(a[i]) < pivot) i++;
      while (key(a[j]) > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) r = j;
    else if (k >= i) l = i;
    else break;
  }
}

// ---------------------------------------------------------------------------
// Body surface: welded skin with pseudonormals for a robust inside/outside
// sign (Baerentzen & Aanaes 2005). Game bodies are open (skin under clothes is
// often deleted), so a closest point on an open border is treated as outside:
// "inside" only makes sense where the skin is locally closed.

export function buildSurface(part, S) {
  const w = weld(part.pos, part.index, 1e-6 * S);
  orient(w, part.normals);
  const n = w.n, nt = w.tri.length / 3;
  const emap = new Map();
  const triEdge = new Int32Array(nt * 3);
  const eCount = [];
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const a = w.tri[t * 3 + k], b = w.tri[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      let e = emap.get(key);
      if (e === undefined) {
        e = eCount.length;
        emap.set(key, e);
        eCount.push(0);
      }
      eCount[e]++;
      triEdge[t * 3 + k] = e; // edges AB, BC, CA
    }
  const edgeCount = Int32Array.from(eCount);
  const boundaryV = new Uint8Array(n);
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++)
      if (edgeCount[triEdge[t * 3 + k]] !== 2) {
        boundaryV[w.tri[t * 3 + k]] = 1;
        boundaryV[w.tri[t * 3 + ((k + 1) % 3)]] = 1;
      }

  const faceN = new Float64Array(nt * 3), vertN = new Float64Array(n * 3), edgeN = new Float64Array(edgeCount.length * 3);
  let P = w.pos;
  function normals() {
    faceN.fill(0);
    vertN.fill(0);
    edgeN.fill(0);
    for (let t = 0; t < nt; t++) {
      const ia = w.tri[t * 3], ib = w.tri[t * 3 + 1], ic = w.tri[t * 3 + 2];
      const A = [P[ia * 3], P[ia * 3 + 1], P[ia * 3 + 2]], B = [P[ib * 3], P[ib * 3 + 1], P[ib * 3 + 2]], C = [P[ic * 3], P[ic * 3 + 1], P[ic * 3 + 2]];
      const nn = normalize(cross(sub3(B, A), sub3(C, A)));
      faceN.set(nn, t * 3);
      // angle-weighted vertex pseudonormals
      const corners = [[ia, A, B, C], [ib, B, C, A], [ic, C, A, B]];
      for (const [v, X, Y, Z] of corners) {
        const ang = angle(sub3(Y, X), sub3(Z, X));
        for (let k = 0; k < 3; k++) vertN[v * 3 + k] += ang * nn[k];
      }
      for (let k = 0; k < 3; k++) {
        const e = triEdge[t * 3 + k] * 3;
        edgeN[e] += nn[0];
        edgeN[e + 1] += nn[1];
        edgeN[e + 2] += nn[2];
      }
    }
    for (let v = 0; v < n; v++) {
      const l = Math.hypot(vertN[v * 3], vertN[v * 3 + 1], vertN[v * 3 + 2]);
      if (l > 0) for (let k = 0; k < 3; k++) vertN[v * 3 + k] /= l;
    }
  }
  normals();
  const bvh = buildBVH(P, w.tri);
  const cp = new Float64Array(7);

  // Rebuild normals and bounds for deformed positions (same topology).
  function setPositions(pos) {
    P = pos;
    normals();
    bvh.refit(P);
  }

  /**
   * Closest body point within maxDist of (x,y,z).
   * out: d (unsigned), s (signed, < 0 inside), c (closest point), n (unit
   * outward push direction), tri, bary. tri = -1 if nothing within maxDist.
   */
  function query(x, y, z, maxDist, out = {}) {
    const t = bvh.closest(P, x, y, z, maxDist * maxDist, cp);
    out.tri = t;
    if (t < 0) {
      out.d = out.s = Infinity;
      return out;
    }
    const dx = x - cp[0], dy = y - cp[1], dz = z - cp[2];
    const d = Math.hypot(dx, dy, dz);
    const r = cp[6];
    let N = null;
    if (r === R_F) N = faceN.subarray(t * 3, t * 3 + 3);
    else if (r <= R_C) {
      const v = w.tri[t * 3 + r - 1];
      if (!boundaryV[v]) N = vertN.subarray(v * 3, v * 3 + 3);
    } else {
      const e = triEdge[t * 3 + (r - R_AB)];
      if (edgeCount[e] === 2) N = edgeN.subarray(e * 3, e * 3 + 3);
    }
    const sign = N && dx * N[0] + dy * N[1] + dz * N[2] < 0 ? -1 : 1;
    out.d = d;
    out.s = sign * d;
    out.c = [cp[0], cp[1], cp[2]];
    out.bary = [cp[3], cp[4], cp[5]];
    // Push direction: gradient of the distance when well defined, else the
    // interpolated skin normal (point on the surface).
    if (d > 1e-7 * S) out.n = [(sign * dx) / d, (sign * dy) / d, (sign * dz) / d];
    else {
      const a = w.tri[t * 3] * 3, b = w.tri[t * 3 + 1] * 3, c = w.tri[t * 3 + 2] * 3;
      out.n = normalize([0, 1, 2].map((k) => cp[3] * vertN[a + k] + cp[4] * vertN[b + k] + cp[5] * vertN[c + k]));
    }
    return out;
  }

  function raycast(o, d, tMax) {
    return bvh.raycast(P, o, d, 1e-9 * S, tMax);
  }

  return { weld: w, part, n, tri: w.tri, rest: w.pos, setPositions, query, raycast, positions: () => P, boundaryV, edgeCount };
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function angle(u, v) {
  const c = dot(u, v), s = Math.hypot(...cross(u, v));
  return Math.atan2(s, c);
}

// ---------------------------------------------------------------------------
// Sparse algebra: cotangent Laplacian (CSR), lumped mass, CG.

/**
 * Cotangent Laplacian, negative semi-definite (L_ii = -sum_j L_ij), and lumped
 * (barycentric) mass. pos is scaled by `scale` first (S units -> both terms of
 * Q have fixed relative weight regardless of model units).
 */
export function cotanLaplacian(pos, tri, n, scale = 1) {
  const rows = Array.from({ length: n }, () => new Map());
  const M = new Float64Array(n);
  const add = (i, j, w) => rows[i].set(j, (rows[i].get(j) ?? 0) + w);
  const COT_MAX = 1e3; // sliver triangles: bounded weights instead of Inf
  for (let t = 0; t < tri.length; t += 3) {
    const ids = [tri[t], tri[t + 1], tri[t + 2]];
    const p = ids.map((i) => [pos[i * 3] * scale, pos[i * 3 + 1] * scale, pos[i * 3 + 2] * scale]);
    const area2 = Math.hypot(...cross(sub3(p[1], p[0]), sub3(p[2], p[0])));
    if (!(area2 > 1e-14)) continue;
    for (let c = 0; c < 3; c++) {
      const a = (c + 1) % 3, b = (c + 2) % 3;
      const cot = dot(sub3(p[a], p[c]), sub3(p[b], p[c])) / area2;
      const wgt = Math.max(-COT_MAX, Math.min(COT_MAX, cot)) / 2;
      add(ids[a], ids[b], wgt);
      add(ids[b], ids[a], wgt);
      M[ids[c]] += area2 / 6;
    }
  }
  const ptr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) ptr[i + 1] = ptr[i] + rows[i].size;
  const col = new Int32Array(ptr[n]), val = new Float64Array(ptr[n]), diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let k = ptr[i], s = 0;
    for (const [j, w] of rows[i]) {
      col[k] = j;
      val[k++] = w;
      s += w;
    }
    diag[i] = -s;
  }
  for (let i = 0; i < n; i++) if (!(M[i] > 1e-14)) M[i] = 1e-14;
  return { n, ptr, col, val, diag, M };
}

export function spmv(L, x, y) {
  for (let i = 0; i < L.n; i++) {
    let s = L.diag[i] * x[i];
    for (let k = L.ptr[i]; k < L.ptr[i + 1]; k++) s += L.val[k] * x[L.col[k]];
    y[i] = s;
  }
  return y;
}

/** Preconditioned conjugate gradients; apply(x, out) computes A x. */
export function cg(apply, b, x, { tol = 1e-10, maxIter = 5000, precond = null } = {}) {
  const n = b.length;
  const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  apply(x, Ap);
  let bn = 0;
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - Ap[i];
    bn += b[i] * b[i];
  }
  bn = Math.sqrt(bn) || 1;
  const pre = (src, dst) => {
    for (let i = 0; i < n; i++) dst[i] = precond ? src[i] * precond[i] : src[i];
  };
  pre(r, z);
  p.set(z);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  let it = 0, rn = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
  for (; it < maxIter && rn > tol * bn; it++) {
    apply(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (!(pAp > 0)) break;
    const alpha = rz / pAp;
    rn = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
      rn += r[i] * r[i];
    }
    rn = Math.sqrt(rn);
    pre(r, z);
    let rz2 = 0;
    for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return { x, iterations: it, residual: rn / bn };
}

// ---------------------------------------------------------------------------
// 3. Biharmonic inpainting (Abdrashitov, Raichstat, Monaghan, Gentle 2023).
//
//   min_u  u^T Q u + eps (u - u0)^T M (u - u0)   s.t. u = u0 on known rows
//   Q = -alpha L + L M^-1 L
// The L M^-1 L (bi-Laplacian) term gives C1-smooth fills that reproduce
// linear functions; -L adds membrane stiffness so long thin bridges do not
// overshoot. eps keeps islands without any known vertex well posed (they
// get the M-weighted mean of the prior, i.e. a rigid shift).

/**
 * @param {object} L cotanLaplacian output (n vertices)
 * @param {Uint8Array} known 1 = fixed value
 * @param {Float64Array} values n*3: fixed values on known rows, prior elsewhere
 */
export function inpaint(L, known, values, { harmonic = 1, regularize = 1e-3, tol = 1e-10, maxIter = 20000 } = {}) {
  const n = L.n, M = L.M;
  const U = [];
  for (let i = 0; i < n; i++) if (!known[i]) U.push(i);
  const m = U.length;
  const out = Float64Array.from(values);
  if (!m) return { u: out, iterations: 0, residual: 0, unknowns: 0 };
  const t1 = new Float64Array(n), t2 = new Float64Array(n);
  const Q = (x, y) => {
    spmv(L, x, t1);
    for (let i = 0; i < n; i++) t2[i] = t1[i] / M[i];
    spmv(L, t2, y);
    for (let i = 0; i < n; i++) y[i] -= harmonic * t1[i];
  };
  const full = new Float64Array(n), Qf = new Float64Array(n);
  const apply = (z, y) => {
    full.fill(0);
    for (let a = 0; a < m; a++) full[U[a]] = z[a];
    Q(full, Qf);
    for (let a = 0; a < m; a++) y[a] = Qf[U[a]] + regularize * M[U[a]] * z[a];
  };
  // Jacobi preconditioner: diag(Q) = -alpha L_ii + sum_k L_ik^2 / M_k
  const pc = new Float64Array(m);
  for (let a = 0; a < m; a++) {
    const i = U[a];
    let d = (L.diag[i] * L.diag[i]) / M[i] - harmonic * L.diag[i] + regularize * M[i];
    for (let k = L.ptr[i]; k < L.ptr[i + 1]; k++) d += (L.val[k] * L.val[k]) / M[L.col[k]];
    pc[a] = 1 / d;
  }
  let iterations = 0, residual = 0;
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) full[i] = known[i] ? values[i * 3 + c] : 0;
    Q(full, Qf);
    const b = new Float64Array(m), x = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      const i = U[a];
      b[a] = -Qf[i] + regularize * M[i] * values[i * 3 + c];
      x[a] = values[i * 3 + c]; // warm start from the prior
    }
    const r = cg(apply, b, x, { tol, maxIter, precond: pc });
    iterations = Math.max(iterations, r.iterations);
    residual = Math.max(residual, r.residual);
    for (let a = 0; a < m; a++) out[U[a] * 3 + c] = x[a];
  }
  return { u: out, iterations, residual, unknowns: m };
}

// ---------------------------------------------------------------------------
// 2. Garment model: weld, cling map, region of interest, operators.

/**
 * Field-only deltas of a part in bind space through bake.js itself, so tight
 * vertices are bit-identical to what the Tier 0 bake writes.
 */
function fieldBake(part, field, targets, withNormals) {
  return bakeMesh({ positions: part.pos, normals: withNormals ? part.normals : null, bindMatrix: IDENTITY, mask: part.mask }, field, targets);
}

// Per welded vertex: field delta of its representative copy (the field is a
// spatial map, so all copies agree unless their skin masks differ).
function weldedDeltas(w, bake, targets) {
  const out = {};
  for (const t of targets) {
    const d = bake.targets[t].dPos, o = new Float64Array(w.n * 3);
    for (let i = 0; i < w.n; i++) for (let k = 0; k < 3; k++) o[i * 3 + k] = d[w.rep[i] * 3 + k];
    out[t] = o;
  }
  return out;
}

export function bodyFieldDeltas(body, field, targets = field.targets) {
  return weldedDeltas(body.weld, fieldBake(body.part, field, targets, false), targets);
}

function adjacency(n, tri) {
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tri.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tri[t + k], b = tri[t + ((k + 1) % 3)];
      nb[a].add(b);
      nb[b].add(a);
    }
  return nb;
}

/**
 * Cling map + operators for one garment part.
 * @param {object} part splitScene part
 * @param {object} body buildSurface (at rest)
 * @param {object} field createBustField
 */
export function prepareGarment(part, body, field, opts = {}) {
  const o = { ...DEFAULT_GARMENT_OPTS, ...opts };
  if (part.thickness != null) o.thickness = part.thickness;
  const S = field.S;
  const targets = o.targets ?? field.targets;
  const w = weld(part.pos, part.index, 1e-6 * S);
  orient(w, part.normals);
  const n = w.n, X = w.pos;
  const gN = vertexNormals(X, w.tri, n);
  const fb = fieldBake(part, field, targets, true);
  const uField = weldedDeltas(w, fb, targets);

  // support: any copy inside the field window with a non-zero skin mask
  const support = new Uint8Array(n), notOwned = new Uint8Array(n);
  for (let v = 0; v < part.pos.length / 3; v++) {
    const i = w.wid[v];
    if (!part.owned[v]) notOwned[i] = 1;
    if (part.mask[v] > 0 && field.weight([part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2]]) > 0) support[i] = 1;
  }

  // cling map (rest, bind space)
  const sRest = new Float64Array(n), probe = new Float64Array(n), cls = new Uint8Array(n);
  const near = new Float64Array(n * 3);
  const q = {};
  const cap = Math.max(o.maxProbe, o.tightDist) * S * 2;
  for (let i = 0; i < n; i++) {
    const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
    body.query(x, y, z, cap, q);
    sRest[i] = q.s;
    if (q.tri >= 0) near.set(q.c, i * 3);
    else near.fill(NaN, i * 3, i * 3 + 3);
    const hit = body.raycast([x, y, z], [-gN[i * 3], -gN[i * 3 + 1], -gN[i * 3 + 2]], o.maxProbe * S);
    probe[i] = hit.t;
    if (notOwned[i] || Math.abs(q.s) < o.lockDist * S) cls[i] = LOCKED;
    else if (q.s <= o.tightDist * S) cls[i] = TIGHT;
    else if (hit.t <= o.maxProbe * S) cls[i] = BRIDGE;
    else cls[i] = FREE;
  }

  // ROI: support + bridge components touching it, dilated by `rings`.
  const nb = adjacency(n, w.tri);
  const core = Uint8Array.from(support);
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (cls[s] !== BRIDGE || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    let touches = false;
    for (let h = 0; h < comp.length; h++) {
      const i = comp[h];
      if (support[i]) touches = true;
      for (const j of nb[i]) {
        if (support[j]) touches = true;
        if (cls[j] === BRIDGE && !seen[j]) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    if (touches) for (const i of comp) core[i] = 1;
  }
  const roiMask = Uint8Array.from(core);
  let frontier = [];
  for (let i = 0; i < n; i++) if (core[i]) frontier.push(i);
  for (let r = 0; r < o.rings; r++) {
    const next = [];
    for (const i of frontier)
      for (const j of nb[i])
        if (!roiMask[j]) {
          roiMask[j] = 1;
          next.push(j);
        }
    frontier = next;
  }
  const roi = [];
  const roiOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (roiMask[i]) roiOf[i] = roi.push(i) - 1;
  const roiTri = [];
  for (let t = 0; t < w.tri.length; t += 3) {
    const a = roiOf[w.tri[t]], b = roiOf[w.tri[t + 1]], c = roiOf[w.tri[t + 2]];
    if (a >= 0 && b >= 0 && c >= 0) roiTri.push(a, b, c);
  }
  const rp = new Float64Array(roi.length * 3);
  roi.forEach((i, r) => rp.set(X.subarray(i * 3, i * 3 + 3), r * 3));
  const L = cotanLaplacian(rp, roiTri, roi.length, 1 / S);
  // Movable in relaxation: core minus locked. Unknown in inpainting: bridge.
  const movable = new Uint8Array(n), unknown = new Uint8Array(n);
  for (const i of roi) {
    if (core[i] && cls[i] !== LOCKED) movable[i] = 1;
    if (core[i] && cls[i] === BRIDGE) unknown[i] = 1;
  }
  const edges = [];
  const eSeen = new Set();
  for (let t = 0; t < roiTri.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = roi[roiTri[t + k]], b = roi[roiTri[t + ((k + 1) % 3)]];
      const key = a < b ? a * n + b : b * n + a;
      if (eSeen.has(key) || (!movable[a] && !movable[b])) continue;
      eSeen.add(key);
      edges.push(a, b);
    }
  // Required clearance: the thickness, or the rest gap where the authored
  // garment already sits closer (or inside): never make it worse.
  const tau = new Float64Array(n);
  for (let i = 0; i < n; i++) tau[i] = Math.min(o.thickness * S, sRest[i]);

  const counts = [0, 0, 0, 0], roiCounts = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    counts[cls[i]]++;
    if (core[i]) roiCounts[cls[i]]++;
  }
  return {
    name: part.name, part, weld: w, opts: o, S, targets, X, normals: gN,
    fieldBake: fb, uField, support, core, cls, sRest, probe, near, tau,
    roi, roiOf, roiTri: Int32Array.from(roiTri), L, movable, unknown, edges: Int32Array.from(edges),
    stats: {
      vertices: part.pos.length / 3, welded: n, roi: roi.length, core: roiCounts.reduce((a, b) => a + b, 0),
      classes: Object.fromEntries(CLASS_NAMES.map((c, k) => [c, counts[k]])),
      coreClasses: Object.fromEntries(CLASS_NAMES.map((c, k) => [c, roiCounts[k]])),
      restPenetrating: Array.from(sRest).filter((s, i) => core[i] && cls[i] !== LOCKED && s < 0).length,
      restBelowThickness: Array.from(sRest).filter((s, i) => core[i] && cls[i] !== LOCKED && s < (1 - o.slop) * o.thickness * S).length,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Obstacle-constrained membrane relaxation (projective dynamics).
//
//   E(x) = kEdge sum_e |x_i - x_j - l_e d_e|^2          (membrane, lengths of
//        + sum_i kPin_i |x_i - xhat_i|^2                  the inpainted shape)
//        + kObstacle sum_{violating i} |x_i - o_i|^2      (o_i = pushed to tau)
// Local step: d_e = unit edge direction, o_i from the body query; global step:
// one SPD solve (CG, Jacobi) per coordinate. Matched vertices are pinned
// hard, bridges weakly, so pushes spread over the fabric instead of making
// spikes. A final hard projection guarantees sd >= tau at every vertex.

export function relax(model, xhat, body, opts = {}) {
  const o = { ...model.opts, ...opts };
  const { movable, edges, cls, tau, S } = model;
  const n = model.weld.n;
  const x = Float64Array.from(xhat);
  const mv = [];
  const mOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (movable[i]) mOf[i] = mv.push(i) - 1;
  const m = mv.length;
  const stats = { pushed: 0, iterations: 0, maxPush: 0 };
  if (!m) return { x, stats };
  const ne = edges.length / 2;
  const rest = new Float64Array(ne);
  for (let e = 0; e < ne; e++) {
    const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3;
    rest[e] = Math.hypot(xhat[a] - xhat[b], xhat[a + 1] - xhat[b + 1], xhat[a + 2] - xhat[b + 2]);
  }
  const pin = new Float64Array(m), deg = new Float64Array(m);
  for (let a = 0; a < m; a++) pin[a] = cls[mv[a]] === BRIDGE ? o.kPinBridge : o.kPinMatched;
  for (let e = 0; e < ne; e++) {
    const i = mOf[edges[e * 2]], j = mOf[edges[e * 2 + 1]];
    if (i >= 0) deg[i] += o.kEdge;
    if (j >= 0) deg[j] += o.kEdge;
  }
  const margin = o.margin * o.thickness * S;
  // Ignore float-level grazing (authored cloth often sits exactly at tau).
  const slop = o.slop * o.thickness * S;
  const cap = (o.thickness * 4 + 0.05) * S;
  const q = {};
  const active = new Uint8Array(m), target = new Float64Array(m * 3);

  // Contacts are sticky within one relaxation: a vertex once pushed is held
  // where it is (not pulled back inside by its pin), which keeps the
  // projective iterations from oscillating across the obstacle.
  function collide() {
    let count = 0;
    for (let a = 0; a < m; a++) {
      const i = mv[a];
      body.query(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], cap, q);
      if (q.tri < 0 || q.s >= tau[i] - slop) {
        if (active[a]) for (let k = 0; k < 3; k++) target[a * 3 + k] = x[i * 3 + k];
        continue;
      }
      const push = tau[i] + margin - q.s;
      active[a] = 1;
      count++;
      for (let k = 0; k < 3; k++) target[a * 3 + k] = x[i * 3 + k] + push * q.n[k];
    }
    return count;
  }

  const diag = new Float64Array(m), pc = new Float64Array(m);
  const apply = (z, y) => {
    for (let a = 0; a < m; a++) y[a] = diag[a] * z[a];
    for (let e = 0; e < ne; e++) {
      const i = mOf[edges[e * 2]], j = mOf[edges[e * 2 + 1]];
      if (i >= 0 && j >= 0) {
        y[i] -= o.kEdge * z[j];
        y[j] -= o.kEdge * z[i];
      }
    }
  };
  const rhs = new Float64Array(m * 3), dir = new Float64Array(ne * 3);
  for (let it = 0; it < o.relaxIters; it++) {
    const c = collide();
    if (!c) break;
    stats.iterations = it + 1;
    for (let a = 0; a < m; a++) {
      diag[a] = deg[a] + pin[a] + (active[a] ? o.kObstacle : 0);
      pc[a] = 1 / diag[a];
    }
    // local step: edge directions at the current state
    for (let e = 0; e < ne; e++) {
      const i = edges[e * 2] * 3, j = edges[e * 2 + 1] * 3;
      const d = [x[i] - x[j], x[i + 1] - x[j + 1], x[i + 2] - x[j + 2]];
      const l = Math.hypot(...d) || 1;
      for (let k = 0; k < 3; k++) dir[e * 3 + k] = (rest[e] * d[k]) / l;
    }
    rhs.fill(0);
    for (let a = 0; a < m; a++) {
      const i = mv[a];
      for (let k = 0; k < 3; k++) rhs[a * 3 + k] = pin[a] * xhat[i * 3 + k] + (active[a] ? o.kObstacle * target[a * 3 + k] : 0);
    }
    for (let e = 0; e < ne; e++) {
      const gi = edges[e * 2], gj = edges[e * 2 + 1];
      const i = mOf[gi], j = mOf[gj];
      for (let k = 0; k < 3; k++) {
        const p = o.kEdge * dir[e * 3 + k];
        if (i >= 0) rhs[i * 3 + k] += p + (j < 0 ? o.kEdge * x[gj * 3 + k] : 0);
        if (j >= 0) rhs[j * 3 + k] += -p + (i < 0 ? o.kEdge * x[gi * 3 + k] : 0);
      }
    }
    const b = new Float64Array(m), z = new Float64Array(m);
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < m; a++) {
        b[a] = rhs[a * 3 + k];
        z[a] = x[mv[a] * 3 + k];
      }
      cg(apply, b, z, { tol: 1e-10, maxIter: 500, precond: pc });
      for (let a = 0; a < m; a++) x[mv[a] * 3 + k] = z[a];
    }
  }
  // Hard projection: whatever the soft solve left, push out along the
  // distance gradient (a few passes: one push can expose a neighbour face).
  for (let pass = 0; pass < 4; pass++) {
    let moved = 0;
    for (let a = 0; a < m; a++) {
      const i = mv[a];
      body.query(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], cap, q);
      if (q.tri < 0 || q.s >= tau[i] - slop) continue;
      const push = tau[i] + margin * 0.5 - q.s;
      for (let k = 0; k < 3; k++) x[i * 3 + k] += push * q.n[k];
      moved++;
    }
    if (!moved) break;
  }
  for (let a = 0; a < m; a++) {
    const i = mv[a];
    const d = Math.hypot(x[i * 3] - xhat[i * 3], x[i * 3 + 1] - xhat[i * 3 + 1], x[i * 3 + 2] - xhat[i * 3 + 2]);
    if (d > 0) stats.pushed++;
    if (d > stats.maxPush) stats.maxPush = d;
  }
  return { x, stats };
}

// ---------------------------------------------------------------------------
// Solve every target: field init -> inpaint bridges -> relax against the
// field-deformed body. Returns welded bind-space deltas.

function displaceBody(body, bodyDeltas, weights) {
  const P = Float64Array.from(body.rest);
  for (const [t, wt] of Object.entries(weights)) {
    if (!wt || !bodyDeltas[t]) continue;
    const d = bodyDeltas[t];
    for (let i = 0; i < P.length; i++) P[i] += wt * d[i];
  }
  body.setPositions(P);
}

export function solveGarment(model, body, bodyDeltas, opts = {}) {
  const o = { ...model.opts, ...opts };
  const { roi, L, X, uField, unknown } = model;
  const n = model.weld.n, nr = roi.length;
  const known = new Uint8Array(nr);
  roi.forEach((i, r) => (known[r] = unknown[i] ? 0 : 1));
  const deltas = {}, info = {};
  for (const t of model.targets) {
    const vals = new Float64Array(nr * 3);
    roi.forEach((i, r) => vals.set(uField[t].subarray(i * 3, i * 3 + 3), r * 3));
    const inp = inpaint(L, known, vals, { harmonic: o.harmonic, regularize: o.regularize });
    const xhat = Float64Array.from(X);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) xhat[i * 3 + k] += uField[t][i * 3 + k];
    roi.forEach((i, r) => {
      for (let k = 0; k < 3; k++) xhat[i * 3 + k] = X[i * 3 + k] + inp.u[r * 3 + k];
    });
    displaceBody(body, bodyDeltas, { [t]: 1 });
    const rl = relax(model, xhat, body, o);
    const d = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) d[i] = rl.x[i] - X[i];
    deltas[t] = d;
    info[t] = { cgIterations: inp.iterations, cgResidual: inp.residual, unknowns: inp.unknowns, ...rl.stats };
  }
  body.setPositions(body.rest);
  if (o.blendFix) info.blend = fixBlends(model, body, bodyDeltas, deltas, o.blendOpts);
  return { deltas, info };
}

// Every corner of the slider space including size = 0 (extremeCombos always
// has a size target; single lift/spread shapes must clear the body too).
export function garmentCombos() {
  const out = [];
  for (const size of [-1, 0, 1])
    for (const style of size > 0 ? [0, 1] : [0])
      for (const lift of [-1, 0, 1])
        for (const spread of [-1, 0, 1]) if (size || lift || spread) out.push({ size, style, lift, spread });
  return out;
}

function blendConfigs(combos, ws, targets) {
  const out = [];
  for (const c of combos) {
    const wt = sliderToWeights(c);
    for (const w of ws) {
      const a = targets.map((t) => (wt[t] ?? 0) * w);
      if (a.some((v) => v)) out.push({ combo: c, w, a });
    }
  }
  return out;
}

function blendedPoint(X, deltas, targets, a, i) {
  let x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
  for (let k = 0; k < targets.length; k++) {
    if (!a[k]) continue;
    const d = deltas[targets[k]];
    x += a[k] * d[i * 3];
    y += a[k] * d[i * 3 + 1];
    z += a[k] * d[i * 3 + 2];
  }
  return [x, y, z];
}

/**
 * Blend consistency. Contact is nonlinear: two targets that each clear the
 * skin can together press the fabric into it, and a correction baked at
 * w = 1 is only partly applied at w = 0.5. For every check configuration
 * (slider corner x w) and vertex still closer than tau, solve per vertex
 *     min sum_t |delta_t|^2   s.t.  sum_t a_kt n_k . delta_t >= r_k
 * (a_kt = blend weights, n_k = push direction, r_k = missing clearance) by
 * Hildreth's row-action method, add delta_t to the target deltas, re-measure
 * with the real distance and repeat. Least norm spreads the fix over the
 * shapes active in the failing blends instead of over-pushing one of them.
 */
export function fixBlends(model, body, bodyDeltas, deltas, { combos = garmentCombos(), ws = [0.25, 0.5, 0.75, 1], rounds = 4 } = {}) {
  const { movable, tau, X, S, targets } = model;
  const o = model.opts;
  const ids = [];
  for (let i = 0; i < model.weld.n; i++) if (movable[i]) ids.push(i);
  const configs = blendConfigs(combos, ws, targets);
  const margin = o.margin * o.thickness * S, slop = o.slop * o.thickness * S;
  const cap = (o.thickness * 4 + 0.05) * S;
  const T = targets.length;
  const q = {};
  const stats = { rounds: 0, fixedVertices: 0, maxFix: 0, remaining: 0 };
  const fixed = new Uint8Array(model.weld.n);
  for (let round = 0; round <= rounds; round++) {
    const cons = new Map();
    for (const cfg of configs) {
      displaceBody(body, bodyDeltas, Object.fromEntries(targets.map((t, k) => [t, cfg.a[k]])));
      for (const i of ids) {
        const p = blendedPoint(X, deltas, targets, cfg.a, i);
        body.query(p[0], p[1], p[2], cap, q);
        if (q.tri < 0 || q.s >= tau[i] - slop) continue;
        if (!cons.has(i)) cons.set(i, []);
        cons.get(i).push({ a: cfg.a, n: q.n, r: tau[i] + margin * 0.5 - q.s });
      }
    }
    stats.remaining = cons.size;
    if (!cons.size || round === rounds) break;
    stats.rounds = round + 1;
    for (const [i, list] of cons) {
      const d = new Float64Array(T * 3), lam = new Float64Array(list.length);
      for (let sweep = 0; sweep < 100; sweep++) {
        let change = 0;
        list.forEach((c, k) => {
          let g = 0, den = 0;
          for (let t = 0; t < T; t++) {
            if (!c.a[t]) continue;
            g += c.a[t] * (c.n[0] * d[t * 3] + c.n[1] * d[t * 3 + 1] + c.n[2] * d[t * 3 + 2]);
            den += c.a[t] * c.a[t];
          }
          const nl = Math.max(0, lam[k] + (c.r - g) / den);
          const dl = nl - lam[k];
          lam[k] = nl;
          for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) d[t * 3 + e] += dl * c.a[t] * c.n[e];
          change = Math.max(change, Math.abs(dl));
        });
        if (change < 1e-12 * S) break;
      }
      for (let t = 0; t < T; t++) {
        const D = deltas[targets[t]];
        for (let e = 0; e < 3; e++) D[i * 3 + e] += d[t * 3 + e];
        stats.maxFix = Math.max(stats.maxFix, Math.hypot(d[t * 3], d[t * 3 + 1], d[t * 3 + 2]) / S);
      }
      fixed[i] = 1;
    }
  }
  body.setPositions(body.rest);
  for (const i of ids) stats.fixedVertices += fixed[i];
  return stats;
}

// ---------------------------------------------------------------------------
// 6. Output in bake.js layout (mesh local space), one entry per part vertex.

function rotateLike(a, b, v) {
  const c = dot(a, b);
  const k = cross(a, b);
  const s = Math.hypot(...k);
  if (s < 1e-12) return v;
  const ax = [k[0] / s, k[1] / s, k[2] / s];
  const kv = cross(ax, v), kd = dot(ax, v);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + ax[i] * kd * (1 - c));
}

/**
 * @returns {{targets:Object<string,{dPos:Float32Array,dNrm:Float32Array|null,nonZero:number,maxLen:number,changed:number}>,
 *   touched:number, srcMesh:Int32Array, srcVert:Int32Array, owned:Uint8Array}}
 */
export function garmentBakeOutput(model, deltas, meshes) {
  const { part, weld: w, fieldBake: fb } = model;
  const n = part.pos.length / 3;
  const eps = 1e-7 * model.S;
  const lin = meshes.map((m) => {
    const L = m4Linear(m.bindMatrix ?? IDENTITY);
    return { Linv: m3Inverse(L), LT: m3Transpose(L) };
  });
  const gRest = model.normals;
  const out = {};
  let touched = 0;
  const touchedV = new Uint8Array(n);
  for (const t of model.targets) {
    const D = deltas[t];
    const def = Float64Array.from(model.X);
    for (let i = 0; i < def.length; i++) def[i] += D[i];
    const gDef = vertexNormals(def, w.tri, w.n);
    const dPos = new Float32Array(n * 3), dNrm = part.normals ? new Float32Array(n * 3) : null;
    let nonZero = 0, maxLen = 0, changed = 0;
    const fd = fb.targets[t];
    for (let v = 0; v < n; v++) {
      const i = w.wid[v];
      const d = [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]];
      const ch = Math.hypot(d[0] - fd.dPos[v * 3], d[1] - fd.dPos[v * 3 + 1], d[2] - fd.dPos[v * 3 + 2]) > eps;
      const { Linv, LT } = lin[part.srcMesh[v]];
      const dl = m3Vec(Linv, d);
      dPos.set(dl, v * 3);
      const len = Math.hypot(...dl);
      if (len > 0) {
        nonZero++;
        touchedV[v] = 1;
      }
      if (len > maxLen) maxLen = len;
      if (ch) changed++;
      if (dNrm) {
        const n0 = [part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]];
        // unchanged: analytic F^-T normal from bake.js; changed: rotate the
        // authored normal like the geometric normal rotated
        const n1 = ch
          ? rotateLike([gRest[i * 3], gRest[i * 3 + 1], gRest[i * 3 + 2]], [gDef[i * 3], gDef[i * 3 + 1], gDef[i * 3 + 2]], n0)
          : [n0[0] + fd.dNrm[v * 3], n0[1] + fd.dNrm[v * 3 + 1], n0[2] + fd.dNrm[v * 3 + 2]];
        const l0 = normalize(m3Vec(LT, n0)), l1 = normalize(m3Vec(LT, n1));
        dNrm.set([l1[0] - l0[0], l1[1] - l0[1], l1[2] - l0[2]], v * 3);
      }
    }
    out[t] = { dPos, dNrm, nonZero, maxLen, changed };
  }
  for (let v = 0; v < n; v++) touched += touchedV[v];
  return { targets: out, touched, srcMesh: part.srcMesh, srcVert: part.srcVert, owned: part.owned };
}

/**
 * Overwrite per-mesh bake.js results with a garment's corrected deltas
 * (owned vertices only: shared body vertices keep the body's field delta).
 * @param {Array<{targets:Object}>} meshBakes bakeMesh results indexed like `meshes`
 */
export function applyGarmentDeltas(meshBakes, out) {
  for (const [t, g] of Object.entries(out.targets)) {
    for (let v = 0; v < out.srcMesh.length; v++) {
      if (!out.owned[v]) continue;
      const mb = meshBakes[out.srcMesh[v]]?.targets?.[t];
      if (!mb) continue;
      const s = out.srcVert[v];
      for (let k = 0; k < 3; k++) mb.dPos[s * 3 + k] = g.dPos[v * 3 + k];
      if (mb.dNrm && g.dNrm) for (let k = 0; k < 3; k++) mb.dNrm[s * 3 + k] = g.dNrm[v * 3 + k];
    }
  }
  for (const mb of meshBakes)
    for (const r of Object.values(mb?.targets ?? {})) {
      let nonZero = 0, maxLen = 0;
      for (let i = 0; i < r.dPos.length; i += 3) {
        const l = Math.hypot(r.dPos[i], r.dPos[i + 1], r.dPos[i + 2]);
        if (l > 0) nonZero++;
        if (l > maxLen) maxLen = l;
      }
      r.nonZero = nonZero;
      r.maxLen = maxLen;
    }
}

// ---------------------------------------------------------------------------
// 5. Checks.

/**
 * Clearance of the garment against the field-deformed body for linear blends
 * of the given per-target deltas (exactly what Unity / Blender evaluate).
 * slack = sd - tau_i (tau_i = min(thickness, rest gap)); violation if
 * slack < -tol (tol defaults to the grazing slop). minGap is the absolute
 * clearance over vertices whose authored rest gap was >= thickness (within
 * the slop). Default configurations: garmentCombos() (a superset of
 * validate.js extremeCombos) x w in {.25, .5, .75, 1}.
 */
export function gapCheck(model, body, bodyDeltas, deltas, { combos = garmentCombos(), ws = [0.25, 0.5, 0.75, 1], tol = null } = {}) {
  const { core, cls, tau, sRest, X, S, targets } = model;
  const thick = model.opts.thickness * S;
  const tl = (tol ?? model.opts.slop * model.opts.thickness) * S;
  const ids = [];
  for (let i = 0; i < model.weld.n; i++) if (core[i] && cls[i] !== LOCKED) ids.push(i);
  const q = {};
  const cap = (model.opts.thickness * 4 + 0.05) * S;
  const res = { checked: ids.length, configs: 0, minSlack: Infinity, minGap: Infinity, violations: 0, violatingConfigs: 0, worst: null, perW: {} };
  for (const w of ws) res.perW[w] = { minSlack: Infinity, minGap: Infinity, violations: 0 };
  for (const cfg of blendConfigs(combos, ws, targets)) {
    const { combo: c, w, a } = cfg;
    displaceBody(body, bodyDeltas, Object.fromEntries(targets.map((t, k) => [t, a[k]])));
    res.configs++;
    let viol = 0;
    const pw = res.perW[w];
    for (const i of ids) {
      const p = blendedPoint(X, deltas, targets, a, i);
      body.query(p[0], p[1], p[2], cap, q);
      if (q.tri < 0) continue;
      const slack = q.s - tau[i];
      if (slack < pw.minSlack) pw.minSlack = slack;
      if (slack < res.minSlack) {
        res.minSlack = slack;
        res.worst = { combo: c, w, vertex: i, cls: CLASS_NAMES[cls[i]], s: q.s, tau: tau[i], restGap: sRest[i] };
      }
      if (sRest[i] >= thick - tl) {
        if (q.s < res.minGap) res.minGap = q.s;
        if (q.s < pw.minGap) pw.minGap = q.s;
      }
      if (slack < -tl) {
        viol++;
        pw.violations++;
      }
    }
    res.violations += viol;
    if (viol) res.violatingConfigs++;
  }
  body.setPositions(body.rest);
  // report in S units
  const toS = (v) => (Number.isFinite(v) ? v / S : v);
  res.minSlack = toS(res.minSlack);
  res.minGap = toS(res.minGap);
  for (const pw of Object.values(res.perW)) {
    pw.minSlack = toS(pw.minSlack);
    pw.minGap = toS(pw.minGap);
  }
  if (res.worst) Object.assign(res.worst, { s: toS(res.worst.s), tau: toS(res.worst.tau), restGap: toS(res.worst.restGap) });
  res.thickness = model.opts.thickness;
  return res;
}

/**
 * Does the cleavage bridge advance with the apex? Mean displacement along the
 * body forward axis of bridge vertices within `band` of the midline and
 * `yBand` of the apex height (keeps straps far above the bust out), relative
 * to (a) the field displacement of the apexes (mean of both sides) and
 * (b) the matched vertices holding the bridge (within 2 rings of it): (b)
 * says whether the bridge follows what supports it, (a) whether that
 * support itself moves with the bust.
 */
export function bridgeFollow(model, field, deltas, target, { band = 0.12, yBand = 0.25 } = {}) {
  const f = field.frame, S = field.S;
  const fw = f.forward;
  let apex = 0, apexLen = 0, apexY = 0;
  for (const side of field.sides) {
    const d = field.delta(target, side.apex);
    apex += dot(d, fw) / field.sides.length;
    apexLen += Math.hypot(...d) / field.sides.length;
    apexY += toBody(f, side.apex)[1] / field.sides.length;
  }
  const { X, cls, core } = model;
  const D = deltas[target];
  const fwdOf = (i) => D[i * 3] * fw[0] + D[i * 3 + 1] * fw[1] + D[i * 3 + 2] * fw[2];
  let sum = 0, cnt = 0, minF = Infinity, maxF = -Infinity;
  const picked = [];
  for (let i = 0; i < model.weld.n; i++) {
    if (!core[i] || cls[i] !== BRIDGE) continue;
    const b = toBody(f, [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]);
    if (Math.abs(b[0]) > band * S) continue;
    if (yBand != null && Math.abs(b[1] - apexY) > yBand * S) continue;
    const fwd = fwdOf(i);
    picked.push(i);
    sum += fwd;
    cnt++;
    minF = Math.min(minF, fwd);
    maxF = Math.max(maxF, fwd);
  }
  // supports: non-bridge vertices within two rings of the picked bridge
  if (!model._adj) model._adj = adjacency(model.weld.n, model.weld.tri);
  const ring = new Set(picked), sup = new Set();
  let front = picked;
  for (let r = 0; r < 2; r++) {
    const next = [];
    for (const i of front)
      for (const j of model._adj[i]) {
        if (ring.has(j)) continue;
        ring.add(j);
        next.push(j);
        if (cls[j] !== BRIDGE) sup.add(j);
      }
    front = next;
  }
  let sSum = 0;
  for (const j of sup) sSum += fwdOf(j);
  const sMean = sup.size ? sSum / sup.size : 0;
  const mean = cnt ? sum / cnt : 0;
  return {
    target, count: cnt, supports: sup.size,
    apexForward: apex / S, apexLength: apexLen / S,
    bridgeForward: mean / S, bridgeMin: cnt ? minF / S : 0, bridgeMax: cnt ? maxF / S : 0,
    supportForward: sMean / S,
    ratio: Math.abs(apex) > 1e-12 ? mean / apex : 0,
    supportRatio: Math.abs(sMean) > 1e-12 ? mean / sMean : 0,
  };
}

// ---------------------------------------------------------------------------
// One call for the whole scene.

/**
 * @param {Array} meshes bind-space meshes (decodeBind / rig entries)
 * @param {object} field createBustField
 * @param {object} config split config (SPLIT_PRESETS.*), may carry `thickness`
 * @returns {{scene, body, bodyDeltas, garments: Array}}
 */
export function bakeGarments(meshes, field, config, opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const scene = splitScene(meshes, config);
  const targets = opts.targets ?? field.targets;
  const base = { ...opts, targets };
  if (config.thickness != null && opts.thickness == null) base.thickness = config.thickness;
  const body = buildSurface(scene.body, field.S);
  const bodyDeltas = bodyFieldDeltas(body, field, targets);
  const garments = scene.garments.map((part) => {
    const t1 = now();
    if (!part.pos.length) return { name: part.name, empty: true };
    const model = prepareGarment(part, body, field, base);
    if (!model.roi.length) return { name: part.name, model, inactive: true, ms: now() - t1 };
    const solved = solveGarment(model, body, bodyDeltas);
    const output = garmentBakeOutput(model, solved.deltas, meshes);
    return { name: part.name, model, deltas: solved.deltas, info: solved.info, output, ms: now() - t1 };
  });
  return { scene, body, bodyDeltas, garments, targets, ms: now() - t0 };
}
