// 래스터/그래프 유틸: 그리드, 거리변환(EDT), 다익스트라, 연결요소, 공간 해시, OBB 기하.

export class Grid {
  constructor(w, h, cell, ox, oz, Type = Float32Array) {
    this.w = w;
    this.h = h;
    this.cell = cell;
    this.ox = ox; // 월드 좌표에서 그리드 (0,0) 모서리
    this.oz = oz;
    this.data = new Type(w * h);
  }
  idx(i, j) {
    return j * this.w + i;
  }
  inside(i, j) {
    return i >= 0 && j >= 0 && i < this.w && j < this.h;
  }
  ci(x) {
    return Math.floor((x - this.ox) / this.cell);
  }
  cj(z) {
    return Math.floor((z - this.oz) / this.cell);
  }
  cx(i) {
    return this.ox + (i + 0.5) * this.cell;
  }
  cz(j) {
    return this.oz + (j + 0.5) * this.cell;
  }
  at(x, z, fallback = 0) {
    const i = this.ci(x), j = this.cj(z);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return fallback;
    return this.data[j * this.w + i];
  }
  bilinear(x, z) {
    const fx = (x - this.ox) / this.cell - 0.5;
    const fz = (z - this.oz) / this.cell - 0.5;
    let i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const w = this.w, h = this.h, d = this.data;
    const i0 = Math.max(0, Math.min(w - 1, i)), i1 = Math.max(0, Math.min(w - 1, i + 1));
    const j0 = Math.max(0, Math.min(h - 1, j)), j1 = Math.max(0, Math.min(h - 1, j + 1));
    const a = d[j0 * w + i0], b = d[j0 * w + i1], c = d[j1 * w + i0], e = d[j1 * w + i1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  }
}

// ---- Felzenszwalb 1D/2D 정확 유클리드 거리변환 ----
const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** mask[i]가 참인 셀까지의 거리(셀 단위). */
export function edt(maskFn, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = maskFn(i) ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

// ---- 최소 힙 (typed) ----
export class MinHeap {
  constructor(cap = 1024) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2);
      k2.set(this.k);
      const v2 = new Int32Array(this.v.length * 2);
      v2.set(this.v);
      this.k = k2;
      this.v = v2;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = key;
    V[i] = val;
  }
  pop() {
    // returns val; key in this.lastKey
    const K = this.k, V = this.v;
    const topV = V[0];
    this.lastKey = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c];
        V[i] = V[c];
        i = c;
      }
      K[i] = key;
      V[i] = val;
    }
    return topV;
  }
}

const D8 = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * 8방향 다익스트라. cost[i] <= 0 이면 통행불가. 대각선은 양쪽 직교 이웃이 통행가능할 때만.
 * sources: 셀 인덱스 배열. 반환: {dist, prev}
 */
export function dijkstra(w, h, cost, sources, maxDist = Infinity, wantPrev = true, cellSize = 1, srcDist = null) {
  const dist = new Float32Array(w * h).fill(Infinity);
  const prev = wantPrev ? new Int32Array(w * h).fill(-1) : null;
  const heap = new MinHeap(4096);
  for (let s = 0; s < sources.length; s++) {
    const si = sources[s];
    if (si < 0 || cost[si] <= 0) continue;
    const d0 = Math.fround(srcDist ? srcDist[s] : 0);
    if (d0 < dist[si]) {
      dist[si] = d0;
      heap.push(d0, si);
    }
  }
  while (heap.n > 0) {
    const u = heap.pop();
    const du = heap.lastKey;
    if (du > dist[u]) continue;
    if (du > maxDist) break;
    const ux = u % w, uy = (u / w) | 0;
    const cu = cost[u];
    for (let k = 0; k < 8; k++) {
      const nx = ux + D8[k][0], ny = uy + D8[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const v = ny * w + nx;
      const cv = cost[v];
      if (cv <= 0) continue;
      if (k >= 4) {
        // 대각 이동은 직교 이웃 중 하나라도 열려 있으면 허용 (회전된 좁은 통로가 계단식으로 끊기지 않게)
        if (cost[uy * w + nx] <= 0 && cost[ny * w + ux] <= 0) continue;
      }
      // Float32 거리 배열과 비교하므로 반드시 fround (안 하면 반올림 오차로 재확장 폭발)
      const nd = Math.fround(du + 0.5 * (cu + cv) * D8[k][2] * cellSize);
      if (nd < dist[v]) {
        dist[v] = nd;
        if (prev) prev[v] = u;
        heap.push(nd, v);
      }
    }
  }
  return { dist, prev };
}

/** prev 배열을 따라 경로 복원 (target → source 방향을 뒤집어 반환) */
export function tracePath(prev, target) {
  const path = [];
  let c = target;
  let guard = 0;
  while (c >= 0 && guard++ < 1e6) {
    path.push(c);
    c = prev[c];
  }
  return path.reverse();
}

/** 4-연결 요소 라벨링. passFn(i) 참인 셀만. 반환 {labels(Int32,-1 없음), count, sizes} */
export function components(w, h, passFn) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const sizes = [];
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (labels[s] !== -1 || !passFn(s)) continue;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = count;
    let size = 0;
    while (sp > 0) {
      const c = stack[--sp];
      size++;
      const x = c % w, y = (c / w) | 0;
      if (x > 0) { const n = c - 1; if (labels[n] === -1 && passFn(n)) { labels[n] = count; stack[sp++] = n; } }
      if (x < w - 1) { const n = c + 1; if (labels[n] === -1 && passFn(n)) { labels[n] = count; stack[sp++] = n; } }
      if (y > 0) { const n = c - w; if (labels[n] === -1 && passFn(n)) { labels[n] = count; stack[sp++] = n; } }
      if (y < h - 1) { const n = c + w; if (labels[n] === -1 && passFn(n)) { labels[n] = count; stack[sp++] = n; } }
    }
    sizes.push(size);
    count++;
  }
  return { labels, count, sizes };
}

