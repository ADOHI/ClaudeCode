// 도시 골격 계획 (Structure Plan, C§6 A3 · C§7 B1)
// 학원 정문 → 환상대로(정문 앞 36m 접합점을 꿰는 순환로) → 스파이어에서 목적지로 끝나는 방사대로 →
// 역(환상선 정차) → 역전·정문·코어 광장 → 구역 관계 그래프 → 관계형 페르소나 이름.
// 이후의 모든 단계(가로망, 거리 성격, 이음매, 높이, 소품, 이름)는 이 골격을 읽는다.
// 실패하면 ctx.plan = null → 모든 소비자가 레거시 경로를 탄다.
import {
  TERRAIN, ZONE, WORLD, PLAN, RELATION_KINDS, RELATION_RULES, RELATION_STORY, RIVALS, SHORT,
} from './config.js';
import { dijkstra, tracePath, edt, PointHash, angleWrap } from './grid.js';
import { snap } from './analysis.js';
import { placementStats } from './districts.js';

const H = WORLD.half, N = WORLD.size;
const S4 = 4, n4 = N / S4;
const D2R = Math.PI / 180;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---- 폴리라인 헬퍼 ----
/** Chaikin 모서리 깎기. 열린 선은 끝점 유지. 점 속성(bridge 등)은 버린다. */
export function chaikin(pts, iters = 1, closed = false) {
  let P = pts.map((p) => ({ x: p.x, z: p.z }));
  for (let it = 0; it < iters; it++) {
    if (P.length < 3) return P;
    const Q = [];
    const n = P.length;
    if (!closed) Q.push(P[0]);
    const segs = closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = P[k], b = P[(k + 1) % n];
      Q.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z });
      Q.push({ x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
    }
    if (!closed) Q.push(P[n - 1]);
    P = Q;
  }
  return P;
}

/** 호 길이 균등 재표본. 열린 선은 양 끝점을 포함한다. */
export function resample(pts, step, closed = false) {
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, z: p.z }));
  const P = closed ? pts.concat([pts[0]]) : pts;
  const out = [{ x: P[0].x, z: P[0].z }];
  let carry = 0;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L <= 0) continue;
    let s = step - carry;
    while (s <= L) {
      const t = s / L;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      s += step;
    }
    carry = L - (s - step);
  }
  const last = P[P.length - 1], tail = out[out.length - 1];
  if (closed) {
    if (Math.hypot(last.x - tail.x, last.z - tail.z) < step * 0.5 && out.length > 2) out.pop();
  } else if (Math.hypot(last.x - tail.x, last.z - tail.z) > step * 0.25) out.push({ x: last.x, z: last.z });
  else { tail.x = last.x; tail.z = last.z; }
  return out;
}

/** Douglas–Peucker 단순화 (열린 선) */
export function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz;
    let best = -1, bd = eps * eps;
    for (let k = a + 1; k < b; k++) {
      const p = pts[k];
      let t = L2 > 0 ? ((p.x - A.x) * dx + (p.z - A.z) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = A.x + dx * t - p.x, qz = A.z + dz * t - p.z;
      const d2 = qx * qx + qz * qz;
      if (d2 > bd) { bd = d2; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let k = 0; k < pts.length; k++) if (keep[k]) out.push(pts[k]);
  return out;
}

export function polyLen(pts, closed = false) {
  let L = 0;
  for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
  if (closed && pts.length > 1) L += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z);
  return L;
}

export const cellAt = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
const cell4 = (x, z) => {
  const i = Math.floor((x + H) / S4), j = Math.floor((z + H) / S4);
  return i < 0 || j < 0 || i >= n4 || j >= n4 ? -1 : j * n4 + i;
};
const c4x = (k) => (k % n4) * S4 + S4 / 2 - H;
const c4z = (k) => ((k / n4) | 0) * S4 + S4 / 2 - H;
const pathLen4 = (path) => {
  let L = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    L += (a % n4 !== b % n4 && ((a / n4) | 0) !== ((b / n4) | 0) ? Math.SQRT2 : 1) * S4;
  }
  return L;
};
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
};
const dirName = (x, z) => {
  const a = Math.atan2(z, x);
  return Math.abs(a) < Math.PI / 4 ? '동' : Math.abs(a) > (3 * Math.PI) / 4 ? '서' : a > 0 ? '남' : '북';
};
function nearestOnPoly(pts, x, z, closed = false) {
  let best = null, bd = Infinity;
  const segs = closed ? pts.length : pts.length - 1;
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + dx * t, qz = a.z + dz * t;
    const d = (qx - x) ** 2 + (qz - z) ** 2;
    if (d < bd) { bd = d; best = { x: qx, z: qz, k, t, d: Math.sqrt(d) }; }
  }
  return best;
}

// ======================================================================
// 1) 학원 정문 (genRoads 진입대로의 광선 탐색을 그대로 옮긴 것)
// ======================================================================
export function computeGates(ctx) {
  const Z = ctx.zone.data;
  ctx.gates = [];
  for (const d of ctx.districts) {
    if (!d.def.campus || !d.core) continue;
    const ang = Math.atan2(-d.core.cz, -d.core.cx);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    let x = d.core.cx, z = d.core.cz;
    let inside = false;
    for (let s = 0; s < 400; s++) {
      const id = cellAt(x, z);
      if (id < 0) break;
      if (Z[id] === ZONE.CAMPUS && ctx.zoneOwner[id] === d.id) inside = true;
      else if (inside) break;
      x += ux; z += uz;
    }
    const gate = { x, z, dir: [ux, uz], district: d.id, kind: 'main' };
    ctx.gates.push(gate);
    d.gate = gate;
  }
  return ctx.gates;
}

// ======================================================================
// 2) 계획 비용 (4m): 바다·해안 20m·캠퍼스·공원·중심 70m 차단, 물 5, 내측 연성대 3
// ======================================================================
export function planCost4(ctx) {
  const P = PLAN.ring;
  const T = ctx.terrain.data, Z = ctx.zone.data;
  const cost = new Float32Array(n4 * n4);
  for (let j = 0; j < n4; j++) {
    for (let i = 0; i < n4; i++) {
      const id = (j * S4 + 2) * N + i * S4 + 2;
      const x = i * S4 + 2.5 - H, z = j * S4 + 2.5 - H;
      const r = Math.hypot(x, z);
      const t = T[id];
      let c;
      if (t === TERRAIN.SEA || ctx.distSea[id] < P.seaMargin || Z[id] === ZONE.CAMPUS || Z[id] === ZONE.PARK || r < 70) c = 0;
      else if (t !== TERRAIN.LAND) c = P.riverCost;
      else if (r < P.innerSoftR) c = P.innerSoftMul;
      else c = 1;
      cost[j * n4 + i] = c;
    }
  }
  return cost;
}

/** 4m 셀 중 통행 가능한(가능하면 육지) 가장 가까운 셀 */
function snapPassable(cost, x, z, maxR, preferLand = true) {
  const i0 = Math.floor((x + H) / S4), j0 = Math.floor((z + H) / S4);
  for (const landOnly of preferLand ? [true, false] : [false]) {
    let best = -1, bd = Infinity;
    const R = Math.ceil(maxR / S4);
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= n4 || j >= n4) continue;
        const c = cost[j * n4 + i];
        if (c <= 0 || (landOnly && c >= PLAN.ring.riverCost)) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = j * n4 + i; }
      }
    }
    if (best >= 0 && Math.sqrt(bd) * S4 <= maxR + 2) return best;
  }
  return -1;
}

