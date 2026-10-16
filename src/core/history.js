// 연대기 · 옛길 (C§6 A2): 하구 어촌(청해 어촌) → 강 단구를 따라 → 옛 나루터, 그리고 옛 나루 시장에서
// 신목 언덕(공원)으로 가는 참배길. 섬에서 가장 오래된 길 하나가 이후 가로망·필지·건물 시대를 설명한다.
import { Noise2D } from './rng.js';
import { dijkstra, tracePath, edt } from './grid.js';
import { TERRAIN, ZONE, WORLD } from './config.js';
import { chaikin, resample, polyLen } from './structure.js';

const H = WORLD.half, N = WORLD.size;
const cellAt = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

/**
 * ctx.history = { mouth, origin, ford, market, sacred|null, parkEntry|null, oldRoads:[{id,name,pts}], len } | null
 * ctx.distOld2 = Float32Array(512²) — 옛길 중심선까지 거리(m), 2m 셀
 */
export function genHistory(ctx) {
  ctx.history = null;
  ctx.distOld2 = null;
  const T = ctx.terrain.data, Z = ctx.zone.data;
  const harbor = ctx.districts.find((d) => d.type === 'harbor');
  const mouths = ctx.riverMouths || [];
  if (!harbor || !mouths.length || !ctx.river || ctx.river.length < 4) { ctx.log('macro.oldroad', '하구 없음 — 옛길 생략'); return; }

  // 1) 하구: 항만 시드에 가장 가까운 하구
  let mouth = mouths[0];
  for (const m of mouths) if (Math.hypot(m.x - harbor.x, m.z - harbor.z) < Math.hypot(mouth.x - harbor.x, mouth.z - harbor.z)) mouth = m;

  // 2) 기원 O: 하구 70m 안, 해안 10–30m · 하천 25m 이내 도시 땅 중 항만 시드에 가장 가까운 곳
  let origin = null, od = Infinity;
  for (let dz = -70; dz <= 70; dz += 2) {
    for (let dx = -70; dx <= 70; dx += 2) {
      if (dx * dx + dz * dz > 70 * 70) continue;
      const x = mouth.x + dx, z = mouth.z + dz;
      const id = cellAt(x, z);
      if (id < 0 || T[id] !== TERRAIN.LAND || Z[id] !== ZONE.CITY) continue;
      const ds = ctx.distSea[id];
      if (ds < 10 || ds > 30 || ctx.distRiver[id] > 25) continue;
      const d = Math.hypot(x - harbor.x, z - harbor.z);
      if (d < od) { od = d; origin = { x: Math.floor(x + H) - H + 0.5, z: Math.floor(z + H) - H + 0.5 }; }
    }
  }
  if (!origin) { ctx.log('macro.oldroad', '어촌 입지 없음 — 옛길 생략'); return; }

  // 3) 나루 F: 중심에서 95m 이상 떨어진 하천점 중 중심에 가장 가까운 곳 → 둑 위 땅 Fb
  let F = null, fr = Infinity;
  for (const p of ctx.river) {
    const r = Math.hypot(p.x, p.z);
    if (r >= 95 && r < fr) { fr = r; F = p; }
  }
  if (!F) { ctx.log('macro.oldroad', '나루 입지 없음 — 옛길 생략'); return; }
  let Fb = null, fbd = Infinity;
  for (let dz = -40; dz <= 40; dz += 1) {
    for (let dx = -40; dx <= 40; dx += 1) {
      const d = Math.hypot(dx, dz);
      if (d > 40 || d >= fbd) continue;
      const x = F.x + dx, z = F.z + dz;
      const id = cellAt(x, z);
      if (id < 0 || T[id] !== TERRAIN.LAND) continue;
      const dr = ctx.distRiver[id];
      if (dr < 8 || dr > 16 || Math.hypot(x, z) < 80) continue;
      fbd = d; Fb = { x, z };
    }
  }
  if (!Fb) { ctx.log('macro.oldroad', '나루 둑 없음 — 옛길 생략'); return; }

  // 4) 신목 S: 공원 셀(4m 표본) 중 distBorder + 0.3·distRiver 최대 (distBorder ≥ 30)
  let sacred = null, ss = -Infinity;
  for (let j = 2; j < N; j += 4) {
    for (let i = 2; i < N; i += 4) {
      const id = j * N + i;
      if (Z[id] !== ZONE.PARK) continue;
      const db = ctx.distBorder[id];
      if (db < 30) continue;
      const s = db + 0.3 * ctx.distRiver[id];
      if (s > ss) { ss = s; sacred = { x: i - H + 0.5, z: j - H + 0.5 }; }
    }
  }

  // 5) 8m 비용 격자 (강 단구 선호, 해안 30m 선호, fBm 잡음)
  const S = 8, n = N / S;
  const nz = new Noise2D(ctx.rng.fork('history'));
  const cost = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = (j * S + 4) * N + i * S + 4;
      const x = i * S + 4 - H, z = j * S + 4 - H;
      const t = T[id], ds = ctx.distSea[id];
      if (t === TERRAIN.SEA || ds < 6 || Math.hypot(x, z) < 75) { cost[j * n + i] = 0; continue; }
      let c = 1;
      if (t === TERRAIN.RIVER || t === TERRAIN.LAKE) c = 28;
      if (Z[id] === ZONE.CAMPUS || Z[id] === ZONE.PARK) c *= 3.5;
      c -= 0.45 * Math.exp(-(((ctx.distRiver[id] - 12) / 8) ** 2));
      c -= 0.3 * Math.exp(-(((ds - 30) / 12) ** 2));
      c += (0.35 * (nz.fbm(x / 90, z / 90, 3) + 1)) / 2;
      cost[j * n + i] = Math.max(0.25, c);
    }
  }
  const c8 = (p) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor((p.x + H) / S))), j = Math.max(0, Math.min(n - 1, Math.floor((p.z + H) / S)));
    return j * n + i;
  };
  const toWorld = (k) => ({ x: (k % n) * S + 4 - H, z: ((k / n) | 0) * S + 4 - H });
  const o8 = c8(origin), f8 = c8(Fb);
  cost[o8] = Math.max(cost[o8], 0.25);
  cost[f8] = Math.max(cost[f8], 0.25);

  // 6) R1 강변 옛길: O → Fb
  const d1 = dijkstra(n, n, cost, [o8], Infinity, true, S);
  if (!isFinite(d1.dist[f8])) { ctx.log('macro.oldroad', '옛길 경로 없음 — 생략'); return; }
  const path1 = tracePath(d1.prev, f8);
  const cells1 = path1.map(toWorld);
  cells1[0] = { x: origin.x, z: origin.z };
  cells1.push({ x: Fb.x, z: Fb.z });

  // 7) 옛 나루 시장 M: R1의 25–85% 구간에서 신목에 가장 가까운 점
  const k0 = Math.floor(path1.length * 0.25), k1 = Math.max(k0, Math.floor(path1.length * 0.85));
  let mk = Math.floor(path1.length * 0.5);
  if (sacred) {
    let md = Infinity;
    for (let k = k0; k <= k1 && k < path1.length; k++) {
      const p = toWorld(path1[k]);
      const d = Math.hypot(p.x - sacred.x, p.z - sacred.z);
      if (d < md) { md = d; mk = k; }
    }
  }
  const market = toWorld(path1[Math.min(mk, path1.length - 1)]);

  // 8) R2 참배길: M → S, 첫 공원 셀에서 자른다 (= 공원 입구)
  let cells2 = null, parkEntry = null;
  if (sacred) {
    const m8 = path1[Math.min(mk, path1.length - 1)], s8 = c8(sacred);
    if (cost[s8] > 0) {
      const d2 = dijkstra(n, n, cost, [m8], Infinity, true, S);
      if (isFinite(d2.dist[s8])) {
        const path2 = tracePath(d2.prev, s8);
        const out = [];
        for (const k of path2) {
          const p = toWorld(k);
          const id = cellAt(p.x, p.z);
          out.push(p);
          if (id >= 0 && Z[id] === ZONE.PARK) { parkEntry = { x: p.x, z: p.z }; break; }
        }
        if (parkEntry && out.length >= 2) cells2 = out;
      }
    }
  }

  // 9) 평활화 → 2.5m 재표본 → 교량 표시, 비도시 존 구간 제거(연속 구간으로 분할)
  const smooth = (cells) => {
    const P = resample(chaikin(cells, 3), 2.5);
    const runs = [];
    let cur = [];
    for (const p of P) {
      const id = cellAt(p.x, p.z);
      const ok = id >= 0 && (T[id] !== TERRAIN.LAND || Z[id] === ZONE.CITY || Z[id] === ZONE.PLAZA) && T[id] !== TERRAIN.SEA;
      if (!ok) { if (cur.length) runs.push(cur); cur = []; continue; }
      const q = { x: p.x, z: p.z };
      if (T[id] !== TERRAIN.LAND) q.bridge = true;
      cur.push(q);
    }
    if (cur.length) runs.push(cur);
    return runs.filter((r) => r.length >= 2 && polyLen(r) >= 30);
  };
  const oldRoads = [];
  const r1 = smooth(cells1);
  r1.forEach((pts, k) => oldRoads.push({ id: k ? `R1-${k + 1}` : 'R1', name: '강변 옛길', pts }));
  let len2 = 0;
  if (cells2) {
    const r2 = smooth(cells2);
    // 참배길은 공원 입구까지 이어져야 하므로 끝(입구 쪽) 구간만 유지
    if (r2.length) {
      const pts = r2[r2.length - 1];
      len2 = polyLen(pts);
      if (len2 >= 30) oldRoads.push({ id: 'R2', name: '참배길', pts });
      else len2 = 0;
    }
  }
  if (!oldRoads.length) { ctx.log('macro.oldroad', '옛길이 도시 땅을 지나지 않음 — 생략'); return; }
  if (!len2) parkEntry = parkEntry && cells2 ? parkEntry : null;
  const len = oldRoads.reduce((s, o) => s + polyLen(o.pts), 0);

  // 10) 2m 거리장 (옛길 중심선 1m 간격 표본의 셀)
  const n2 = N / 2;
  const mask = new Uint8Array(n2 * n2);
  for (const o of oldRoads) {
    const P = o.pts;
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(L));
      for (let s = 0; s <= steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / steps, z = a.z + ((b.z - a.z) * s) / steps;
        const i = Math.floor((x + H) / 2), j = Math.floor((z + H) / 2);
        if (i >= 0 && j >= 0 && i < n2 && j < n2) mask[j * n2 + i] = 1;
      }
    }
  }
  const dcell = edt((k) => mask[k] === 1, n2, n2);
  for (let k = 0; k < dcell.length; k++) dcell[k] *= 2;
  ctx.distOld2 = dcell;

  const len1 = r1.reduce((s, pts) => s + polyLen(pts), 0);
  ctx.history = {
    mouth: { x: mouth.x, z: mouth.z },
    origin: { x: origin.x, z: origin.z, name: '청해 어촌' },
    ford: { x: Fb.x, z: Fb.z, name: '옛 나루터', crossing: !!r1.some((pts) => pts.some((p) => p.bridge)) },
    market: { x: market.x, z: market.z, name: '옛 나루 시장' },
    sacred: sacred ? { x: sacred.x, z: sacred.z, name: '신목 언덕' } : null,
    parkEntry: len2 ? parkEntry : null,
    oldRoads,
    len,
  };
  ctx.log('macro.oldroad', `강변 옛길 ${len1.toFixed(0)}m · 참배길 ${len2.toFixed(0)}m · 옛 나루 r${Math.hypot(Fb.x, Fb.z).toFixed(0)}`);
}

/** 옛길 중심선까지 거리 (m, 쌍선형). 연대기가 없으면 Infinity. */
export function distOldAt(ctx, x, z) {
  const D = ctx.distOld2;
  if (!ctx.history || !D) return Infinity;
  const n2 = N / 2;
  const fx = (x + H) / 2 - 0.5, fz = (z + H) / 2 - 0.5;
  let i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const i0 = Math.max(0, Math.min(n2 - 1, i)), i1 = Math.max(0, Math.min(n2 - 1, i + 1));
  const j0 = Math.max(0, Math.min(n2 - 1, j)), j1 = Math.max(0, Math.min(n2 - 1, j + 1));
  const a = D[j0 * n2 + i0], b = D[j0 * n2 + i1], c = D[j1 * n2 + i0], e = D[j1 * n2 + i1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
}

/** 옛길 거리장의 기울기 (중앙 차분, 4m) — 텐서장의 옛길 접선항에 사용 */
export function gradOld(ctx, x, z) {
  return [distOldAt(ctx, x + 2, z) - distOldAt(ctx, x - 2, z), distOldAt(ctx, x, z + 2) - distOldAt(ctx, x, z - 2)];
}
