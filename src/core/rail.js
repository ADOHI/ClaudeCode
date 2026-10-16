// 모노레일 환상선: 구역 역을 각도순으로 잇는 고가 Catmull-Rom 루프 + 중앙역 지선.
// 고가 아래 고층 건물은 저층 '고가 밑 상가'로 바꾼다 (clearance 규칙 → 서브컬쳐 도시 질감).
import { WORLD, COLORS, ROAD, TERRAIN } from './config.js';
import { obbDistance } from './grid.js';
import { makeBuilding, PROGRAMS } from './buildings.js';

const H = WORLD.half, N = WORLD.size;
const RAIL_Y = 11;
const cid = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

export function genRail(ctx) {
  const rng = ctx.rng.fork('rail');
  const stations = [];
  const want = ['commercial', 'residential', 'harbor', 'ruins'];
  for (const d of ctx.districts) {
    if (!want.includes(d.type)) continue;
    // 구역 시드에 가장 가까운 간선 교차점
    let best = null, bd = Infinity;
    for (const n of ctx.nodes) {
      if (n.district !== d.id || n.mainCount < 1) continue;
      const dd = Math.hypot(n.x - d.x, n.z - d.z);
      const r = Math.hypot(n.x, n.z);
      if (r < 150) continue;
      if (dd < bd) { bd = dd; best = n; }
    }
    if (best) stations.push({ x: best.x, z: best.z, district: d.id, name: `${d.name}역` });
  }
  // 학원 정문 앞 역 1개 (가장 바깥쪽 학원 제외, 최소 하나)
  const acad = ctx.districts.filter((d) => d.def.campus && d.gate);
  if (acad.length) {
    const a = acad[rng.int(0, acad.length - 1)];
    const gx = a.gate.x + a.gate.dir[0] * 30, gz = a.gate.z + a.gate.dir[1] * 30;
    stations.push({ x: gx, z: gz, district: a.id, name: `${a.name} 앞역` });
  }
  if (stations.length < 3) return;
  stations.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  // 이웃 역 간격이 너무 좁으면 병합
  const st = [];
  for (const s of stations) if (!st.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 110)) st.push(s);
  const P = st.map((s) => [s.x, s.z]);
  const path = [];
  const n = P.length;
  for (let k = 0; k < n; k++) {
    const p0 = P[(k - 1 + n) % n], p1 = P[k], p2 = P[(k + 1) % n], p3 = P[(k + 2) % n];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const segs = Math.max(4, Math.round(L / 4));
    for (let s = 0; s < segs; s++) path.push(catmull(p0, p1, p2, p3, s / segs));
  }
  path.push(path[0]);
  // 중앙역 지선: 광장 가장자리 → 루프의 가장 가까운 점
  let ci = 0, cd = Infinity;
  for (let k = 0; k < path.length; k++) { const d = Math.hypot(path[k][0], path[k][1]); if (d < cd) { cd = d; ci = k; } }
  const ca = Math.atan2(path[ci][1], path[ci][0]);
  const cs = [Math.cos(ca) * 74, Math.sin(ca) * 74];
  const spur = [];
  const sl = Math.hypot(path[ci][0] - cs[0], path[ci][1] - cs[1]);
  for (let s = 0; s <= sl; s += 4) spur.push([cs[0] + ((path[ci][0] - cs[0]) * s) / sl, cs[1] + ((path[ci][1] - cs[1]) * s) / sl]);
  st.push({ x: cs[0], z: cs[1], district: 0, name: '센트럴역', spur: true });

  const lines = [path, spur];
  ctx.rail = { lines, stations: st, y: RAIL_Y };
  // 궤도 + 교각
  for (const line of lines) {
    let acc = 0;
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k], b = line[k + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.add({ shape: 'box', x: (a[0] + b[0]) / 2, y: RAIL_Y - 1.2, z: (a[1] + b[1]) / 2, w: L + 0.3, h: 1.2, d: 3.4, rot, color: COLORS.rail, mat: 'std', cat: 'rail', kind: 'track', rule: 'meso.rail', district: -1, solid: false });
      acc += L;
      if (acc > 26) {
        const id = cid(a[0], a[1]);
        const r = id >= 0 ? ctx.road.data[id] : 0;
        if (r !== ROAD.MAIN && r !== ROAD.MINOR && r !== ROAD.COAST && r !== ROAD.BRIDGE) {
          acc = 0;
          ctx.add({ shape: 'cyl', x: a[0], y: 0, z: a[1], w: 1.8, h: RAIL_Y - 1.2, d: 1.8, rot: 0, color: COLORS.railPillar, mat: 'std', cat: 'rail', kind: 'pillar', rule: 'meso.rail', district: -1, solid: true });
        }
      }
    }
  }
  // 역: 승강장 + 지붕 + 계단 경사로
  for (const s of st) {
    const line = s.spur ? spur : path;
    let k = 0, bd = Infinity;
    for (let m = 0; m < line.length; m++) { const d = Math.hypot(line[m][0] - s.x, line[m][1] - s.z); if (d < bd) { bd = d; k = m; } }
    const a = line[Math.max(0, k - 2)], b = line[Math.min(line.length - 1, k + 2)];
    const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const [px, pz] = line[k];
    s.x = px; s.z = pz; s.rot = rot;
    const ox = Math.cos(rot + Math.PI / 2), oz = Math.sin(rot + Math.PI / 2);
    const why = '역 = Node. 빠른 이동 지점, 보행 흐름의 거점';
    ctx.add({ shape: 'box', x: px + ox * 4.5, y: RAIL_Y - 1.4, z: pz + oz * 4.5, w: 40, h: 1.4, d: 5.5, rot, color: '#d7dde6', mat: 'std', cat: 'rail', kind: 'platform', rule: 'meso.rail', district: s.district, solid: true, deck: true, name: s.name, why });
    ctx.add({ shape: 'box', x: px + ox * 2, y: RAIL_Y + 3.6, z: pz + oz * 2, w: 42, h: 0.35, d: 11, rot, color: COLORS.station, mat: 'std', cat: 'rail', kind: 'canopy', rule: 'meso.rail', district: s.district, solid: false });
    ctx.add({ shape: 'box', x: px + ox * 6.8 + Math.cos(rot) * 12, y: RAIL_Y, z: pz + oz * 6.8 + Math.sin(rot) * 12, w: 3, h: 1.2, d: 0.4, rot, color: '#29e0d0', mat: 'glow', cat: 'rail', kind: 'stationsign', rule: 'meso.rail', district: s.district, solid: false, name: s.name });
    // 계단 경사로 (지면 → 승강장)
    const rx = px + ox * 8.8 - Math.cos(rot) * 6, rz = pz + oz * 8.8 - Math.sin(rot) * 6;
    ctx.add({ shape: 'ramp', x: rx, y: 0, z: rz, w: 24, h: RAIL_Y - 1.4 + 1.4, d: 3, rot: rot + Math.PI, color: '#b9c2cf', mat: 'std', cat: 'rail', kind: 'stairs', rule: 'meso.rail', district: s.district, solid: true });
    for (const e of [-1, 1]) {
      ctx.add({ shape: 'cyl', x: px + ox * 4.5 + Math.cos(rot) * 17 * e, y: 0, z: pz + oz * 4.5 + Math.sin(rot) * 17 * e, w: 1.6, h: RAIL_Y - 1.4, d: 1.6, rot: 0, color: COLORS.railPillar, mat: 'std', cat: 'rail', kind: 'pillar', rule: 'meso.rail', district: s.district, solid: true });
    }
    const footX = rx - Math.cos(rot + Math.PI) * 13, footZ = rz - Math.sin(rot + Math.PI) * 13;
    s.foot = { x: footX, z: footZ };
    ctx.addPoi({ x: footX, z: footZ, name: s.name, type: 'station', tier: 1, district: s.district, rule: 'intent.fasttravel', why });
    ctx.hubs.push({ x: footX, z: footZ, w: 1.5, name: s.name });
    s.obb = { x: px + ox * 4.5, z: pz + oz * 4.5, w: 44, d: 12, rot };
    s.ramp = { x: rx, z: rz, w: 26, d: 5, rot };
  }
  // 고가 클리어런스: 궤도와 겹치는 높은 건물 → 고가 밑 상가 / 역·경사로와 겹치는 건물 제거
  let converted = 0, removed = 0;
  const near = (b) => {
    for (const line of lines) {
      for (let k = 0; k < line.length - 1; k += 1) {
        const a = line[k], c = line[k + 1];
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        if (Math.abs(mx - b.x) > 60 || Math.abs(mz - b.z) > 60) continue;
        const seg = { x: mx, z: mz, w: Math.hypot(c[0] - a[0], c[1] - a[1]) + 0.5, d: 4.5, rot: Math.atan2(c[1] - a[1], c[0] - a[0]) };
        if (obbDistance(seg, b) < 0.6) return true;
      }
    }
    return false;
  };
  for (const b of ctx.buildings.slice()) {
    if (b.deleted) continue;
    const hitStation = st.some((s) => obbDistance(s.obb, b) < 1 || obbDistance(s.ramp, b) < 1);
    if (hitStation) { ctx.removeBuilding(b); removed++; continue; }
    if (b.h <= RAIL_Y - 2.5) continue;
    if (!near(b)) continue;
    if (b.campus || b.landmark) { continue; }
    ctx.removeBuilding(b);
    if (b.w * b.d > 30) {
      const rngB = rng.fork(`g${b.id}`);
      const nb = makeBuilding(ctx, { x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, floors: 1, prog: 'gaado', district: b.district, front: b.front, sides: b.sides, lot: b.lot, rule: 'meso.rail', why: '고가 밑 클리어런스 → 저층 상가로 전환' }, rngB);
      converted++;
      if (converted % 3 === 1) ctx.addPoi({ x: nb.x, z: nb.z, name: '고가 밑 포장마차', type: 'shop', tier: 2, district: b.district, rule: 'meso.rail', why: '모노레일 고가 아래 저층화 규칙의 부산물' });
    } else removed++;
  }
  // 역/경사로와 겹치는 소품·나무 제거
  for (const e of ctx.entities) {
    if (e.deleted || e.cat === 'rail' || e.cat === 'landmark') continue;
    if (e.y > 1) continue;
    for (const s of st) {
      if (obbDistance(s.ramp, { x: e.x, z: e.z, w: e.w, d: e.d, rot: e.rot || 0 }) < 0.3) { e.deleted = true; break; }
    }
  }
  void PROGRAMS; void TERRAIN;
  ctx.log('meso.rail', `역 ${st.length}개, 루프 ${(path.length * 4).toFixed(0)}m, 고가 밑 전환 ${converted}, 제거 ${removed}`);
}