// ======================================================================
// 3) 환상대로: 정문 접합점 J_g 경유, 각도 창 + 반경 편차 벌점 상한 + 경유점 탈락 재시도
// ======================================================================
function traceRing(ctx, cost4, gates) {
  const P = PLAN.ring;
  const T = ctx.terrain.data;
  const rr = new Float32Array(n4 * n4), th = new Float32Array(n4 * n4);
  for (let k = 0; k < n4 * n4; k++) { const x = c4x(k), z = c4z(k); rr[k] = Math.hypot(x, z); th[k] = Math.atan2(z, x); }
  // 정문 접합점
  const J = [];
  for (const g of gates) {
    let x = g.x + g.dir[0] * P.gateJunction, z = g.z + g.dir[1] * P.gateJunction;
    let k = cell4(x, z);
    if (k < 0 || cost4[k] <= 0 || cost4[k] >= P.riverCost) {
      const s = snapPassable(cost4, x, z, 40);
      if (s < 0) continue;
      k = s; x = c4x(s); z = c4z(s);
    }
    J.push({ x, z, k, r: Math.hypot(x, z), th: Math.atan2(z, x), gate: g.district });
  }
  if (J.length < 2) return null;
  const Rr = Math.max(P.rMin, Math.min(P.rMax, median(gates.map((g) => Math.hypot(g.x, g.z))) + P.rAdd));
  const sig = P.sigmaDeg * D2R;
  const rStar = (a) => {
    let r = Rr;
    for (const j of J) { const d = angleWrap(a - j.th); r += Math.exp(-0.5 * (d / sig) ** 2) * (j.r - Rr); }
    return r;
  };
  // 반경 편차 벌점 (상한 devCap)
  const ringCost = new Float32Array(n4 * n4);
  for (let k = 0; k < n4 * n4; k++) {
    const c = cost4[k];
    if (c <= 0) continue;
    const dv = (rr[k] - rStar(th[k])) / P.devScale;
    ringCost[k] = c * (1 + Math.min(P.devCap, P.devW * dv * dv));
  }
  // 경유점: 정문 접합점(각도순) + 70° 넘는 간극의 중간점 (광선을 따라 ±110m 스냅, 안쪽 우선)
  J.sort((a, b) => a.th - b.th);
  const wps = [];
  for (let q = 0; q < J.length; q++) {
    const a = J[q], b = J[(q + 1) % J.length];
    wps.push({ x: a.x, z: a.z, k: a.k, th: a.th, gate: a.gate });
    let gap = b.th - a.th;
    if (gap <= 0) gap += 2 * Math.PI;
    const m = Math.ceil(gap / (P.maxGapDeg * D2R)) - 1;
    for (let s = 1; s <= m; s++) {
      const t = a.th + (gap * s) / (m + 1);
      const r0 = rStar(t), ux = Math.cos(t), uz = Math.sin(t);
      let found = -1;
      for (const landOnly of [true, false]) {
        for (let d = 0; d <= P.snapRange && found < 0; d += 2) {
          for (const sg of [-1, 1]) {
            const k = cell4(ux * (r0 + sg * d), uz * (r0 + sg * d));
            if (k >= 0 && cost4[k] > 0 && (!landOnly || cost4[k] < P.riverCost)) { found = k; break; }
            if (d === 0) break;
          }
        }
        if (found >= 0) break;
      }
      if (found >= 0) wps.push({ x: c4x(found), z: c4z(found), k: found, th: Math.atan2(c4z(found), c4x(found)), gate: null });
    }
  }
  // 구간 추적
  const legCost = new Float32Array(n4 * n4);
  const runLeg = (a, b) => {
    let gap = b.th - a.th;
    if (gap <= 0) gap += 2 * Math.PI;
    const mid = a.th + gap / 2, half = gap / 2 + P.windowDeg * D2R;
    legCost.fill(0);
    for (let k = 0; k < n4 * n4; k++) if (ringCost[k] > 0 && Math.abs(angleWrap(th[k] - mid)) <= half) legCost[k] = ringCost[k];
    if (legCost[a.k] <= 0 || legCost[b.k] <= 0) return null;
    const { dist, prev } = dijkstra(n4, n4, legCost, [a.k], Infinity, true, S4);
    if (!isFinite(dist[b.k])) return null;
    const path = tracePath(prev, b.k);
    const L = pathLen4(path), eu = Math.hypot(b.x - a.x, b.z - a.z);
    if (eu > 1 && L / eu > P.legMaxRatio) return null;
    return { path, L };
  };
  const legs = [];
  let allOk = true;
  for (let i = 0; i < wps.length; i++) {
    let bi = (i + 1) % wps.length;
    let res = runLeg(wps[i], wps[bi]);
    if (!res && !wps[bi].gate && wps.length > 3) {
      wps.splice(bi, 1);
      if (bi < i) i--;
      bi = (i + 1) % wps.length;
      res = runLeg(wps[i], wps[bi]);
    }
    legs.push(res ? { ok: true, path: res.path, a: i } : { ok: false, a: i });
    if (!res) allOk = false;
  }
  // 성공 구간을 이어 호(arc)로
  const arcs = [];
  if (allOk) arcs.push(legs);
  else {
    const first = legs.findIndex((l) => !l.ok);
    let cur = [];
    for (let q = 1; q <= legs.length; q++) {
      const l = legs[(first + q) % legs.length];
      if (l.ok) cur.push(l);
      else { if (cur.length) arcs.push(cur); cur = []; }
    }
    if (cur.length) arcs.push(cur);
  }
  if (!arcs.length) return null;
  const toPts = (arc) => {
    const out = [];
    for (const l of arc) {
      for (let q = out.length ? 1 : 0; q < l.path.length; q++) out.push({ x: c4x(l.path[q]), z: c4z(l.path[q]) });
    }
    return out;
  };
  let bestArc = arcs[0];
  for (const a of arcs) if (a.length > bestArc.length) bestArc = a;
  const closed = allOk;
  let raw = toPts(bestArc);
  if (closed && raw.length > 2) raw.pop(); // 시작점 중복 제거
  const dp = douglasPeucker(closed ? raw.concat([raw[0]]) : raw, 4);
  if (closed) dp.pop();
  let pts = resample(chaikin(dp, 3, closed), 3, closed);
  // 정문 접합점을 정확히 지나도록 국소 보정 (가우시안 ±30m)
  for (const j of J) {
    let bk = -1, bd = Infinity;
    for (let k = 0; k < pts.length; k++) { const d = (pts[k].x - j.x) ** 2 + (pts[k].z - j.z) ** 2; if (d < bd) { bd = d; bk = k; } }
    if (bk < 0 || bd > 30 * 30) continue;
    const dx = j.x - pts[bk].x, dz = j.z - pts[bk].z;
    for (let o = -10; o <= 10; o++) {
      let k = bk + o;
      if (closed) k = (k + pts.length) % pts.length;
      else if (k < 0 || k >= pts.length) continue;
      const w = Math.exp(-0.5 * ((o * 3) / 12) ** 2);
      pts[k].x += dx * w; pts[k].z += dz * w;
    }
    j.idx = bk;
  }
  // 평활화가 차단 셀에 떨어지면 DP 폴리라인으로 되돌린다
  for (const p of pts) {
    const k = cell4(p.x, p.z);
    if (k >= 0 && cost4[k] > 0) continue;
    const q = nearestOnPoly(dp, p.x, p.z, closed);
    if (q) { p.x = q.x; p.z = q.z; }
  }
  for (const p of pts) { const id = cellAt(p.x, p.z); if (id >= 0 && T[id] !== TERRAIN.LAND) p.bridge = true; }
  let cov = 0;
  const segs = closed ? pts.length : pts.length - 1;
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    cov += Math.abs(angleWrap(Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x)));
  }
  const coverageDeg = Math.round(cov / D2R);
  const len = polyLen(pts, closed);
  const isClosed = closed && coverageDeg >= 330 && coverageDeg <= 450;
  const cum = new Float32Array(pts.length);
  for (let k = 1; k < pts.length; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
  return {
    pts, closed: isClosed, coverageDeg, len: Math.round(len), Rr: Math.round(Rr), lineId: -1,
    junctions: J.map((j) => ({ x: j.x, z: j.z, gate: j.gate, idx: j.idx ?? -1 })),
    legsOk: legs.filter((l) => l.ok).length, legs: legs.length, cum, rStar,
    extraArcs: arcs.filter((a) => a !== bestArc).map((a) => resample(chaikin(douglasPeucker(toPts(a), 4), 3), 3)),
  };
}

/** 링 위 호 길이 거리 */
function arcDist(ring, i, j) {
  const d = Math.abs(ring.cum[i] - ring.cum[j]);
  return ring.closed ? Math.min(d, ring.len - d) : d;
}
function nearestRingIdx(ring, x, z) {
  let bk = 0, bd = Infinity;
  for (let k = 0; k < ring.pts.length; k++) { const d = (ring.pts[k].x - x) ** 2 + (ring.pts[k].z - z) ** 2; if (d < bd) { bd = d; bk = k; } }
  return bk;
}
function ringTangent(ring, k) {
  const P = ring.pts, n = P.length;
  const a = P[ring.closed ? (k - 2 + n) % n : Math.max(0, k - 2)], b = P[ring.closed ? (k + 2) % n : Math.min(n - 1, k + 2)];
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}