/** 2D 점 공간 해시 */
export class PointHash {
  constructor(bucket = 16) {
    this.b = bucket;
    this.map = new Map();
  }
  key(x, z) {
    return ((Math.floor(x / this.b) + 4096) << 13) | (Math.floor(z / this.b) + 4096);
  }
  add(x, z, item) {
    const k = this.key(x, z);
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    arr.push(item);
  }
  // fn(item) 반환 true면 조기 종료
  query(x, z, r, fn) {
    const b = this.b;
    const i0 = Math.floor((x - r) / b), i1 = Math.floor((x + r) / b);
    const j0 = Math.floor((z - r) / b), j1 = Math.floor((z + r) / b);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.map.get(((i + 4096) << 13) | (j + 4096));
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) if (fn(arr[n])) return true;
      }
    }
    return false;
  }
}

// ---- 기하 ----
export function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qz = az + t * dz - pz;
  return qx * qx + qz * qz;
}

export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  const u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + t * r1, z: az + t * r2, t, u };
}

/** OBB: {x,z,w,d,rot}  (w: 로컬 u축 길이, d: 로컬 v축 길이, rot: u축의 월드 각도) */
export function obbCorners(o) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const hw = o.w / 2, hd = o.d / 2;
  const pts = [];
  for (const [a, b] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    pts.push([o.x + a * c - b * s, o.z + a * s + b * c]);
  }
  return pts;
}

export function pointInOBB(px, pz, o, pad = 0) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const dx = px - o.x, dz = pz - o.z;
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return Math.abs(u) <= o.w / 2 + pad && Math.abs(v) <= o.d / 2 + pad;
}

/** 두 OBB(볼록 사각형) 사이 최소 거리 (겹치면 0) */
export function obbDistance(a, b) {
  const A = obbCorners(a), B = obbCorners(b);
  if (polysOverlap(A, B)) return 0;
  let m = Infinity;
  for (let i = 0; i < 4; i++) {
    const [px, pz] = A[i];
    for (let j = 0; j < 4; j++) {
      const q0 = B[j], q1 = B[(j + 1) & 3];
      m = Math.min(m, segDist2(px, pz, q0[0], q0[1], q1[0], q1[1]));
    }
    const [qx, qz] = B[i];
    for (let j = 0; j < 4; j++) {
      const p0 = A[j], p1 = A[(j + 1) & 3];
      m = Math.min(m, segDist2(qx, qz, p0[0], p0[1], p1[0], p1[1]));
    }
  }
  return Math.sqrt(m);
}

function polysOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p0 = P[i], p1 = P[(i + 1) % P.length];
      const nx = -(p1[1] - p0[1]), nz = p1[0] - p0[0];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const q of A) { const d = q[0] * nx + q[1] * nz; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const q of B) { const d = q[0] * nx + q[1] * nz; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax < bmin || bmax < amin) return false;
    }
  }
  return true;
}

export function obbOverlap(a, b, pad = 0) {
  const A = obbCorners({ ...a, w: a.w + pad * 2, d: a.d + pad * 2 });
  const B = obbCorners(b);
  return polysOverlap(A, B);
}

/** 셀 중심이 OBB 안에 드는 셀들을 순회 (grid 좌표) */
export function forEachCellInOBB(grid, o, fn, pad = 0) {
  const r = Math.sqrt(o.w * o.w + o.d * o.d) / 2 + pad;
  const i0 = Math.max(0, grid.ci(o.x - r)), i1 = Math.min(grid.w - 1, grid.ci(o.x + r));
  const j0 = Math.max(0, grid.cj(o.z - r)), j1 = Math.min(grid.h - 1, grid.cj(o.z + r));
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const hw = o.w / 2 + pad, hd = o.d / 2 + pad;
  for (let j = j0; j <= j1; j++) {
    const z = grid.cz(j) - o.z;
    for (let i = i0; i <= i1; i++) {
      const x = grid.cx(i) - o.x;
      const u = x * c + z * s, v = -x * s + z * c;
      if (u >= -hw && u <= hw && v >= -hd && v <= hd) fn(j * grid.w + i, i, j);
    }
  }
}

export function angleWrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
