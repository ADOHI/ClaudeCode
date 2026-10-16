// 메조 1단계: 블록 추출(래스터 연결요소) → 관통 골목 → 둘레형(perimeter) 필지 분할.
// 둘레형 분할은 블록 외곽에 접도 필지를 두르고 안쪽을 '안뜰'로 남긴다 → 숨은 공간의 원천.
import { components } from './grid.js';
import { TERRAIN, ROAD, ZONE, WORLD } from './config.js';
import { tensorAngle, rasterizeRoads } from './roads.js';

const H = WORLD.half, N = WORLD.size;

export function extractBlocks(ctx) {
  const T = ctx.terrain.data, R = ctx.road.data, Z = ctx.zone.data, D = ctx.district.data;
  const comp = components(N, N, (id) => T[id] === TERRAIN.LAND && R[id] === ROAD.NONE && Z[id] === ZONE.CITY);
  const { labels, count, sizes } = comp;
  // counting sort → 블록별 셀 목록
  const offs = new Int32Array(count + 1);
  for (let c = 0; c < count; c++) offs[c + 1] = offs[c] + sizes[c];
  const fill = offs.slice(0, count);
  const cells = new Int32Array(offs[count]);
  for (let id = 0; id < N * N; id++) {
    const l = labels[id];
    if (l >= 0) cells[fill[l]++] = id;
  }
  const blocks = [];
  for (let c = 0; c < count; c++) {
    if (sizes[c] < 60) continue;
    let sx = 0, sz = 0;
    const dcount = {};
    for (let k = offs[c]; k < offs[c + 1]; k++) {
      const id = cells[k];
      sx += id % N;
      sz += (id / N) | 0;
      const d = D[id];
      dcount[d] = (dcount[d] || 0) + 1;
    }
    const n = sizes[c];
    const cx = sx / n - H + 0.5, cz = sz / n - H + 0.5;
    let dist = 0, bc = -1;
    for (const k in dcount) if (dcount[k] > bc) { bc = dcount[k]; dist = +k; }
    let rot = tensorAngle(ctx, cx, cz);
    const b = { id: blocks.length, label: c, cx, cz, area: n, district: dist, rot, offs: [offs[c], offs[c + 1]] };
    computeLocalBounds(b, cells);
    if (b.v1 - b.v0 > b.u1 - b.u0) {
      b.rot += Math.PI / 2;
      computeLocalBounds(b, cells);
    }
    blocks.push(b);
  }
  ctx.blockLabels = labels;
  ctx.blockCells = cells;
  ctx.blocks = blocks;
}

function computeLocalBounds(b, cells) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = b.offs[0]; k < b.offs[1]; k++) {
    const id = cells[k];
    const x = (id % N) - H + 0.5 - b.cx, z = ((id / N) | 0) - H + 0.5 - b.cz;
    const u = x * c + z * s, v = -x * s + z * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  Object.assign(b, { u0: u0 - 0.5, u1: u1 + 0.5, v0: v0 - 0.5, v1: v1 + 0.5 });
}

export const localToWorld = (b, u, v) => {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [b.cx + u * c - v * s, b.cz + u * s + v * c];
};