// ======================================================================
// 4) 공원 입구
// ======================================================================
function planParkGates(ctx, cores) {
  const Z = ctx.zone.data, T = ctx.terrain.data;
  const park = ctx.districts.find((d) => d.def.park);
  if (!park) return [];
  const cand = [];
  const isPark = (i, j) => i >= 0 && j >= 0 && i < n4 && j < n4 && Z[(j * S4 + 2) * N + i * S4 + 2] === ZONE.PARK;
  const isCity = (i, j) => {
    if (i < 0 || j < 0 || i >= n4 || j >= n4) return false;
    const id = (j * S4 + 2) * N + i * S4 + 2;
    return Z[id] === ZONE.CITY && T[id] === TERRAIN.LAND && ctx.distSea[id] > 8;
  };
  for (let j = 0; j < n4; j++) {
    for (let i = 0; i < n4; i++) {
      if (!isPark(i, j)) continue;
      if (isCity(i + 1, j) || isCity(i - 1, j) || isCity(i, j + 1) || isCity(i, j - 1)) cand.push({ x: i * S4 + 2.5 - H, z: j * S4 + 2.5 - H });
    }
  }
  if (!cand.length) return [];
  const nearest = (x, z) => { let b = null, bd = Infinity; for (const c of cand) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; b = c; } } return { p: b, d: bd }; };
  const picks = [];
  picks.push({ ...nearest(0, 0).p, why: '중심' });
  for (const c of cores) { const r = nearest(c.x, c.z); if (r.d <= 400) picks.push({ ...r.p, why: c.district }); }
  if (ctx.history && ctx.history.parkEntry) picks.push({ x: ctx.history.parkEntry.x, z: ctx.history.parkEntry.z, why: '참배길' });
  const out = [];
  for (const p of picks) {
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 70)) continue;
    out.push({ x: p.x, z: p.z });
    if (out.length >= 4) break;
  }
  return out;
}

// ======================================================================
// 5) 방사대로: 목적지 → 각도 군집 → 줄기(trunk, 스파이어→링) + 가지(branch, 링→목적지 광장)
// ======================================================================
function coreOf(ctx, d) {
  const T = ctx.terrain.data, Z = ctx.zone.data;
  const ok = (x, z) => {
    const id = cellAt(x, z);
    return id >= 0 && T[id] === TERRAIN.LAND && Z[id] === ZONE.CITY && ctx.distSea[id] >= 20 && ctx.distRiver[id] >= 15;
  };
  if (ok(d.x, d.z)) return { x: d.x, z: d.z };
  for (let r = 2; r <= 120; r += 2) {
    for (let a = 0; a < 24; a++) {
      const x = d.x + Math.cos((a / 24) * 2 * Math.PI) * r, z = d.z + Math.sin((a / 24) * 2 * Math.PI) * r;
      if (ok(x, z)) return { x, z };
    }
  }
  return { x: d.x, z: d.z };
}

function straightOk(ctx, cost4, ax, az, bx, bz) {
  const T = ctx.terrain.data;
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(L / 3));
  let runs = 0, run = 0, maxRun = 0;
  const pts = [];
  for (let s = 0; s <= n; s++) {
    const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n;
    const k = cell4(x, z);
    if (Math.hypot(x, z) >= 70 && (k < 0 || cost4[k] <= 0)) return null;
    const id = cellAt(x, z);
    const wet = id >= 0 && T[id] !== TERRAIN.LAND;
    if (wet) { if (!run) runs++; run += L / n; maxRun = Math.max(maxRun, run); } else run = 0;
    pts.push(wet ? { x, z, bridge: true } : { x, z });
  }
  if (runs > 1 || maxRun > PLAN.radials.maxRiverCross) return null;
  return pts;
}

function routeCells(cost4, fromK, toK) {
  if (fromK < 0 || toK < 0 || cost4[fromK] <= 0 || cost4[toK] <= 0) return null;
  const { dist, prev } = dijkstra(n4, n4, cost4, [fromK], Infinity, true, S4);
  if (!isFinite(dist[toK])) return null;
  return tracePath(prev, toK).map((k) => ({ x: c4x(k), z: c4z(k) }));
}

function markBridges(ctx, pts) {
  const T = ctx.terrain.data;
  for (const p of pts) { const id = cellAt(p.x, p.z); if (id >= 0 && T[id] !== TERRAIN.LAND) p.bridge = true; else delete p.bridge; }
  return pts;
}

function traceRadials(ctx, cost4, ring, gates, parkGates) {
  const P = PLAN.radials;
  const dests = [];
  const J = ring.junctions;
  for (const j of J) dests.push({ id: dests.length, kind: 'gate', district: j.gate, x: j.x, z: j.z, w: 2.5 });
  const cores = [];
  for (const d of ctx.districts) {
    const w = { commercial: 3, residential: 2, harbor: 1.5, ruins: 1 }[d.type];
    if (!w) continue;
    const c = coreOf(ctx, d);
    d.corePt = c;
    cores.push({ district: d.id, x: c.x, z: c.z });
    dests.push({ id: dests.length, kind: 'core', district: d.id, x: c.x, z: c.z, w });
  }
  const park = ctx.districts.find((d) => d.def.park);
  for (const g of parkGates) dests.push({ id: dests.length, kind: 'parkGate', district: park ? park.id : -1, x: g.x, z: g.z, w: 1 });
  for (const d of dests) d.th = Math.atan2(d.z, d.x);

  // 각도 군집 (정문 둘은 합치지 않는다)
  let clusters = dests.map((d) => ({ dests: [d], th: d.th, w: d.w, gate: d.kind === 'gate' ? d : null }));
  const mergeTh = P.mergeDeg * D2R;
  for (;;) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[i].gate && clusters[j].gate) continue;
        const d = Math.abs(angleWrap(clusters[i].th - clusters[j].th));
        if (d < mergeTh && d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    const A = clusters[bi], B = clusters[bj];
    const ds = A.dests.concat(B.dests);
    const gate = A.gate || B.gate;
    let thm;
    if (gate) thm = gate.th;
    else {
      let sx = 0, sz = 0;
      for (const d of ds) { sx += d.w * Math.cos(d.th); sz += d.w * Math.sin(d.th); }
      thm = Math.atan2(sz, sx);
    }
    clusters.splice(bj, 1);
    clusters[bi] = { dests: ds, th: thm, w: A.w + B.w, gate };
  }
  clusters.sort((a, b) => b.w - a.w || a.th - b.th);
  const kept = [];
  for (const c of clusters) {
    if (kept.length >= P.max) break;
    if (kept.some((k) => Math.abs(angleWrap(k.th - c.th)) < P.mouthGapDeg * D2R)) continue;
    kept.push(c);
  }
  const keptSet = new Set(kept);
  kept.sort((a, b) => a.th - b.th);

  const radials = [];
  // 줄기
  for (const c of kept) {
    const ax = Math.cos(c.th) * P.mouthR, az = Math.sin(c.th) * P.mouthR;
    let end, ringIdx;
    if (c.gate) {
      end = { x: c.gate.x, z: c.gate.z };
      ringIdx = nearestRingIdx(ring, end.x, end.z);
    } else {
      let bk = 0, bd = Infinity;
      for (let k = 0; k < ring.pts.length; k++) {
        const d = Math.abs(angleWrap(Math.atan2(ring.pts[k].z, ring.pts[k].x) - c.th));
        if (d < bd) { bd = d; bk = k; }
      }
      ringIdx = bk;
      end = { x: ring.pts[bk].x, z: ring.pts[bk].z };
      if (bd > 15 * D2R) continue; // 링이 이 방향을 덮지 않음 (열린 링)
    }
    let pts = straightOk(ctx, cost4, ax, az, end.x, end.z);
    let straight = !!pts;
    if (!pts) {
      const r0 = 74, sx = Math.cos(c.th) * r0, sz = Math.sin(c.th) * r0;
      let sk = cell4(sx, sz);
      if (sk < 0 || cost4[sk] <= 0) sk = snapPassable(cost4, sx, sz, 16, false);
      let ek = cell4(end.x, end.z);
      if (ek < 0 || cost4[ek] <= 0) ek = snapPassable(cost4, end.x, end.z, 16, false);
      const cells = routeCells(cost4, sk, ek);
      if (!cells) continue;
      pts = resample(chaikin([{ x: ax, z: az }].concat(cells, [end]), 2), 3);
      markBridges(ctx, pts);
    }
    const primary = c.gate || c.dests.slice().sort((a, b) => b.w - a.w)[0];
    radials.push({
      id: radials.length, kind: 'trunk', pts, angle: c.th, dests: c.dests.map((d) => d.id), district: primary.district,
      trunkEnd: { x: end.x, z: end.z, ringIdx }, weight: c.w, straight, gate: c.gate ? c.gate.district : undefined,
      approach: c.gate ? c.gate.district : undefined, rel: null, lineId: -1,
    });
    c.trunk = radials[radials.length - 1];
  }
  // 가지: 군집의 비정문 목적지 → 골격(줄기·링)에서 광장 가장자리까지
  const ringCells = new Set();
  for (const p of ring.pts) { const k = cell4(p.x, p.z); if (k >= 0) ringCells.add(k); }
  const branchTo = (dest, srcCells, maxLen, trunk) => {
    let dk = cell4(dest.x, dest.z);
    if (dk < 0 || cost4[dk] <= 0) dk = snapPassable(cost4, dest.x, dest.z, 16, false);
    if (dk < 0) return null;
    const { dist, prev } = dijkstra(n4, n4, cost4, [dk], maxLen * 3.2, true, S4);
    let bk = -1, bd = Infinity;
    for (const k of srcCells) if (dist[k] < bd) { bd = dist[k]; bk = k; }
    if (bk < 0 || !isFinite(bd)) return null;
    const path = tracePath(prev, bk).reverse(); // 골격 → 목적지
    const L = pathLen4(path);
    if (L > maxLen) return null;
    const sqR = dest.kind === 'core' ? PLAN.squares.core : 0;
    let pts = path.map((k) => ({ x: c4x(k), z: c4z(k) }));
    pts[pts.length - 1] = { x: dest.x, z: dest.z };
    pts = resample(chaikin(pts, 2), 3);
    if (sqR > 0) {
      let cut = pts.length;
      for (let q = 0; q < pts.length; q++) if (Math.hypot(pts[q].x - dest.x, pts[q].z - dest.z) <= sqR) { cut = q + 1; break; }
      pts = pts.slice(0, cut);
    }
    if (polyLen(pts) < 20) return { served: true };
    markBridges(ctx, pts);
    return { pts, L, trunk };
  };
  for (const c of kept) {
    if (!c.trunk) continue;
    const src = new Set(ringCells);
    for (const p of c.trunk.pts) { const k = cell4(p.x, p.z); if (k >= 0) src.add(k); }
    for (const d of c.dests) {
      if (d.kind === 'gate') continue;
      const nt = nearestOnPoly(c.trunk.pts, d.x, d.z);
      if (nt && nt.d <= (d.kind === 'core' ? PLAN.squares.core + 14 : 14)) { d.servedBy = c.trunk.id; continue; }
      const b = branchTo(d, src, 520, c.trunk);
      if (!b) continue;
      if (b.served) { d.servedBy = c.trunk.id; continue; }
      radials.push({ id: radials.length, kind: 'branch', pts: b.pts, angle: c.th, dests: [d.id], district: d.district, trunk: c.trunk.id, dest: d.id, weight: d.w, rel: null, lineId: -1 });
      d.servedBy = radials.length - 1;
    }
  }
  for (const c of clusters) {
    if (keptSet.has(c)) continue;
    for (const d of c.dests) {
      if (d.kind === 'gate') continue;
      const b = branchTo(d, ringCells, 220, null);
      if (!b) continue;
      if (b.served) { d.servedBy = -1; continue; }
      radials.push({ id: radials.length, kind: 'branch', pts: b.pts, angle: d.th, dests: [d.id], district: d.district, trunk: -1, dest: d.id, weight: d.w, rel: null, lineId: -1 });
      d.servedBy = radials.length - 1;
    }
  }
  return { dests, radials, clusters: kept, cores };
}

