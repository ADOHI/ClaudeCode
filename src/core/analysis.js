// 공간 분석: 보행 흐름(근사 매개중심성), 아이소비스트 가시성(숨김도), 우회거리, 위요도.
// 레벨 디자인 '의도' 레이어는 전부 이 필드들을 근거로 배치된다.
import { dijkstra, tracePath, forEachCellInOBB, Grid } from './grid.js';
import { TERRAIN, ROAD, WORLD } from './config.js';

const H = WORLD.half, N = WORLD.size;

const ROAD_COST = {
  [ROAD.MAIN]: 1.0, [ROAD.MINOR]: 1.05, [ROAD.ALLEY]: 1.2, [ROAD.COAST]: 1.0, [ROAD.SIDEWALK]: 1.0,
  [ROAD.PLAZA]: 1.0, [ROAD.CAMPUS_PATH]: 1.0, [ROAD.PARK_PATH]: 1.0, [ROAD.BRIDGE]: 1.0, [ROAD.PIER]: 1.1,
};

/** 4m 도로 전용 그래프 (건물 배치 전 용도 배정용 흐름) */
export function roadFlow(ctx) {
  const S = 4, n = N / S;
  const cost = new Float32Array(n * n);
  const R = ctx.road.data;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (const [a, b] of [[1, 1], [3, 1], [1, 3], [3, 3], [2, 2]]) {
        const r = R[(j * S + b) * N + i * S + a];
        if (r && ROAD_COST[r]) best = best ? Math.min(best, ROAD_COST[r]) : ROAD_COST[r];
      }
      cost[j * n + i] = best;
    }
  }
  const flow = computeFlow(cost, n, S, ctx.hubs);
  ctx.roadFlow = new Grid(n, n, S, -H, -H);
  ctx.roadFlow.data = flow;
}

/** 거점 쌍 최단경로 누적 → 로그 정규화 흐름 [0,1] */
export function computeFlow(cost, n, S, hubs) {
  const toCell = (x, z) => {
    const i = Math.floor((x + H) / S), j = Math.floor((z + H) / S);
    return snap(cost, n, i, j, 12);
  };
  const cells = hubs.map((h) => toCell(h.x, h.z));
  const acc = new Float32Array(n * n);
  const valid = hubs.map((h, k) => cells[k] >= 0);
  for (let a = 0; a < hubs.length; a++) {
    if (!valid[a]) continue;
    const { prev, dist } = dijkstra(n, n, cost, [cells[a]], Infinity, true, S);
    for (let b = a + 1; b < hubs.length; b++) {
      if (!valid[b] || !isFinite(dist[cells[b]])) continue;
      const w = (hubs[a].w || 1) * (hubs[b].w || 1);
      const path = tracePath(prev, cells[b]);
      for (const c of path) acc[c] += w;
    }
  }
  // 1셀 블러 후 로그 정규화
  const bl = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = acc[j * n + i] * 2, c = 2;
    if (i > 0) { s += acc[j * n + i - 1]; c++; }
    if (i < n - 1) { s += acc[j * n + i + 1]; c++; }
    if (j > 0) { s += acc[(j - 1) * n + i]; c++; }
    if (j < n - 1) { s += acc[(j + 1) * n + i]; c++; }
    bl[j * n + i] = cost[j * n + i] > 0 ? s / c : 0;
  }
  let mx = 0;
  for (let k = 0; k < bl.length; k++) if (bl[k] > mx) mx = bl[k];
  const L = Math.log(1 + mx);
  for (let k = 0; k < bl.length; k++) bl[k] = mx > 0 ? Math.log(1 + bl[k]) / L : 0;
  return bl;
}

export function snap(cost, n, i, j, maxR) {
  i = Math.max(0, Math.min(n - 1, i));
  j = Math.max(0, Math.min(n - 1, j));
  if (cost[j * n + i] > 0) return j * n + i;
  for (let r = 1; r <= maxR; r++) {
    let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      if (cost[jj * n + ii] > 0) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = jj * n + ii; } }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** 지면 고정 고체(건물/담장/소품)의 높이 래스터 (cell m) */
export function rasterSolids(ctx, S) {
  const n = N / S;
  const g = new Grid(n, n, S, -H, -H);
  const D = g.data;
  for (const e of ctx.entities) {
    if (!e.solid || e.y > 0.6 || e.deleted) continue;
    const top = e.y + e.h;
    if (top < 0.4) continue;
    const pad = Math.min(e.w, e.d) < S ? S * 0.35 : 0;
    const o = { x: e.x, z: e.z, w: e.w, d: e.d, rot: e.rot || 0 };
    if (e.shape === 'cyl' || e.shape === 'cone' || e.shape === 'sphere') { o.rot = 0; }
    forEachCellInOBB(g, o, (id) => { if (top > D[id]) D[id] = top; }, pad);
  }
  return g;
}