/** 긴 블록을 가로지르는 골목 생성 (투과성 규칙). 생성 후 재래스터화 + 블록 재추출 */
export function genAlleys(ctx) {
  const rng = ctx.rng.fork('alleys');
  const labels = ctx.blockLabels, R = ctx.road.data, T = ctx.terrain.data;
  let made = 0, dead = 0, covered = 0;
  const startId = ctx.roadLines.length;
  for (const b of ctx.blocks) {
    const def = ctx.districts[b.district].def;
    if (!def.alleys) continue;
    const L = b.u1 - b.u0, Dp = b.v1 - b.v0;
    const thresh = def.deadEndAlleys ? 34 : ctx.districts[b.district].type === 'commercial' ? 38 : 50;
    if (L < thresh || Dp < 16) continue;
    const brng = rng.fork(`b${Math.round(b.cx)},${Math.round(b.cz)}`);
    if (!brng.chance(Math.min(1, def.alleys * (ctx.params ? ctx.params.alleys : 1)))) continue;
    const nCuts = L > thresh * 2.2 ? 2 : 1;
    for (let k = 0; k < nCuts; k++) {
      const t = nCuts === 1 ? brng.range(0.38, 0.62) : (k + 1) / 3 + brng.range(-0.06, 0.06);
      const u = b.u0 + L * t;
      const isDead = def.deadEndAlleys && brng.chance(def.deadEndAlleys);
      // v 방향으로 블록을 벗어날 때까지 스캔
      const scan = (dir) => {
        let v = 0, last = 0, endKind = 'road';
        for (let s = 0; s < 200; s++) {
          v = dir * s;
          const [x, z] = localToWorld(b, u, v);
          const id = Math.floor(z + H) * N + Math.floor(x + H);
          if (labels[id] === b.label) { last = v; continue; }
          if (R[id] !== ROAD.NONE) { endKind = 'road'; last = v + dir * 1.5; break; }
          if (T[id] !== TERRAIN.LAND) { endKind = 'water'; break; }
          if (Math.abs(v - last) > 3) { endKind = 'other'; break; }
        }
        return { v: last, endKind };
      };
      const a = scan(-1), c = scan(1);
      let va = a.v, vc = c.v;
      if (isDead) {
        // 한쪽에서만 들어와 블록 60% 지점에서 멈춘다
        vc = va + (vc - va) * brng.range(0.55, 0.68);
      }
      if (vc - va < 14) continue;
      const pts = [];
      for (let v = va; v <= vc; v += 2) {
        const [x, z] = localToWorld(b, u, v);
        pts.push({ x, z });
      }
      const [ex, ez] = localToWorld(b, u, vc);
      pts.push({ x: ex, z: ez });
      const coveredArcade = def.arcade && brng.chance(def.arcade) && !isDead;
      ctx.roadLines.push({
        id: ctx.roadLines.length, family: -1, level: 3, pts, width: 4, sidewalk: 0,
        alley: true, covered: coveredArcade, deadEnd: isDead, district: b.district,
        ends: [{ stop: 'joined' }, { stop: isDead ? 'dead' : 'joined' }],
      });
      made++;
      if (coveredArcade) covered++;
      if (isDead) {
        dead++;
        const [dx, dz] = [Math.cos(b.rot + Math.PI / 2), Math.sin(b.rot + Math.PI / 2)];
        ctx.deadEnds.push({ x: ex, z: ez, dir: [dx, dz], line: ctx.roadLines.length - 1, level: 3, kind: 'alley' });
      }
    }
  }
  ctx.alleyLines = ctx.roadLines.slice(startId);
  rasterizeRoads(ctx);
  extractBlocks(ctx);
  ctx.log('meso.alley', `관통 골목 ${made}개 (아케이드 ${covered})`);
  if (dead) ctx.log('meso.deadend', `막다른 골목 ${dead}개`);
}