// ======================================================================
// 6) 골격 거리장: distSpine (1m EDT), spineHash (3m 표본 + 접선각), distPark4 (4m EDT, m)
// ======================================================================
function spineFields(ctx, ring, radials) {
  const mask = new Uint8Array(N * N);
  const spineHash = new PointHash(16);
  const lines = [{ pts: ring.pts, closed: ring.closed }, ...ring.extraArcs.map((p) => ({ pts: p, closed: false })), ...radials.map((r) => ({ pts: r.pts, closed: false }))];
  for (const { pts, closed } of lines) {
    const segs = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < segs; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const t = Math.atan2(b.z - a.z, b.x - a.x);
      const steps = Math.max(1, Math.ceil(L));
      for (let s = 0; s < steps; s++) {
        const id = cellAt(a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps);
        if (id >= 0) mask[id] = 1;
      }
      spineHash.add(a.x, a.z, { x: a.x, z: a.z, t });
    }
  }
  const distSpine = edt((i) => mask[i] === 1, N, N);
  const Z = ctx.zone.data;
  const d4 = edt((k) => Z[(((k / n4) | 0) * S4 + 2) * N + (k % n4) * S4 + 2] === ZONE.PARK, n4, n4);
  for (let k = 0; k < d4.length; k++) d4[k] *= S4;
  return { distSpine, spineHash, distPark4: d4 };
}

