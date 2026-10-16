// 공원 문법: 호수 + 세계수 언덕(랜드마크) + 명소들을 MST+순환 간선 산책로로 연결.
import { Noise2D } from './rng.js';
import { TERRAIN, ROAD, ZONE, WORLD, COLORS } from './config.js';
import { addTree } from './city.js';
import { stampPath } from './campus.js';

const H = WORLD.half, N = WORLD.size;
const cid = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

export function genPark(ctx) {
  const d = ctx.districts.find((x) => x.def.park);
  if (!d || !d.core) return;
  const rng = ctx.rng.fork('park');
  const nz = new Noise2D(rng);
  const Z = ctx.zone.data, OW = ctx.zoneOwner, T = ctx.terrain.data, R = ctx.road.data;
  const inPark = (x, z) => {
    const id = cid(x, z);
    return id >= 0 && Z[id] === ZONE.PARK && OW[id] === d.id && T[id] === TERRAIN.LAND;
  };
  // 공원 셀 + 경계까지 거리
  const cells = [];
  let sx = 0, sz = 0;
  for (let id = 0; id < N * N; id += 1) {
    if (Z[id] === ZONE.PARK && OW[id] === d.id && !R[id]) { cells.push(id); sx += id % N; sz += (id / N) | 0; }
  }
  if (cells.length < 2000) return;
  const cx = sx / cells.length - H + 0.5, cz = sz / cells.length - H + 0.5;
  const size = Math.sqrt(cells.length);
  ctx.decals.push({ shape: 'mask', zone: ZONE.PARK, owner: d.id, color: COLORS.tree });

  // 1) 호수: 중심에서 약간 비켜난 노이즈 타원
  const la = rng.range(0, Math.PI * 2);
  const lx = cx + Math.cos(la) * size * 0.16, lz = cz + Math.sin(la) * size * 0.16;
  const rx = size * rng.range(0.15, 0.2), rz = size * rng.range(0.11, 0.15), lr = rng.range(0, Math.PI);
  let lakeCells = 0;
  for (const id of cells) {
    const x = (id % N) - H + 0.5 - lx, z = ((id / N) | 0) - H + 0.5 - lz;
    const u = x * Math.cos(lr) + z * Math.sin(lr), v = -x * Math.sin(lr) + z * Math.cos(lr);
    const r = Math.hypot(u / rx, v / rz) + 0.18 * nz.noise(u / 18, v / 18);
    if (r < 1 && ctx.distBorder[id] > 18) { T[id] = TERRAIN.LAKE; lakeCells++; }
  }
  const lake = { x: lx, z: lz, rx, rz, rot: lr };
  // 2) 세계수 언덕: 호수에서 가장 먼 공원 내부
  let best = null, bs = -1;
  for (let t = 0; t < 400; t++) {
    const id = cells[rng.int(0, cells.length - 1)];
    if (ctx.distBorder[id] < 30) continue;
    const x = (id % N) - H + 0.5, z = ((id / N) | 0) - H + 0.5;
    const s = Math.hypot(x - lx, z - lz) - Math.max(rx, rz) + ctx.distBorder[id] * 0.5;
    if (s > bs) { bs = s; best = { x, z }; }
  }
  const feats = [];
  if (best) {
    const why = '호수 반대편 언덕 — 공원 어디서든 보이는 녹색 Weenie';
    for (let k = 0; k < 6; k++) {
      ctx.add({ shape: 'cyl', x: best.x, y: k * 0.5, z: best.z, w: 34 - k * 4.4, h: 0.5, d: 34 - k * 4.4, rot: 0, color: k % 2 ? '#8fc77a' : '#86bf70', mat: 'std', cat: 'terrain', kind: 'hill', rule: 'meso.park', district: d.id, solid: true });
    }
    ctx.add({ shape: 'cyl', x: best.x, y: 3, z: best.z, w: 3.6, h: 16, d: 3.6, rot: 0, color: '#6e4f33', mat: 'std', cat: 'landmark', kind: 'worldtree', rule: 'intent.landmark', district: d.id, solid: true, name: '미라이의 세계수', why });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const r = k === 0 ? 0 : 6;
      ctx.add({ shape: 'sphere', x: best.x + Math.cos(a) * r, y: 14 + (k ? 0 : 6), z: best.z + Math.sin(a) * r, w: 18, h: 14, d: 18, rot: 0, color: k ? '#5fae5a' : '#6cc06a', mat: 'std', cat: 'landmark', kind: 'canopy', rule: 'intent.landmark', district: d.id, solid: false });
    }
    ctx.add({ shape: 'oct', x: best.x, y: 31, z: best.z, w: 2, h: 3, d: 2, rot: 0, color: '#c8ffb0', mat: 'glow', cat: 'landmark', kind: 'spark', rule: 'intent.landmark', district: d.id, solid: false });
    ctx.addLandmark({ name: '미라이의 세계수', x: best.x, z: best.z, h: 34, district: d.id, kind: 'worldtree', why });
    ctx.addPoi({ x: best.x + 18, z: best.z, name: '세계수 언덕', type: 'anchor', tier: 1, district: d.id, rule: 'meso.park', why });
    feats.push({ x: best.x + 18, z: best.z, name: 'hill' });
  }
  // 3) 명소: 정자, 선착장, 놀이터, 야외무대 (서로 떨어지게)
  const spots = [
    { key: 'gazebo', name: '호숫가 정자', lakeside: true },
    { key: 'dock', name: '보트 선착장', lakeside: true },
    { key: 'play', name: '놀이터' },
    { key: 'stage', name: '야외 무대' },
    { key: 'flower', name: '화원' },
  ];
  for (const s of spots) {
    let pos = null;
    for (let t = 0; t < 300 && !pos; t++) {
      let x, z;
      if (s.lakeside) {
        const a = rng.range(0, Math.PI * 2);
        const u = Math.cos(a) * (rx + 7), v = Math.sin(a) * (rz + 7);
        x = lx + u * Math.cos(lr) - v * Math.sin(lr);
        z = lz + u * Math.sin(lr) + v * Math.cos(lr);
      } else {
        const id = cells[rng.int(0, cells.length - 1)];
        x = (id % N) - H + 0.5; z = ((id / N) | 0) - H + 0.5;
      }
      const id = cid(x, z);
      if (!inPark(x, z) || ctx.distBorder[id] < 12) continue;
      if (feats.some((f) => Math.hypot(f.x - x, f.z - z) < 40)) continue;
      if (best && Math.hypot(best.x - x, best.z - z) < 30) continue;
      pos = { x, z };
    }
    if (!pos) continue;
    feats.push({ ...pos, name: s.key });
    const rule = 'meso.park';
    if (s.key === 'gazebo') {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.add({ shape: 'cyl', x: pos.x + Math.cos(a) * 3, y: 0, z: pos.z + Math.sin(a) * 3, w: 0.3, h: 2.8, d: 0.3, rot: 0, color: '#8a5a3a', mat: 'std', cat: 'prop', kind: 'post', rule, district: d.id, solid: true });
      }
      ctx.add({ shape: 'cone', x: pos.x, y: 2.8, z: pos.z, w: 8.5, h: 2.4, d: 8.5, rot: 0, color: '#a5442f', mat: 'std', cat: 'prop', kind: 'gazebo', rule, district: d.id, solid: false, sides: 6, name: s.name });
    } else if (s.key === 'dock') {
      const a = Math.atan2(lz - pos.z, lx - pos.x);
      ctx.add({ shape: 'box', x: pos.x + Math.cos(a) * 6, y: -0.1, z: pos.z + Math.sin(a) * 6, w: 14, h: 0.6, d: 3, rot: a, color: COLORS.pier, mat: 'std', cat: 'prop', kind: 'dock', rule, district: d.id, solid: true, walkOverWater: true, name: s.name });
      for (let k = 0; k < 3; k++) ctx.add({ shape: 'box', x: pos.x + Math.cos(a) * (10 + k * 3) + Math.cos(a + Math.PI / 2) * 3, y: 0, z: pos.z + Math.sin(a) * (10 + k * 3) + Math.sin(a + Math.PI / 2) * 3, w: 2.6, h: 0.6, d: 1.2, rot: a, color: rng.pick(['#ffffff', '#ff9ec4', '#9ee7ff']), mat: 'std', cat: 'prop', kind: 'boat', rule, district: d.id, solid: false });
    } else if (s.key === 'play') {
      ctx.decals.push({ shape: 'circle', x: pos.x, z: pos.z, w: 18, d: 18, color: '#e3c99a' });
      ctx.add({ shape: 'box', x: pos.x - 3, y: 0, z: pos.z, w: 4, h: 2.4, d: 0.2, rot: 0.3, color: '#e94f4f', mat: 'std', cat: 'prop', kind: 'swing', rule, district: d.id, solid: true });
      ctx.add({ shape: 'ramp', x: pos.x + 3, y: 0, z: pos.z + 2, w: 4, h: 1.8, d: 1, rot: 1.2, color: '#4f9de9', mat: 'std', cat: 'prop', kind: 'slide', rule, district: d.id, solid: true });
      ctx.add({ shape: 'sphere', x: pos.x, y: 0, z: pos.z - 4, w: 3, h: 2, d: 3, rot: 0, color: '#f2c94c', mat: 'std', cat: 'prop', kind: 'dome', rule, district: d.id, solid: true });
    } else if (s.key === 'stage') {
      ctx.add({ shape: 'box', x: pos.x, y: 0, z: pos.z, w: 12, h: 1.1, d: 8, rot: rng.range(0, 3), color: '#c9b8a0', mat: 'std', cat: 'prop', kind: 'stage', rule, district: d.id, solid: true, name: s.name });
    } else if (s.key === 'flower') {
      for (let k = 0; k < 5; k++) {
        ctx.decals.push({ shape: 'circle', x: pos.x + rng.range(-8, 8), z: pos.z + rng.range(-8, 8), w: rng.range(3, 6), d: rng.range(3, 6), color: rng.pick(['#ff9ec4', '#ffd23d', '#c58cff', '#ff7a5c']) });
      }
    }
    ctx.addPoi({ x: pos.x, z: pos.z, name: s.name, type: 'micro', tier: 2, district: d.id, rule, why: s.lakeside ? '호숫가 순환로 위 휴식 노드' : '산책로 MST의 잎 노드' });
  }
  // 4) 노드: 공원 입구 + 명소 + 호수 순환 링
  const nodes = [];
  const R2 = ctx.road.data;
  // 입구: 공원 경계에 붙은 도로 셀을 80m 간격으로
  for (let t = 0; t < cells.length; t += 7) {
    const id = cells[t];
    if (ctx.distBorder[id] > 13.5) continue;
    const x = (id % N) - H + 0.5, z = ((id / N) | 0) - H + 0.5;
    let road = false;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) { const q = cid(x + dx, z + dz); if (q >= 0 && R2[q] && R2[q] !== ROAD.PARK_PATH) road = true; }
    if (!road) continue;
    if (nodes.some((n) => Math.hypot(n.x - x, n.z - z) < 75)) continue;
    nodes.push({ x, z, kind: 'entrance' });
  }
  for (const f of feats) nodes.push({ x: f.x, z: f.z, kind: 'feature' });
  const ring = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const u = Math.cos(a) * (rx + 10), v = Math.sin(a) * (rz + 10);
    const x = lx + u * Math.cos(lr) - v * Math.sin(lr), z = lz + u * Math.sin(lr) + v * Math.cos(lr);
    if (!inPark(x, z)) continue;
    ring.push(nodes.length);
    nodes.push({ x, z, kind: 'ring' });
  }
  const edges = [];
  for (let k = 0; k < ring.length; k++) edges.push([ring[k], ring[(k + 1) % ring.length]]);
  // MST (Prim) — 호수 통과 간선은 비용 3배
  const crossCost = (a, b) => {
    let wet = 0;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < L; s += 3) {
      const t = s / L;
      const id = cid(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (id >= 0 && T[id] === TERRAIN.LAKE) wet += 3;
    }
    return L + wet * 3;
  };
  const inTree = new Set([0]);
  while (inTree.size < nodes.length) {
    let bestE = null, be = Infinity;
    for (const a of inTree) for (let b = 0; b < nodes.length; b++) {
      if (inTree.has(b)) continue;
      const c = crossCost(nodes[a], nodes[b]);
      if (c < be) { be = c; bestE = [a, b]; }
    }
    if (!bestE) break;
    inTree.add(bestE[1]);
    edges.push(bestE);
  }
  // 순환 간선 2개 추가 (막다른 산책 방지 — Dormans 사이클)
  const leaves = nodes.map((_, i) => i).filter((i) => edges.filter((e) => e[0] === i || e[1] === i).length === 1);
  for (let k = 0; k < Math.min(3, leaves.length); k++) {
    const a = leaves[k];
    let bb = -1, bd = Infinity;
    for (let b = 0; b < nodes.length; b++) {
      if (b === a || edges.some((e) => (e[0] === a && e[1] === b) || (e[1] === a && e[0] === b))) continue;
      const c = crossCost(nodes[a], nodes[b]);
      if (c < bd && c < 180) { bd = c; bb = b; }
    }
    if (bb >= 0) edges.push([a, bb]);
  }
  ctx.parkPaths = [];
  for (const [a, b] of edges) {
    const A = nodes[a], B = nodes[b];
    // 완만한 곡선: 중점 수직 변위
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const off = nz.noise(mx / 40, mz / 40) * L * 0.15;
    const px = -(B.z - A.z) / (L || 1), pz = (B.x - A.x) / (L || 1);
    const M = [mx + px * off, mz + pz * off];
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const x = (1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * M[0] + t * t * B.x;
      const z = (1 - t) * (1 - t) * A.z + 2 * (1 - t) * t * M[1] + t * t * B.z;
      pts.push([x, z]);
    }
    for (let k = 0; k < pts.length - 1; k++) {
      stampPath(ctx, pts[k], pts[k + 1], 3.4, ROAD.PARK_PATH, (x, z) => {
        const id = cid(x, z);
        return id >= 0 && Z[id] === ZONE.PARK && OW[id] === d.id;
      });
    }
    ctx.parkPaths.push(pts);
  }
  // 호수 위 경로 셀 → 목교
  for (const id of cells) if (T[id] === TERRAIN.LAKE && R2[id] === ROAD.PARK_PATH) R2[id] = ROAD.BRIDGE;
  // 5) 나무: 노이즈 밀도의 포아송 (숲 패치 / 잔디밭)
  const placed = [];
  for (let t = 0; t < 5000 && placed.length < 260; t++) {
    const id = cells[rng.int(0, cells.length - 1)];
    const x = (id % N) - H + 0.5, z = ((id / N) | 0) - H + 0.5;
    if (T[id] !== TERRAIN.LAND || R2[id]) continue;
    const dens = nz.fbm(x / 70, z / 70, 2);
    if (dens < -0.05) continue;
    const r = dens > 0.3 ? 6 : 9;
    if (placed.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < r * r)) continue;
    if (feats.some((f) => Math.hypot(f.x - x, f.z - z) < 12)) continue;
    if (best && Math.hypot(best.x - x, best.z - z) < 20) continue;
    let nearPath = false;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const q = cid(x + dx, z + dz); if (q >= 0 && R2[q]) nearPath = true; }
    if (nearPath) continue;
    placed.push([x, z]);
    addTree(ctx, x, z, rng, d.id, 'meso.park', ctx.distRiver[id] < 40 || rng.chance(0.08));
  }
  ctx.park = { d, lake, tree: best, nodes, edges };
  ctx.hubs.push(...nodes.filter((n) => n.kind === 'feature').slice(0, 2).map((n) => ({ x: n.x, z: n.z, w: 0.7, name: '공원 명소' })));
  ctx.log('meso.park', `호수 ${lakeCells}m², 경로 간선 ${edges.length} (사이클 포함), 나무 ${placed.length}`);
}