/** 건물 배치 후 전체 분석 (보행 흐름 4m, 가시성/우회 2m) */
export function fullAnalysis(ctx) {
  const S2 = WORLD.ana; // 2m
  const n2 = N / S2;
  const T = ctx.terrain.data, R = ctx.road.data;
  const solid = rasterSolids(ctx, S2);
  ctx.solid2 = solid;
  const cost2 = new Float32Array(n2 * n2);
  for (let j = 0; j < n2; j++) {
    for (let i = 0; i < n2; i++) {
      const id1 = (j * S2 + 1) * N + i * S2 + 1;
      const t = T[id1], r = R[id1];
      const k = j * n2 + i;
      const land = t === TERRAIN.LAND || r === ROAD.BRIDGE || r === ROAD.PIER;
      if (!land || solid.data[k] > 0.9) { cost2[k] = 0; continue; }
      cost2[k] = r ? ROAD_COST[r] || 1.2 : 1.45;
    }
  }
  ctx.cost2 = cost2;
  // 4m 보행 그래프: 2x2 하위셀 중 2개 이상 통행 가능
  const S4 = 4, n4 = N / S4;
  const cost4 = new Float32Array(n4 * n4);
  for (let j = 0; j < n4; j++) for (let i = 0; i < n4; i++) {
    let c = 0, s = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const v = cost2[(j * 2 + b) * n2 + i * 2 + a];
      if (v > 0) { c++; s += v; }
    }
    cost4[j * n4 + i] = c >= 2 ? s / c : 0;
  }
  const flow4 = computeFlow(cost4, n4, S4, ctx.hubs);
  ctx.flow = new Grid(n4, n4, S4, -H, -H);
  ctx.flow.data = flow4;

  // 메인 동선 셀 (상위 흐름) → 2m 소스
  let sorted = Array.from(flow4).filter((v) => v > 0).sort((a, b) => b - a);
  const thr = sorted[Math.floor(sorted.length * 0.16)] || 0.5;
  ctx.flowThreshold = thr;
  const flowSrc = [];
  const isFlow2 = new Uint8Array(n2 * n2);
  for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) {
    const k = j * n2 + i;
    if (cost2[k] <= 0) continue;
    if (flow4[(j >> 1) * n4 + (i >> 1)] >= thr) { flowSrc.push(k); isFlow2[k] = 1; }
  }
  ctx.isFlow2 = isFlow2;
  // 우회 거리: 메인 동선으로부터의 보행 측지 거리
  const det = dijkstra(n2, n2, cost2, flowSrc, 400, true, S2);
  ctx.detour = det.dist;
  ctx.detourPrev = det.prev;

  // 아이소비스트 가시성: 메인 동선 관찰자들이 볼 수 있는 셀 누적
  const vis = new Float32Array(n2 * n2);
  const stamp = new Int32Array(n2 * n2).fill(-1);
  const obsHash = new Set();
  const observers = [];
  const rng = ctx.rng.fork('observers');
  const cand = flowSrc.slice();
  rng.shuffle(cand);
  for (const k of cand) {
    const i = k % n2, j = (k / n2) | 0;
    const key = ((i / 7) | 0) * 1000 + ((j / 7) | 0);
    if (obsHash.has(key)) continue;
    obsHash.add(key);
    observers.push(k);
    if (observers.length > 1400) break;
  }
  const RAYS = 72, MAXS = 60;
  const blockH = 1.7;
  const SD = solid.data;
  for (let o = 0; o < observers.length; o++) {
    const k0 = observers[o];
    const ox = (k0 % n2) + 0.5, oz = ((k0 / n2) | 0) + 0.5;
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let s = 1; s < MAXS; s++) {
        const i = Math.floor(ox + dx * s), j = Math.floor(oz + dz * s);
        if (i < 0 || j < 0 || i >= n2 || j >= n2) break;
        const k = j * n2 + i;
        if (stamp[k] !== o) { stamp[k] = o; vis[k] += 1; }
        if (SD[k] > blockH) break;
      }
    }
  }
  const hidden = new Float32Array(n2 * n2);
  for (let k = 0; k < hidden.length; k++) hidden[k] = cost2[k] > 0 ? 1 - Math.min(1, vis[k] / 7) : 0;
  ctx.vis = vis;
  ctx.hidden = hidden;
  ctx.observers = observers.length;
  ctx.log('intent.flow', `거점 ${ctx.hubs.length}개 쌍 경로 → 메인 동선 상위16% (관찰자 ${observers.length})`);
}

/** 셀 위요도(enclosure): 12m 이내 차폐된 방향 비율 */
export function enclosure(ctx, k) {
  const n2 = N / WORLD.ana;
  const SD = ctx.solid2.data;
  const ox = (k % n2) + 0.5, oz = ((k / n2) | 0) + 0.5;
  let blocked = 0;
  const R = 16;
  for (let r = 0; r < R; r++) {
    const a = (r / R) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    for (let s = 1; s <= 6; s++) {
      const i = Math.floor(ox + dx * s), j = Math.floor(oz + dz * s);
      if (i < 0 || j < 0 || i >= n2 || j >= n2) break;
      if (SD[j * n2 + i] > 1.7) { blocked++; break; }
    }
  }
  return blocked / R;
}

/** 2m 셀 ↔ 월드 */
export const c2x = (k) => (k % (N / WORLD.ana)) * WORLD.ana - H + WORLD.ana / 2;
export const c2z = (k) => ((k / (N / WORLD.ana)) | 0) * WORLD.ana - H + WORLD.ana / 2;
export const w2c = (x, z) => {
  const n2 = N / WORLD.ana;
  const i = Math.floor((x + H) / WORLD.ana), j = Math.floor((z + H) / WORLD.ana);
  if (i < 0 || j < 0 || i >= n2 || j >= n2) return -1;
  return j * n2 + i;
};

/** 가시성(높이 고려): 점 a(높이 ya)에서 점 b(높이 yb)가 보이는가 — solid2 기준 */
export function lineOfSight(ctx, ax, az, ya, bx, bz, yb, skipEnd = 6) {
  const SD = ctx.solid2.data;
  const n2 = N / WORLD.ana;
  const L = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(L / 2);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (L * (1 - t) < skipEnd) break;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const i = Math.floor((x + H) / 2), j = Math.floor((z + H) / 2);
    if (i < 0 || j < 0 || i >= n2 || j >= n2) return false;
    const y = ya + (yb - ya) * t;
    if (SD[j * n2 + i] > y) return false;
  }
  return true;
}