// ======================================================================
// 7) 역: 줄기∩링(a) + 정문 ±150m 호(b) → 탐욕 선택 → 정문 커버리지 보정 → 센트럴역(지선)
// ======================================================================
function pickStations(ctx, ring, clusters, radials) {
  const P = PLAN.stations;
  const D = ctx.district.data;
  const cand = [];
  const gateIdx = ring.junctions.filter((j) => j.idx >= 0);
  const typeAt = (x, z) => { const id = cellAt(x, z); const d = id >= 0 ? D[id] : 255; return d === 255 ? null : ctx.districts[d]; };
  for (const c of clusters) {
    if (c.gate || !c.trunk) continue;
    const k = c.trunk.trunkEnd.ringIdx;
    cand.push({ idx: k, score: c.w, kind: 'a', serves: [...new Set(c.dests.map((d) => d.district))], dests: c.dests, radial: c.trunk.id });
  }
  for (const j of gateIdx) {
    for (const sg of [-1, 1]) {
      // 호 길이로 ±150m 지점
      let k = j.idx, acc = 0;
      const n = ring.pts.length;
      for (let s = 0; s < n && acc < P.gateArcPick; s++) {
        const k2 = ring.closed ? (k + sg + n) % n : k + sg;
        if (k2 < 0 || k2 >= n) break;
        acc += Math.hypot(ring.pts[k2].x - ring.pts[k].x, ring.pts[k2].z - ring.pts[k].z);
        k = k2;
      }
      if (acc < P.gateArcOk[0]) continue;
      const dd = typeAt(ring.pts[k].x, ring.pts[k].z);
      const score = 1.5 + (dd && ['commercial', 'residential', 'center'].includes(dd.type) ? 0.5 : 0);
      const serves = [j.gate];
      if (dd && dd.id !== j.gate) serves.push(dd.id);
      cand.push({ idx: k, score, kind: 'b', academy: j.gate, serves, dests: [{ district: j.gate, x: j.x, z: j.z, w: 2.5 }] });
    }
  }
  for (const c of cand) for (const j of gateIdx) if (arcDist(ring, c.idx, j.idx) < P.nearGatePenaltyArc) { c.score -= 2; break; }
  cand.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const picked = [];
  const spaced = (c, list) => list.every((p) => arcDist(ring, p.idx, c.idx) >= P.minArc);
  for (const c of cand) {
    if (picked.length >= P.max) break;
    if (spaced(c, picked)) picked.push(c);
  }
  // 정문 커버리지: 모든 학원은 정문에서 호 110–260m 안에 역이 있어야 한다
  const covers = (s, j) => { const a = arcDist(ring, s.idx, j.idx); return a >= P.gateArcOk[0] && a <= P.gateArcOk[1]; };
  for (const j of gateIdx) {
    if (picked.some((s) => covers(s, j))) continue;
    const opts = cand.filter((c) => c.kind === 'b' && c.academy === j.gate && covers(c, j)).sort((a, b) => b.score - a.score);
    if (!opts.length) continue;
    // 간격을 지키는 후보 우선, 없으면 가장 가까운 비정문 역을 대체
    let f = opts.find((c) => spaced(c, picked));
    if (!f) {
      f = opts[0];
      const clash = picked.filter((p) => arcDist(ring, p.idx, f.idx) < P.minArc && !gateIdx.some((g) => covers(p, g) && !picked.some((q) => q !== p && covers(q, g))));
      for (const c of clash) picked.splice(picked.indexOf(c), 1);
    }
    picked.push(f);
    while (picked.length > P.hardMax) {
      const nonGate = picked.filter((p) => !gateIdx.some((g) => covers(p, g))).sort((a, b) => a.score - b.score);
      if (!nonGate.length) break;
      picked.splice(picked.indexOf(nonGate[0]), 1);
    }
  }
  picked.sort((a, b) => ring.cum[a.idx] - ring.cum[b.idx]);
  const stations = [];
  for (const c of picked) {
    const p = ring.pts[c.idx];
    const [tx, tz] = ringTangent(ring, c.idx);
    let nx = -tz, nz = tx;
    if (nx * p.x + nz * p.z < 0) { nx = -nx; nz = -nz; } // 바깥쪽 법선
    const rs = Math.hypot(p.x, p.z);
    let wIn = 0, wOut = 0;
    for (const d of c.dests) (Math.hypot(d.x, d.z) < rs ? (wIn += d.w) : (wOut += d.w));
    let side = wIn > wOut ? -1 : 1;
    const viable = (sg) => squareArea(ctx, p.x + sg * nx * 35, p.z + sg * nz * 35, PLAN.squares.stationFront);
    if (viable(side) < 0.45 && viable(-side) > viable(side)) side = -side;
    const s = {
      id: stations.length, x: p.x, z: p.z, ringIdx: c.idx, arc: Math.round(ring.cum[c.idx]), tx, tz, n: [side * nx, side * nz],
      serves: c.serves, weight: +c.score.toFixed(2), kind: c.kind, front: null, back: null, name: '', short: '',
    };
    if (c.kind === 'b') s.academy = c.academy;
    if (c.radial !== undefined) s.radial = c.radial;
    stations.push(s);
  }
  // 센트럴역: 가장 무거운 줄기 위 r = 74
  const trunks = radials.filter((r) => r.kind === 'trunk');
  if (trunks.length) {
    const t = trunks.slice().sort((a, b) => b.weight - a.weight)[0];
    let q = t.pts[0];
    for (const p of t.pts) { q = p; if (Math.hypot(p.x, p.z) >= 74) break; }
    const k = t.pts.indexOf(q);
    const a = t.pts[Math.max(0, k - 1)], b = t.pts[Math.min(t.pts.length - 1, k + 1)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
    t.spur = true;
    t.median = PLAN.radials.spurMedian;
    stations.push({ id: stations.length, x: q.x, z: q.z, ringIdx: -1, tx, tz, n: [-tz, tx], serves: [0], weight: t.weight, kind: 'central', spur: true, radial: t.id, front: null, back: null, name: '센트럴역', short: '센트럴' });
  }
  return stations;
}

/** 원판 안 도시 땅 비율 (광장 입지 판정) */
function squareArea(ctx, x, z, r) {
  const T = ctx.terrain.data, Z = ctx.zone.data;
  let n = 0, ok = 0;
  for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (dx * dx + dz * dz > r * r) continue;
    n++;
    const id = cellAt(x + dx, z + dz);
    if (id >= 0 && T[id] === TERRAIN.LAND && Z[id] === ZONE.CITY) ok++;
  }
  return n ? ok / n : 0;
}

// ======================================================================
// 8) 광장: 역전(20m)·역 뒤(11m)·정문 앞(10m)·구역 코어(12m) — 도시 땅에만 ZONE.PLAZA
// ======================================================================
function placeSquares(ctx, plan) {
  const S = PLAN.squares;
  const D = ctx.district.data;
  const squares = [];
  const distAt = (x, z) => { const id = cellAt(x, z); const d = id >= 0 ? D[id] : 255; return d === 255 ? -1 : d; };
  const add = (sq) => { sq.id = squares.length; sq.rels = []; squares.push(sq); return sq; };
  for (const s of plan.stations) {
    if (s.spur) continue;
    const fx = s.x + s.n[0] * 35, fz = s.z + s.n[1] * 35;
    if (squareArea(ctx, fx, fz, S.stationFront) >= 0.3) s.front = add({ kind: 'stationFront', x: fx, z: fz, r: S.stationFront, district: distAt(fx, fz), station: s.id }).id;
    const bx = s.x - s.n[0] * 26, bz = s.z - s.n[1] * 26;
    if (squareArea(ctx, bx, bz, S.stationBack) >= 0.4) s.back = add({ kind: 'stationBack', x: bx, z: bz, r: S.stationBack, district: distAt(bx, bz), station: s.id }).id;
  }
  for (const g of plan.gates) {
    const x = g.x + g.dir[0] * S.gateOffset, z = g.z + g.dir[1] * S.gateOffset;
    const sq = add({ kind: 'gate', x, z, r: S.gate, district: distAt(x, z), gate: g.district });
    if (sq.district < 0) sq.district = g.district;
    ctx.districts[g.district].gateSquare = sq.id;
  }
  for (const c of plan.cores) {
    const sq = add({ kind: 'core', x: c.x, z: c.z, r: S.core, district: c.district });
    ctx.districts[c.district].coreSquare = sq.id;
  }
  return squares;
}

function stampSquares(ctx, plan) {
  const T = ctx.terrain.data, Z = ctx.zone.data;
  let cells = 0;
  for (const sq of plan.squares) {
    const r = sq.r;
    let n = 0;
    for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const x = Math.floor(sq.x + dx) + 0.5, z = Math.floor(sq.z + dz) + 0.5;
        if ((x - sq.x) ** 2 + (z - sq.z) ** 2 > r * r) continue;
        const id = cellAt(x, z);
        if (id < 0 || T[id] !== TERRAIN.LAND || Z[id] !== ZONE.CITY) continue;
        Z[id] = ZONE.PLAZA;
        n++;
      }
    }
    sq.cells = n;
    cells += n;
  }
  return cells;
}

// ======================================================================
// 9) 구역 관계 그래프
// ======================================================================
function borderCounts(ctx) {
  const D = ctx.district.data;
  const cnt = new Map();
  for (let j = 0; j < N - 2; j += 2) {
    for (let i = 0; i < N - 2; i += 2) {
      const a = D[j * N + i];
      if (a === 255) continue;
      for (const b of [D[j * N + i + 2], D[(j + 2) * N + i]]) {
        if (b === 255 || b === a) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        cnt.set(key, (cnt.get(key) || 0) + 1);
      }
    }
  }
  return cnt;
}