// ---- 필지 분할 ----
export function genLots(ctx) {
  const rng = ctx.rng.fork('lots');
  const lots = [];
  for (const b of ctx.blocks) {
    const d = ctx.districts[b.district];
    if (b.area < 90) { b.small = true; continue; }
    const brng = rng.fork(`b${Math.round(b.cx)},${Math.round(b.cz)}`);
    b.lots = [];
    if (b.special) continue;
    const { f, d: dep } = d.def.lot;
    const W = b.u1 - b.u0, Dp = b.v1 - b.v0;
    const rects = [];
    const splitRow = (u0, u1, v0, v1, front, axis) => {
      // axis 'u': 행이 u를 따라 놓임 (frontage = u 폭)
      const len = axis === 'u' ? u1 - u0 : v1 - v0;
      const avg = (f[0] + f[1]) / 2;
      const n = Math.max(1, Math.round(len / avg));
      const ws = [];
      let tot = 0;
      for (let k = 0; k < n; k++) { const w = brng.range(f[0], f[1]); ws.push(w); tot += w; }
      let acc = axis === 'u' ? u0 : v0;
      for (let k = 0; k < n; k++) {
        const w = (ws[k] / tot) * len;
        if (axis === 'u') rects.push({ u0: acc, u1: acc + w, v0, v1, front });
        else rects.push({ u0, u1, v0: acc, v1: acc + w, front });
        acc += w;
      }
    };
    if (Dp < 1.7 * dep[0]) {
      splitRow(b.u0, b.u1, b.v0, b.v1, 'v-', 'u');
    } else if (Dp <= 2 * dep[1] + 10) {
      const vm = b.v0 + Dp * brng.range(0.43, 0.57);
      splitRow(b.u0, b.u1, b.v0, vm, 'v-', 'u');
      splitRow(b.u0, b.u1, vm, b.v1, 'v+', 'u');
    } else {
      const d1 = brng.range(dep[0], dep[1]), d2 = brng.range(dep[0], dep[1]);
      // 안뜰 진입 통로: 바깥 행 하나에 폭 3.5m 틈을 끼워 안뜰과 거리를 잇는다 (자물쇠 규칙의 최협점)
      const pw = 3.5, pu = b.u0 + (b.u1 - b.u0) * brng.range(0.3, 0.7);
      rects.push({ u0: pu - pw / 2, u1: pu + pw / 2, v0: b.v0, v1: b.v0 + d1 + 1, front: 'v-', passage: true });
      splitRow(b.u0, pu - pw / 2, b.v0, b.v0 + d1, 'v-', 'u');
      splitRow(pu + pw / 2, b.u1, b.v0, b.v0 + d1, 'v-', 'u');
      splitRow(b.u0, b.u1, b.v1 - d2, b.v1, 'v+', 'u');
      const bv0 = b.v0 + d1, bv1 = b.v1 - d2;
      const de = brng.range(dep[0], dep[1]);
      if (W > 2 * de + 12) {
        splitRow(b.u0, b.u0 + de, bv0, bv1, 'u-', 'v');
        splitRow(b.u1 - de, b.u1, bv0, bv1, 'u+', 'v');
        // 안뜰 (interior)
        const iu0 = b.u0 + de, iu1 = b.u1 - de;
        const iw = iu1 - iu0, ih = bv1 - bv0;
        const nu = Math.max(1, Math.round(iw / 26)), nv = Math.max(1, Math.round(ih / 26));
        for (let a = 0; a < nu; a++) for (let c = 0; c < nv; c++) {
          rects.push({
            u0: iu0 + (iw * a) / nu, u1: iu0 + (iw * (a + 1)) / nu,
            v0: bv0 + (ih * c) / nv, v1: bv0 + (ih * (c + 1)) / nv, front: null, interior: true,
          });
        }
      } else {
        splitRow(b.u0, b.u1, bv0, bv1, 'u-', 'u');
      }
    }
    for (const r of rects) {
      if (r.passage) {
        const [x, z] = localToWorld(b, (r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
        b.passages = b.passages || [];
        b.passages.push({ x, z, w: r.u1 - r.u0, d: r.v1 - r.v0, rot: b.rot });
        ctx.decals.push({ shape: 'rect', x, z, w: r.u1 - r.u0, d: r.v1 - r.v0, rot: b.rot, color: '#b7aa98' });
        continue;
      }
      if ((r.u1 - r.u0) < 4) continue;
      const lot = fitLot(ctx, b, r);
      if (!lot) continue;
      lot.id = lots.length;
      lot.district = b.district;
      lot.block = b.id;
      lot.rng = brng.fork(`l${rects.indexOf(r)}`);
      classifyFrontage(ctx, b, lot);
      lots.push(lot);
      b.lots.push(lot.id);
    }
  }
  ctx.lots = lots;
  ctx.log('meso.lot', `블록 ${ctx.blocks.length}개 → 필지 ${lots.length}개 (안뜰 ${lots.filter((l) => l.interior).length})`);
}

/** 사각형을 블록 마스크 안으로 수축 (가장자리 커버리지 기반) */
function fitLot(ctx, b, r) {
  const labels = ctx.blockLabels;
  let { u0, u1, v0, v1 } = r;
  const inside = (u, v) => {
    const [x, z] = localToWorld(b, u, v);
    const i = Math.floor(x + H), j = Math.floor(z + H);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return labels[j * N + i] === b.label;
  };
  const edgeCov = (side) => {
    let n = 0, ok = 0;
    if (side === 0 || side === 1) {
      const u = side === 0 ? u0 + 0.5 : u1 - 0.5;
      for (let v = v0 + 0.5; v < v1; v += 1) { n++; if (inside(u, v)) ok++; }
    } else {
      const v = side === 2 ? v0 + 0.5 : v1 - 0.5;
      for (let u = u0 + 0.5; u < u1; u += 1) { n++; if (inside(u, v)) ok++; }
    }
    return n ? ok / n : 0;
  };
  for (let it = 0; it < 60; it++) {
    if (u1 - u0 < 5 || v1 - v0 < 5) return null;
    const cov = [edgeCov(0), edgeCov(1), edgeCov(2), edgeCov(3)];
    let worst = 0;
    for (let k = 1; k < 4; k++) if (cov[k] < cov[worst]) worst = k;
    if (cov[worst] >= 0.97) break;
    if (worst === 0) u0 += 1; else if (worst === 1) u1 -= 1; else if (worst === 2) v0 += 1; else v1 -= 1;
  }
  // 전체 커버리지 확인
  let n = 0, ok = 0;
  for (let u = u0 + 0.5; u < u1; u += 2) for (let v = v0 + 0.5; v < v1; v += 2) { n++; if (inside(u, v)) ok++; }
  if (!n || ok / n < 0.9) return null;
  const w = u1 - u0, d = v1 - v0;
  if (w * d < 45) return null;
  const [x, z] = localToWorld(b, (u0 + u1) / 2, (v0 + v1) / 2);
  return { x, z, w, d, rot: b.rot, u0, u1, v0, v1, interior: !!r.interior, nominalFront: r.front, area: w * d };
}

/** 각 변 바깥 2.5m를 샘플해 접도 위계 판정. sides: [u-, u+, v-, v+] */
export function classifyFrontage(ctx, b, lot) {
  const R = ctx.road.data;
  const RANK = { [ROAD.MAIN]: 5, [ROAD.COAST]: 4, [ROAD.PLAZA]: 4, [ROAD.MINOR]: 3, [ROAD.SIDEWALK]: 3, [ROAD.ALLEY]: 2, [ROAD.BRIDGE]: 3 };
  // 변 위의 점에서 바깥 법선 방향으로 1.5/4/7/10m 샘플 → 처음 만나는 도로 위계
  const NORM = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const edgePoint = (side, t) => {
    if (side === 0) return [lot.u0, lot.v0 + (lot.v1 - lot.v0) * t];
    if (side === 1) return [lot.u1, lot.v0 + (lot.v1 - lot.v0) * t];
    if (side === 2) return [lot.u0 + (lot.u1 - lot.u0) * t, lot.v0];
    return [lot.u0 + (lot.u1 - lot.u0) * t, lot.v1];
  };
  const probe = (side, t) => {
    const [u, v] = edgePoint(side, t);
    const [nu, nv] = NORM[side];
    let best = 0;
    for (const dist of [1.5, 4, 7, 10]) {
      const [x, z] = localToWorld(b, u + nu * dist, v + nv * dist);
      const i = Math.floor(x + H), j = Math.floor(z + H);
      if (i < 0 || j < 0 || i >= N || j >= N) break;
      const r = R[j * N + i];
      if (!r) break; // 도로가 아닌 곳(다른 필지/물)을 만나면 중단
      best = Math.max(best, RANK[r] || 0);
      if (r !== ROAD.SIDEWALK) break;
    }
    return best;
  };
  const sides = [0, 1, 2, 3].map((side) => {
    const hit = [];
    for (let t = 0.15; t <= 0.86; t += 0.175) { const r = probe(side, t); if (r > 0) hit.push(r); }
    return hit.length >= 3 ? Math.max(...hit) : 0;
  });
  lot.sides = sides;
  let best = -1, bi = -1;
  const pref = { 'u-': 0, 'u+': 1, 'v-': 2, 'v+': 3 }[lot.nominalFront];
  for (let k = 0; k < 4; k++) {
    const sc = sides[k] + (k === pref ? 0.5 : 0);
    if (sides[k] > 0 && sc > best) { best = sc; bi = k; }
  }
  lot.front = bi; // -1이면 접도 없음
  lot.frontRank = bi >= 0 ? sides[bi] : 0;
  const has = sides.map((s) => s > 0);
  lot.corner = (has[0] || has[1]) && (has[2] || has[3]);
  lot.interior = lot.interior || bi < 0;
  lot.alleySides = sides.map((s) => s === 2);
}