function buildRelations(ctx, plan) {
  const ds = ctx.districts;
  const edges = [];
  const has = (kind, a, b) => edges.find((e) => e.kind === kind && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
  const addEdge = (kind, a, b, w, extra = {}) => {
    if (a === b || a < 0 || b < 0) return null;
    const ex = has(kind, a, b);
    if (ex) { ex.w = Math.max(ex.w, w); return ex; }
    const e = { id: '', kind, a, b, w, name: '', story: '', realizedBy: [], ...extra };
    edges.push(e);
    return e;
  };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  for (const rule of RELATION_RULES) {
    const froms = [].concat(rule.from);
    for (const d of ds) {
      if (!froms.includes(d.type)) continue;
      const tos = ds.filter((o) => o.id !== d.id && rule.to.includes(o.type)).sort((a, b) => dist(d, a) - dist(d, b));
      for (const o of tos.slice(0, rule.pick)) addEdge(rule.kind, d.id, o.id, rule.w);
    }
  }
  for (const [ta, tb] of RIVALS) {
    const A = ds.find((d) => d.type === ta), B = ds.find((d) => d.type === tb);
    if (A && B) addEdge('rivalry', A.id, B.id, 0.8);
  }
  const center = ds.find((d) => d.type === 'center');
  for (const r of plan.radials) {
    if (r.kind !== 'trunk' || !center) continue;
    if (r.district !== center.id) addEdge('civic', center.id, r.district, 1);
  }
  for (const r of plan.radials) {
    if (r.kind !== 'branch' || !center) continue;
    if (r.district !== center.id && !edges.some((e) => e.kind === 'civic' && (e.b === r.district || e.a === r.district))) addEdge('civic', center.id, r.district, 1);
  }
  // 인접 + Kruskal: 그래프가 연결될 때까지 대로(civic) 간선
  const bc = borderCounts(ctx);
  const parent = ds.map((d) => d.id);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { parent[find(a)] = find(b); };
  for (const e of edges) unite(e.a, e.b);
  const pairs = [...bc.entries()].filter(([, c]) => c > 80).sort((a, b) => b[1] - a[1]);
  for (const [key] of pairs) {
    const [a, b] = key.split('|').map(Number);
    if (find(a) === find(b)) continue;
    addEdge('civic', a, b, 1, { kruskal: true });
    unite(a, b);
  }
  // 상한 24: 가중치 낮은 Kruskal/대로 간선부터 제거
  while (edges.length > 24) {
    let wi = -1;
    for (let i = edges.length - 1; i >= 0; i--) if (edges[i].kind === 'civic' && !edges[i].kruskal) { wi = i; break; }
    if (wi < 0) wi = edges.length - 1;
    edges.splice(wi, 1);
  }
  edges.forEach((e, i) => { e.id = `R${i}`; });
  const adj = {};
  for (const d of ds) adj[d.id] = [];
  for (const e of edges) { adj[e.a].push(e.id); adj[e.b].push(e.id); }
  const border = {};
  for (const [k, c] of bc.entries()) border[k] = c;
  plan.relations = { edges, adj, border };
  return plan.relations;
}

/** 관계 간선 찾기/만들기 (derived) — streets.js 와 markThresholds 가 사용 */
export function findOrMakeEdge(ctx, kind, a, b, opts = {}) {
  const R = ctx.plan.relations;
  const ok = (e) => (!kind || e.kind === kind) && ((e.a === a && e.b === b) || (!opts.directed && e.a === b && e.b === a));
  let e = R.edges.find(ok);
  if (e || opts.noCreate) return e || null;
  if (a === b || a < 0 || b < 0 || a === undefined || b === undefined) return null;
  e = { id: `R${R.edges.length}`, kind: kind || 'civic', a, b, w: 0.5, name: '', story: '', realizedBy: [], derived: true };
  nameEdge(ctx, e);
  R.edges.push(e);
  R.adj[a] = R.adj[a] || []; R.adj[b] = R.adj[b] || [];
  R.adj[a].push(e.id); R.adj[b].push(e.id);
  return e;
}

function nameEdge(ctx, e) {
  const A = ctx.districts[e.a], B = ctx.districts[e.b];
  const K = RELATION_KINDS[e.kind] || RELATION_KINDS.civic;
  e.name = `${A.short || SHORT[A.type]}↔${B.short || SHORT[B.type]} ${K.name}`;
  e.story = (RELATION_STORY[e.kind] || RELATION_STORY.civic).replace('{A}', A.name).replace('{B}', B.name);
  e.color = K.color;
  e.purpose = K.purpose;
}

// ======================================================================
// 10) 관계형 페르소나 (구역 이름) · 11) 역/광장 이름
// ======================================================================
const STORIES = {
  dorm: '아침마다 통학로가 붐빈다',
  oldvillage: '옛 어촌에서 이어진 낮은 지붕의 동네',
  housing: '역과 학원 사이의 조용한 주택가',
  oldport: '옛 나루 장터가 상점가로 자랐다',
  ekimae: '역에서 쏟아지는 학생들이 먼저 들르는 거리',
  arcade: '아케이드 지붕 아래 방과후의 거리',
  fishport: '섬에서 가장 오래된 포구 — 새벽 어시장',
  container: '하구 바깥으로 넓힌 컨테이너 부두',
  stalled: '옛 마을을 밀다 멈춘 재개발 현장',
  dormruins: '1기 기숙사 단지가 버려진 자리',
  oldtown: '재개발을 기다리는 구시가지',
};

function assignPersonas(ctx, plan) {
  const ds = ctx.districts;
  const H0 = ctx.history;
  const origin = H0 ? H0.origin : null;
  const D = ctx.district.data;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  const acad = ds.filter((d) => d.def.campus);
  const bc = plan.relations.border;
  const adjacent = (a, b) => (bc[a < b ? `${a}|${b}` : `${b}|${a}`] || 0) > 0;
  for (const d of ds) { d.baseName = d.baseName || d.name; d.short = SHORT[d.type]; d.persona = null; d.story = ''; }
  const set = (d, name, short, persona) => { d.relName = name; d.short = short; d.persona = persona; d.story = STORIES[persona] || ''; };
  // 주거구: 학원 코어 380m 안 → 기숙사촌 (서로 다른 학원 우선)
  const takenAcad = new Set();
  for (const d of ds.filter((x) => x.type === 'residential')) {
    const near = acad.filter((a) => a.core && Math.hypot(a.core.cx - d.x, a.core.cz - d.z) < 380)
      .sort((a, b) => Math.hypot(a.core.cx - d.x, a.core.cz - d.z) - Math.hypot(b.core.cx - d.x, b.core.cz - d.z));
    const A = near.find((a) => !takenAcad.has(a.id)) || near[0];
    if (A) { takenAcad.add(A.id); set(d, `${SHORT[A.type]} 기숙사촌`, `${SHORT[A.type]} 기숙사촌`, 'dorm'); d.dormOf = A.id; }
    else if (origin && dist(d, origin) < 320) set(d, '청해 옛마을', '옛마을', 'oldvillage');
    else set(d, `${dirName(d.x, d.z)}쪽 주택가`, `${dirName(d.x, d.z)}쪽 주택가`, 'housing');
  }
  // 항만
  for (const d of ds.filter((x) => x.type === 'harbor')) {
    let near = false;
    if (origin) {
      for (let dz = -150; dz <= 150 && !near; dz += 4) for (let dx = -150; dx <= 150; dx += 4) {
        if (dx * dx + dz * dz > 150 * 150) continue;
        const id = cellAt(origin.x + dx, origin.z + dz);
        if (id >= 0 && D[id] === d.id) { near = true; break; }
      }
    }
    if (near) set(d, '청해 어항', '청해 어항', 'fishport'); else set(d, '청해 컨테이너항', '컨테이너항', 'container');
  }
  // 구시가지
  const free = ds.find((x) => x.type === 'free_academy');
  for (const d of ds.filter((x) => x.type === 'ruins')) {
    if (origin && dist(d, origin) < 330) set(d, '옛마을 재개발 중단구역', '재개발 중단구역', 'stalled');
    else if (ds.some((o) => (o.type === 'residential' || o === free) && adjacent(o.id, d.id))) set(d, '1기 기숙사 단지 폐허', '기숙사 폐허', 'dormruins');
    else set(d, '구시가지 재개발구역', '구시가지', 'oldtown');
  }
  // 상점가 1: 옛길에 가장 가까운(평균 거리 < 120) 하나 → 옛나루 상점가
  const coms = ds.filter((x) => x.type === 'commercial');
  if (H0 && ctx.distOld2) {
    let best = null, bm = Infinity;
    const n2 = N / 2;
    for (const d of coms) {
      let s = 0, c = 0;
      for (let j = 1; j < n2; j += 2) for (let i = 1; i < n2; i += 2) {
        if (D[(j * 2) * N + i * 2] !== d.id) continue;
        s += ctx.distOld2[j * n2 + i]; c++;
      }
      const m = c ? s / c : Infinity;
      if (m < bm) { bm = m; best = d; }
    }
    if (best && bm < 120) set(best, '옛나루 상점가', '옛나루 상점가', 'oldport');
  }
  // 역 이름 (상점가 역전 페르소나보다 먼저: 역 이름은 구역의 기본 줄임말을 쓴다)
  const used = new Map();
  for (const s of plan.stations) {
    if (s.spur) continue;
    let stem;
    if (s.academy !== undefined) stem = `${SHORT[ds[s.academy].type]}학원앞`;
    else {
      const id = cellAt(s.x + s.n[0] * 20, s.z + s.n[1] * 20);
      const did = id >= 0 && D[id] !== 255 ? D[id] : (s.serves[0] ?? 0);
      const dd = ds[did];
      stem = dd.persona && dd.type !== 'commercial' ? dd.short.replace(/ .*$/, '') : SHORT[dd.type];
      if (dd.type === 'residential' && dd.persona === 'dorm') stem = `${SHORT[ds[dd.dormOf].type]} 기숙사`;
    }
    s.short = stem;
    used.set(stem, (used.get(stem) || 0) + 1);
  }
  for (const s of plan.stations) {
    if (s.spur) continue;
    if (used.get(s.short) > 1) s.short = `${s.short} ${dirName(s.x, s.z)}`;
    s.name = `${s.short}역`;
  }
  // 상점가 2: 역 200m 안 → 역전 상점가, 아니면 아케이드 상점가
  for (const d of coms) {
    if (d.persona) continue;
    const c = d.corePt || d;
    const st = plan.stations.filter((s) => !s.spur && dist(s, c) < 200).sort((a, b) => dist(a, c) - dist(b, c))[0];
    if (st) set(d, `${st.short} 역전 상점가`, `${st.short} 역전`, 'ekimae');
    else set(d, `아케이드 상점가 ${dirName(d.x, d.z)}부`, `상점가 ${dirName(d.x, d.z)}부`, 'arcade');
    d.ekimaeStation = st ? st.id : undefined;
  }
  // 학원·중앙·공원은 이름 유지
  for (const d of ds) if (!d.persona) { d.relName = d.baseName; d.short = SHORT[d.type]; }
  // 중복 이름 → 방위 접미사
  const byName = {};
  for (const d of ds) (byName[d.relName] = byName[d.relName] || []).push(d);
  for (const list of Object.values(byName)) {
    if (list.length < 2) continue;
    for (const d of list) { d.relName = `${d.relName} ${dirName(d.x, d.z)}부`; d.short = `${d.short} ${dirName(d.x, d.z)}`; }
  }
  for (const d of ds) d.name = d.relName;
}

function nameSquares(ctx, plan) {
  const ds = ctx.districts;
  for (const sq of plan.squares) {
    if (sq.kind === 'stationFront') sq.name = `${plan.stations[sq.station].name} 광장`;
    else if (sq.kind === 'stationBack') sq.name = `${plan.stations[sq.station].name} 뒷광장`;
    else if (sq.kind === 'gate') sq.name = `${SHORT[ds[sq.gate].type]} 정문 앞`;
    else sq.name = `${ds[sq.district].short} 광장`;
    const touch = new Set();
    const did = sq.kind === 'gate' ? sq.gate : sq.district;
    const st = sq.station !== undefined ? plan.stations[sq.station] : null;
    for (const e of plan.relations.edges) {
      if (e.a === did || e.b === did || (st && (st.serves.includes(e.a) || st.serves.includes(e.b)))) touch.add(e.id);
    }
    sq.rels = [...touch];
  }
}

// ======================================================================
// genPlan
// ======================================================================
export function genPlan(ctx) {
  const t0 = now();
  const tm = {};
  let tl = t0;
  const lap = (k) => { const t = now(); tm[k] = Math.round((t - tl) * 10) / 10; tl = t; };
  ctx.plan = null;
  const fail = (why) => { ctx.plan = null; ctx.log('macro.plan', `골격 계획 실패: ${why} — 레거시 가로망`); return null; };
  const gates = computeGates(ctx);
  if (gates.length < 2) return fail('정문 부족');
  const cost4 = planCost4(ctx);
  lap('cost');
  const ring = traceRing(ctx, cost4, gates);
  lap('ring');
  if (!ring || ring.pts.length < 20) return fail('환상대로 추적 불가');
  // 코어 (방사대로 목적지, 공원 입구 기준점)
  const coreList = [];
  for (const d of ctx.districts) if (['commercial', 'residential', 'harbor', 'ruins'].includes(d.type)) coreList.push({ district: d.id, ...coreOf(ctx, d) });
  const parkGates = planParkGates(ctx, coreList);
  lap('parkGates');
  const { dests, radials, clusters, cores } = traceRadials(ctx, cost4, ring, gates, parkGates);
  lap('radials');
  const trunks = radials.filter((r) => r.kind === 'trunk');
  if (trunks.length < 2) return fail('방사대로 부족');
  const fields = spineFields(ctx, ring, radials);
  lap('spine');
  const plan = {
    gates, ring, radials, dests, parkGates, cores, stations: [], squares: [], streets: [], thresholds: [],
    relations: null, od: [], nodes: [], walk: null, stats: {},
    distSpine: fields.distSpine, spineHash: fields.spineHash, distPark4: fields.distPark4,
  };
  delete ring.rStar;
  plan.stations = pickStations(ctx, ring, clusters, radials);
  plan.squares = placeSquares(ctx, plan);
  lap('stations');
  buildRelations(ctx, plan);
  lap('relations');
  ctx.plan = plan;
  assignPersonas(ctx, plan);
  for (const e of plan.relations.edges) nameEdge(ctx, e);
  nameSquares(ctx, plan);
  const stamped = stampSquares(ctx, plan);
  lap('names+stamp');
  // 방사대로 관계: civic(center, 목적지 구역)
  const center = ctx.districts.find((d) => d.type === 'center');
  for (const r of radials) {
    const e = center ? findOrMakeEdge(ctx, 'civic', center.id, r.district) : null;
    r.rel = e ? e.id : null;
    const dd = ctx.districts[r.district];
    r.name = r.kind === 'trunk' ? `${dd.short} 대로` : `${dd.short} 가지길`;
  }
  // 종결 판정: 정문 접합점 / 광장 / 가지가 목적지 광장에 닿음
  const nearSq = (x, z) => plan.squares.some((q) => Math.hypot(q.x - x, q.z - z) <= q.r + 20);
  let term = 0, termGate = 0, termCore = 0;
  for (const t of trunks) {
    const e = t.pts[t.pts.length - 1];
    let ok = false;
    if (t.gate !== undefined) ok = ring.junctions.some((j) => j.gate === t.gate && Math.hypot(j.x - e.x, j.z - e.z) < 6);
    if (ok) termGate++;
    if (!ok && nearSq(e.x, e.z)) ok = true;
    if (!ok) {
      const pd = dests[t.dests.slice().sort((a, b) => dests[b].w - dests[a].w)[0]];
      if (pd && pd.servedBy !== undefined) ok = true;
    }
    if (ok && t.gate === undefined) termCore++;
    t.terminated = ok;
    if (ok) term++;
  }
  // 통계
  const pst = placementStats(ctx);
  const ringStations = plan.stations.filter((s) => !s.spur);
  plan.stats = {
    ringClosed: ring.closed, ringCoverageDeg: ring.coverageDeg, ringLen: ring.len,
    radials: trunks.length, radialsTerminated: term,
    stations: ringStations.length, central: plan.stations.some((s) => s.spur),
    relations: plan.relations.edges.length,
    harborMouth: pst.harborMouth, dormTownMax: pst.dormTownMax, acadResDist: pst.acadResDist,
  };
  plan.timeMs = Math.round(now() - t0);
  plan.timing = tm;
  const gatesOnRing = ring.junctions.filter((j) => j.idx >= 0).length;
  ctx.log('macro.plan', `골격: 환상대로 + 방사 ${trunks.length} (가지 ${radials.length - trunks.length}) · 역 ${ringStations.length}+센트럴 · 광장 ${plan.squares.length} (${stamped}㎡) · 관계 ${plan.relations.edges.length}`);
  ctx.log('macro.ring', `환상대로 ${ring.len}m · ${ring.closed ? '폐합' : '열린 호'} ${ring.coverageDeg}° · 정문 ${gatesOnRing}곳 통과 · R ${ring.Rr}m`);
  ctx.log('macro.radial', `방사 대로 ${trunks.length} · 종결: 정문 ${termGate}, 코어/광장 ${termCore}`);
  ctx.log('meso.station', `역 ${ringStations.map((s) => s.name).join('·')} + 센트럴역`);
  return plan;
}

// ======================================================================
// B1) 관계 OD — 노드 + 관계 다리(leg) 표
// ======================================================================
export function buildOD(ctx) {
  const plan = ctx.plan;
  if (!plan) return;
  const ds = ctx.districts;
  const nodes = [];
  const node = (x, z, w, name, kind, ref) => { nodes.push({ x, z, w, name, kind, ref }); return nodes.length - 1; };
  const plaza = [];
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; plaza.push(node(Math.cos(a) * 66, Math.sin(a) * 66, 1.4, '중앙광장', 'plaza', k)); }
  const front = {}, back = {}, gate = {}, core = {};
  for (const sq of plan.squares) {
    if (sq.kind === 'stationFront') front[sq.station] = node(sq.x, sq.z, 1.5, sq.name, 'stationFront', sq.id);
    else if (sq.kind === 'stationBack') back[sq.station] = node(sq.x, sq.z, 0.8, sq.name, 'stationBack', sq.id);
    else if (sq.kind === 'gate') gate[sq.gate] = node(sq.x, sq.z, 2.0, sq.name, 'gate', sq.id);
    else if (sq.kind === 'core') {
      const w = { commercial: 2.0, residential: 1.6, harbor: 1.0, ruins: 0.6 }[ds[sq.district].type] || 1;
      core[sq.district] = node(sq.x, sq.z, w, sq.name, 'core', sq.id);
    }
  }
  const parkN = plan.parkGates.map((g, i) => node(g.x, g.z, 0.9, '공원 입구', 'parkGate', i));
  const originN = ctx.history ? node(ctx.history.origin.x, ctx.history.origin.z, 0.6, ctx.history.origin.name, 'origin', -1) : -1;
  plan.nodes = nodes;
  const N_ = (i) => nodes[i];
  const d2 = (a, b) => Math.hypot(N_(a).x - N_(b).x, N_(a).z - N_(b).z);
  const stationFor = (did) => {
    const A = ds[did];
    const ref = core[did] !== undefined ? N_(core[did]) : gate[did] !== undefined ? N_(gate[did]) : A;
    if (A.def.campus) {
      const gs = plan.stations.find((s) => s.academy === did && front[s.id] !== undefined);
      if (gs) return front[gs.id];
    }
    let best = -1, bd = Infinity;
    for (const sid in front) { const d = Math.hypot(N_(front[sid]).x - ref.x, N_(front[sid]).z - ref.z); if (d < bd) { bd = d; best = front[sid]; } }
    return best;
  };
  const endOf = (did) => (core[did] !== undefined ? core[did] : gate[did] !== undefined ? gate[did] : -1);
  const nearestPlaza = (i) => plaza.slice().sort((a, b) => d2(a, i) - d2(b, i))[0];
  const nearestPark = (i) => (parkN.length ? parkN.slice().sort((a, b) => d2(a, i) - d2(b, i))[0] : -1);
  const od = [];
  const leg = (a, b, w, purpose, rel) => { if (a >= 0 && b >= 0 && a !== b) od.push({ a, b, w, purpose, rel }); };
  for (const e of plan.relations.edges) {
    const A = e.a, B = e.b;
    switch (e.kind) {
      case 'commute': {
        const res = ds[A].type === 'residential' ? A : B, ac = res === A ? B : A;
        leg(core[res] ?? -1, stationFor(res), 3, 'commute', e.id);
        leg(stationFor(ac), gate[ac] ?? -1, 2.5, 'school', e.id);
        leg(core[res] ?? -1, gate[ac] ?? -1, 1.5, 'school', e.id);
        break;
      }
      case 'afterschool': leg(gate[A] ?? endOf(A), core[B] ?? endOf(B), 2, 'shop', e.id); break;
      case 'supply': leg(endOf(A), endOf(B), 0.8, 'market', e.id); break;
      case 'heritage': leg(endOf(A), originN, 0.6, 'leisure', e.id); break;
      case 'leisure': {
        const pk = ds[A].def.park ? A : B, x = pk === A ? B : A;
        const from = endOf(x);
        if (from >= 0) leg(from, nearestPark(from), 1, 'leisure', e.id);
        break;
      }
      case 'rivalry': leg(gate[A] ?? -1, gate[B] ?? -1, 0.4, 'through', e.id); break;
      default: { // civic
        const tgt = ds[A].type === 'center' ? B : ds[B].type === 'center' ? A : B;
        const from = endOf(tgt);
        if (from >= 0) leg(from, nearestPlaza(from), 0.8, 'leisure', e.id);
      }
    }
  }
  for (const sid in front) {
    for (const d of ds) if (d.type === 'commercial' && core[d.id] !== undefined && d2(front[sid], core[d.id]) < 600) leg(front[sid], core[d.id], 1, 'shop', null);
  }
  for (const d of ds) {
    if (d.type !== 'residential' || core[d.id] === undefined) continue;
    const coms = ds.filter((c) => c.type === 'commercial' && core[c.id] !== undefined).sort((a, b) => d2(core[d.id], core[a.id]) - d2(core[d.id], core[b.id]));
    if (coms.length) leg(core[d.id], core[coms[0].id], 1.5, 'shop', null);
  }
  plan.od = od;
  ctx.hubs = nodes.map((n) => ({ ...n }));
  ctx.parkEntrances = plan.parkGates.map((g) => ({ x: g.x, z: g.z }));
}

// ======================================================================
// B1) 접근 거리장 — 역·정문·코어 광장에서의 보행 거리 + 필지 walk/fP/era
// ======================================================================
function frontPoint(lot, out = 4) {
  if (lot.front < 0 || lot.front === undefined) return null;
  const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
  const hw = lot.w / 2, hd = lot.d / 2;
  const L = [[-hw, 0, -1, 0], [hw, 0, 1, 0], [0, -hd, 0, -1], [0, hd, 0, 1]][lot.front];
  const [u, v, nu, nv] = L;
  const cx = lot.x + u * c - v * s, cz = lot.z + u * s + v * c;
  const nx = nu * c - nv * s, nz = nu * s + nv * c;
  return { x: cx + nx * out, z: cz + nz * out, cx, cz, nx, nz };
}

function sample4(arr, x, z) {
  const i = Math.floor((x + H) / S4), j = Math.floor((z + H) / S4);
  if (i < 0 || j < 0 || i >= n4 || j >= n4) return Infinity;
  let v = arr[j * n4 + i];
  if (isFinite(v)) return v;
  let best = Infinity;
  for (let r = 1; r <= 3 && !isFinite(best); r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n4 || jj >= n4) continue;
      const w = arr[jj * n4 + ii] + Math.hypot(di, dj) * S4;
      if (w < best) best = w;
    }
  }
  return best;
}

export function accessFields(ctx) {
  const plan = ctx.plan;
  if (!plan) return;
  const cost = ctx.roadCost4;
  if (!cost) return;
  const srcOf = (kinds) => {
    const src = [];
    for (const sq of plan.squares) {
      if (!kinds.includes(sq.kind)) continue;
      let any = false;
      const R = Math.ceil(sq.r / S4);
      const ci = Math.floor((sq.x + H) / S4), cj = Math.floor((sq.z + H) / S4);
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n4 || j >= n4) continue;
        const x = i * S4 + 2 - H, z = j * S4 + 2 - H;
        if ((x - sq.x) ** 2 + (z - sq.z) ** 2 > sq.r * sq.r) continue;
        const k = j * n4 + i;
        if (cost[k] > 0) { src.push(k); any = true; }
      }
      if (!any) { const k = snap(cost, n4, ci, cj, 6); if (k >= 0) src.push(k); }
    }
    return src;
  };
  const run = (kinds) => {
    const src = srcOf(kinds);
    if (!src.length) return new Float32Array(n4 * n4).fill(Infinity);
    return dijkstra(n4, n4, cost, src, 1200, false, S4).dist;
  };
  plan.walk = { station: run(['stationFront', 'stationBack']), gate: run(['gate']), core: run(['core']) };
  const P = ctx.roadFlowP;
  const H0 = ctx.history;
  const ERA3 = new Set(['commercial', 'center', 'residential', 'ruins']);
  for (const lot of ctx.lots) {
    const fp = frontPoint(lot, 4);
    const sx = fp ? fp.x : lot.x, sz = fp ? fp.z : lot.z;
    lot.walk = { station: sample4(plan.walk.station, sx, sz), gate: sample4(plan.walk.gate, sx, sz), core: sample4(plan.walk.core, sx, sz) };
    const f = { commute: 0, school: 0, shop: 0, leisure: 0, market: 0 };
    if (P && fp) {
      for (const k in f) {
        const g = P[k];
        if (!g) continue;
        let m = 0;
        for (const dd of [4, 8, 12]) m = Math.max(m, g.at(fp.cx + fp.nx * dd, fp.cz + fp.nz * dd));
        f[k] = m;
      }
    }
    lot.fP = f;
    const dt = ctx.districts[lot.district].type;
    let era = 2;
    if (lot.heritage || (H0 && Math.hypot(lot.x - H0.origin.x, lot.z - H0.origin.z) < 120)) era = 0;
    else if (lot.walk.station < 110 && ERA3.has(dt)) era = 3;
    lot.era = era;
  }
  const gsw = {};
  for (const sq of plan.squares) {
    if (sq.kind !== 'gate') continue;
    const v = sample4(plan.walk.station, sq.x, sq.z);
    gsw[ctx.districts[sq.gate].type] = isFinite(v) ? Math.round(v) : null;
  }
  plan.stats.gateStationWalk = gsw;
}
