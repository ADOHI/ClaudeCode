// 마이크로 규칙: 가로등·가로수·정류장·자판기·벤치·주차·횡단보도·낙서 경사·빨래줄·벚꽃 산책로.
// 각 규칙은 '어디에, 왜'가 명확한 국소 조건으로 정의된다 (규칙 id는 config.RULES).
import { ROAD, TERRAIN, WORLD, COLORS } from './config.js';
import { PointHash, forEachCellInOBB, Grid } from './grid.js';
import { faceInfo, jitterColor } from './buildings.js';
import { addTree, addCar } from './city.js';

const H = WORLD.half, N = WORLD.size;
const cid = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

export function buildOccupancy(ctx) {
  const g = new Grid(N, N, 1, -H, -H, Uint8Array);
  for (const e of ctx.entities) {
    if (e.deleted || !e.solid || e.y > 1.0) continue;
    forEachCellInOBB(g, { x: e.x, z: e.z, w: e.w, d: e.d, rot: e.shape === 'box' || e.shape === 'ramp' || e.shape === 'gable' ? e.rot || 0 : 0 }, (id) => { g.data[id] = 1; }, 0.3);
  }
  ctx.occ1 = g;
  return g;
}

export function genProps(ctx) {
  const rng = ctx.rng.fork('props');
  const occ = buildOccupancy(ctx).data;
  const R = ctx.road.data, T = ctx.terrain.data, D = ctx.district.data;
  const ph = new PointHash(8);
  const free = (x, z, r) => {
    const id = cid(x, z);
    if (id < 0 || occ[id]) return false;
    return !ph.query(x, z, r, (p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (r + p.r) ** 2);
  };
  const mark = (x, z, r) => ph.add(x, z, { x, z, r });
  const nodeHash = new PointHash(24);
  for (const n of ctx.nodes) nodeHash.add(n.x, n.z, n);
  const nearNode = (x, z, r) => nodeHash.query(x, z, r, (n) => (n.x - x) ** 2 + (n.z - z) ** 2 < r * r);
  const dist = (p) => (p >= 0 ? ctx.districts[D[p]] : null);
  let lamps = 0, trees = 0, stops = 0, vend = 0, cars = 0, cw = 0;

  const walk = (line, spacing, offset, fn) => {
    let acc = spacing * 0.5;
    for (let k = 0; k < line.pts.length - 1; k++) {
      const a = line.pts[k], b = line.pts[k + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-3) continue;
      const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
      let s = spacing - acc;
      while (s <= L) {
        const x = a.x + dx * s, z = a.z + dz * s;
        if (!a.bridge && !b.bridge) fn(x, z, dx, dz);
        s += spacing;
      }
      acc = (acc + L) % spacing;
    }
  };

  for (const line of ctx.roadLines) {
    if (line.removed || line.level === 3) continue;
    const hw = line.width / 2, sw = line.sidewalk;
    const main = line.level === 1 || line.level === 4;
    let side = 1;
    // 가로등
    walk(line, main ? 22 : 28, 0, (x, z, dx, dz) => {
      side = -side;
      const sides = main ? [side, -side] : [side];
      for (const s of sides) {
        const px = x - dz * s * (hw + sw * 0.35), pz = z + dx * s * (hw + sw * 0.35);
        const id = cid(px, pz);
        if (id < 0 || R[id] !== ROAD.SIDEWALK || nearNode(px, pz, hw + 5) || !free(px, pz, 1)) continue;
        mark(px, pz, 1);
        const d = dist(id);
        ctx.add({ shape: 'cyl', x: px, y: 0, z: pz, w: 0.22, h: 6, d: 0.22, rot: 0, color: COLORS.lamp, mat: 'std', cat: 'prop', kind: 'lamp', rule: 'micro.lamp', district: d ? d.id : -1, solid: true });
        ctx.add({ shape: 'box', x: px + dz * s * 0.8, y: 5.8, z: pz - dx * s * 0.8, w: 1.8, h: 0.15, d: 0.3, rot: Math.atan2(-dx * s, dz * s), color: COLORS.lamp, mat: 'std', cat: 'prop', kind: 'lamparm', rule: 'micro.lamp', district: d ? d.id : -1, solid: false });
        ctx.add({ shape: 'sphere', x: px + dz * s * 1.5, y: 5.45, z: pz - dx * s * 1.5, w: 0.6, h: 0.4, d: 0.6, rot: 0, color: COLORS.lampLight, mat: 'glow', cat: 'prop', kind: 'lamplight', rule: 'micro.lamp', district: d ? d.id : -1, solid: false });
        lamps++;
      }
    });
    // 가로수: 간선 12m, 생활가로(주거) 16m 확률
    if (main || line.level === 2) {
      walk(line, main ? 12 : 16, 6, (x, z, dx, dz) => {
        for (const s of [-1, 1]) {
          const px = x - dz * s * (hw + sw * 0.62), pz = z + dx * s * (hw + sw * 0.62);
          const id = cid(px, pz);
          if (id < 0 || R[id] !== ROAD.SIDEWALK || nearNode(px, pz, hw + 7) || !free(px, pz, 2.2)) continue;
          const d = dist(id);
          if (!main && !(d && (d.type === 'residential' || d.def.campus) && rng.chance(0.6))) continue;
          if (d && (d.type === 'harbor' || d.type === 'ruins') && rng.chance(0.7)) continue;
          mark(px, pz, 2.2);
          const sak = ctx.distRiver[id] < 45 || (d && d.type === 'trad_academy' && rng.chance(0.5));
          addTree(ctx, px, pz, rng, d ? d.id : -1, 'micro.tree', sak, 0.85);
          trees++;
        }
      });
    }
    // 버스 정류장: 흐름 높은 간선 ~170m
    if (line.level === 1) {
      let acc = 0, last = null;
      for (let k = 1; k < line.pts.length; k++) {
        const a = line.pts[k - 1], b = line.pts[k];
        acc += Math.hypot(b.x - a.x, b.z - a.z);
        if (acc < 170 || b.bridge) continue;
        const fl = ctx.roadFlow.at(b.x, b.z);
        if (fl < 0.25) continue;
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const ux = dx / L, uz = dz / L;
        const s = rng.sign();
        const px = b.x - uz * s * (hw + sw * 0.55), pz = b.z + ux * s * (hw + sw * 0.55);
        const id = cid(px, pz);
        if (id < 0 || R[id] !== ROAD.SIDEWALK || nearNode(px, pz, hw + 10) || !free(px, pz, 3)) continue;
        if (last && Math.hypot(last[0] - px, last[1] - pz) < 120) continue;
        acc = 0;
        last = [px, pz];
        mark(px, pz, 3.5);
        const rot = Math.atan2(uz, ux);
        const d = dist(id);
        const did = d ? d.id : -1;
        const why = `흐름 ${(fl * 100).toFixed(0)}% 간선, 직전 정류장에서 170m+`;
        ctx.add({ shape: 'box', x: px, y: 2.5, z: pz, w: 4.2, h: 0.18, d: 1.8, rot, color: COLORS.busstop, mat: 'std', cat: 'prop', kind: 'busstop', rule: 'micro.busstop', district: did, solid: false, name: '버스정류장', why });
        ctx.add({ shape: 'box', x: px - uz * s * 0.85, y: 0, z: pz + ux * s * 0.85, w: 4.2, h: 2.5, d: 0.1, rot, color: '#b6d7f2', mat: 'glass', cat: 'prop', kind: 'busstop_wall', rule: 'micro.busstop', district: did, solid: true });
        ctx.add({ shape: 'box', x: px - uz * s * 0.4, y: 0, z: pz + ux * s * 0.4, w: 3, h: 0.5, d: 0.5, rot, color: COLORS.bench, mat: 'std', cat: 'prop', kind: 'bench', rule: 'micro.busstop', district: did, solid: true });
        ctx.add({ shape: 'cyl', x: px + ux * 2.8, y: 0, z: pz + uz * 2.8, w: 0.12, h: 2.8, d: 0.12, rot: 0, color: '#555b66', mat: 'std', cat: 'prop', kind: 'pole', rule: 'micro.busstop', district: did, solid: false });
        ctx.add({ shape: 'cyl', x: px + ux * 2.8, y: 2.6, z: pz + uz * 2.8, w: 0.7, h: 0.08, d: 0.7, rot: rot, color: COLORS.busstop, mat: 'glow', cat: 'prop', kind: 'busstop_sign', rule: 'micro.busstop', district: did, solid: false, rx: Math.PI / 2 });
        ctx.addPoi({ x: px, z: pz, name: '버스정류장', type: 'micro', tier: 3, district: did, rule: 'micro.busstop', why });
        stops++;
        // 자판기: 정류장 옆
        const vx = px - ux * 3.2 - uz * s * 0.6, vz = pz - uz * 3.2 + ux * s * 0.6;
        if (free(vx, vz, 0.8)) {
          mark(vx, vz, 0.8);
          addVending(ctx, vx, vz, rot + (s > 0 ? Math.PI / 2 : -Math.PI / 2), rng, did, '정류장 옆 자판기 — 기다림의 리듬');
          vend++;
        }
      }
    }
    // 노상 주차: 생활가로
    if (line.level === 2) {
      walk(line, 9, 0, (x, z, dx, dz) => {
        if (!rng.chance(0.28)) return;
        const s = rng.sign();
        const px = x - dz * s * (hw - 1.2), pz = z + dx * s * (hw - 1.2);
        if (nearNode(px, pz, 14) || !free(px, pz, 2.6)) return;
        const id = cid(px, pz);
        if (id < 0 || R[id] !== ROAD.MINOR) return;
        const d = dist(id);
        if (d && d.def.campus && rng.chance(0.5)) return;
        mark(px, pz, 2.6);
        addCar(ctx, px, pz, Math.atan2(dz, dx), rng, d ? d.id : -1, 'micro.car');
        cars++;
      });
    }
  }
  // 골목 입구 자판기 + 주거구 빨래줄 + 아케이드 지붕
  let laundry = 0, arcades = 0;
  for (const line of ctx.roadLines) {
    if (!line.alley || line.removed) continue;
    const d = ctx.districts[line.district];
    const pts = line.pts;
    const ends = line.deadEnd ? [0] : [0, pts.length - 1];
    for (const e of ends) {
      if (!rng.chance(0.55)) continue;
      const p = pts[e], q = pts[e === 0 ? Math.min(3, pts.length - 1) : Math.max(0, pts.length - 4)];
      const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L, s = rng.sign();
      const vx = p.x + ux * 3.5 - uz * s * 1.45, vz = p.z + uz * 3.5 + ux * s * 1.45;
      if (!free(vx, vz, 0.7)) continue;
      mark(vx, vz, 0.8);
      addVending(ctx, vx, vz, Math.atan2(uz, ux) + (s > 0 ? Math.PI / 2 : -Math.PI / 2), rng, d.id, '골목 입구 자판기 — 골목으로 들어가는 시선의 미끼');
      vend++;
    }
    const L = pts.length;
    if (d.type === 'residential' || d.type === 'ruins') {
      for (let k = 4; k < L - 4; k += 7) {
        if (!rng.chance(0.5)) continue;
        const a = pts[k], b = pts[k + 1];
        const rot = Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
        const y = rng.range(5, 7.5);
        ctx.add({ shape: 'box', x: a.x, y, z: a.z, w: 4.8, h: 0.04, d: 0.04, rot, color: '#eeeeee', mat: 'std', cat: 'prop', kind: 'laundryline', rule: 'micro.laundry', district: d.id, solid: false });
        for (let c = 0; c < 3; c++) {
          const off = (c - 1) * 1.3;
          ctx.add({ shape: 'box', x: a.x + Math.cos(rot) * off, y: y - 0.75, z: a.z + Math.sin(rot) * off, w: 0.55, h: 0.75, d: 0.05, rot, color: rng.pick(['#ff9ec4', '#9ee7ff', '#ffffff', '#ffe28a', '#b9f5c4']), mat: 'std', cat: 'prop', kind: 'cloth', rule: 'micro.laundry', district: d.id, solid: false });
        }
        laundry++;
      }
    }
    if (line.covered) {
      // 상점가 아케이드 지붕 (쇼텐가이) + 등불
      for (let k = 0; k < L - 1; k += 1) {
        const a = pts[k], b = pts[k + 1];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        const rot = Math.atan2(b.z - a.z, b.x - a.x);
        ctx.add({ shape: 'box', x: (a.x + b.x) / 2, y: 7.5, z: (a.z + b.z) / 2, w: seg + 0.05, h: 0.2, d: 6.5, rot, color: '#cfe3f0', mat: 'glass', cat: 'prop', kind: 'arcaderoof', rule: 'meso.alley', district: d.id, solid: false });
        if (k % 3 === 0) ctx.add({ shape: 'sphere', x: a.x, y: 6.6, z: a.z, w: 0.7, h: 0.9, d: 0.7, rot: 0, color: '#ff6b5e', mat: 'glow', cat: 'prop', kind: 'lantern', rule: 'meso.alley', district: d.id, solid: false });
      }
      const m = pts[Math.floor(L / 2)];
      ctx.addPoi({ x: m.x, z: m.z, name: '상점가 아케이드', type: 'anchor', tier: 1, district: d.id, rule: 'meso.alley', why: '블록 관통 골목을 지붕 덮인 상점가로 — 비 오는 날의 동선' });
      ctx.hubs.push({ x: m.x, z: m.z, w: 1.2, name: '아케이드' });
      arcades++;
    }
  }
  // 횡단보도: 간선 교차부 접근
  for (const n of ctx.nodes) {
    if (n.mainCount < 1) continue;
    for (const lid of n.lines) {
      const line = ctx.roadLines[lid];
      if (line.level > 2) continue;
      let bi = 0, bd = Infinity;
      for (let k = 0; k < line.pts.length; k++) { const p = line.pts[k]; const d2 = (p.x - n.x) ** 2 + (p.z - n.z) ** 2; if (d2 < bd) { bd = d2; bi = k; } }
      if (bd > 64) continue;
      for (const dir of [-1, 1]) {
        let k = bi, acc = 0;
        while (k + dir >= 0 && k + dir < line.pts.length && acc < 11) {
          acc += Math.hypot(line.pts[k + dir].x - line.pts[k].x, line.pts[k + dir].z - line.pts[k].z);
          k += dir;
        }
        if (acc < 9) continue;
        const p = line.pts[k], q = line.pts[k - dir] || p;
        const rot = Math.atan2(p.z - q.z, p.x - q.x);
        ctx.decals.push({ shape: 'crosswalk', x: p.x, z: p.z, w: 3.2, d: line.width, rot, color: '#f4f4f4' });
        cw++;
      }
    }
  }
  // 하천 벚꽃 산책로 + 물가 벤치
  let sak = 0, benches = 0;
  if (ctx.river) {
    for (let k = 2; k < ctx.river.length - 2; k += 2) {
      const a = ctx.river[k], b = ctx.river[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      for (const s of [-1, 1]) {
        const off = a.w / 2 + 3.2;
        const px = a.x - (dz / L) * s * off, pz = a.z + (dx / L) * s * off;
        const id = cid(px, pz);
        if (id < 0 || T[id] !== TERRAIN.LAND) continue;
        if (R[id] && R[id] !== ROAD.SIDEWALK) continue;
        if (!free(px, pz, 3)) continue;
        mark(px, pz, 3);
        const d = dist(id);
        if (k % 6 === 0) {
          const bx = px + (dz / L) * s * 1.6, bz = pz - (dx / L) * s * 1.6;
          ctx.add({ shape: 'box', x: bx, y: 0, z: bz, w: 2, h: 0.5, d: 0.6, rot: Math.atan2(dz, dx), color: COLORS.bench, mat: 'std', cat: 'prop', kind: 'bench', rule: 'micro.bench', district: d ? d.id : -1, solid: true, why: '하천을 바라보는 벤치' });
          benches++;
        } else {
          addTree(ctx, px, pz, rng, d ? d.id : -1, 'micro.tree', true, 0.9);
          sak++;
        }
      }
    }
  }
  // 낙서 영역 경사: 레드라인 자유학원에서 멀수록 확률 감소
  const free_ac = ctx.districts.find((d) => d.type === 'free_academy');
  let graf = 0;
  if (free_ac) {
    const fx = free_ac.core ? free_ac.core.cx : free_ac.x, fz = free_ac.core ? free_ac.core.cz : free_ac.z;
    for (const b of ctx.buildings) {
      if (b.deleted) continue;
      const dd = Math.hypot(b.x - fx, b.z - fz);
      const p = 0.75 * Math.exp(-dd / 170);
      if (p < 0.03) continue;
      for (let k = 0; k < 4; k++) {
        if (b.sides[k] >= 4) continue;
        if (!rng.chance(p * (b.sides[k] === 2 ? 1.4 : b.campus ? 0.6 : 0.7))) continue;
        const f = faceInfo(b, k);
        const ax = Math.cos(f.along), az = Math.sin(f.along);
        const off = rng.range(-0.3, 0.3) * f.len;
        ctx.add({ shape: 'box', x: f.cx + f.nx * 0.06 + ax * off, y: rng.range(0.3, 1.2), z: f.cz + f.nz * 0.06 + az * off, w: Math.min(f.len * 0.7, rng.range(2.2, 4.5)), h: rng.range(1, 2), d: 0.05, rot: f.along, color: rng.pick(['#ff3fa4', '#39e1ff', '#ffe03a', '#8cff5a', '#ff7a2a']), mat: 'glow', cat: 'facade', kind: 'graffiti', rule: 'micro.graffiti', district: b.district, solid: false, why: `자유학원 중심에서 ${dd.toFixed(0)}m — 확률 ${(p * 100).toFixed(0)}%` });
        graf++;
      }
    }
  }
  ctx.log('micro.lamp', `가로등 ${lamps}`);
  ctx.log('micro.tree', `가로수 ${trees}, 벚나무 ${sak}`);
  ctx.log('micro.busstop', `정류장 ${stops}`);
  ctx.log('micro.vending', `자판기 ${vend}`);
  ctx.log('micro.car', `주차 ${cars}`);
  ctx.log('micro.crosswalk', `횡단보도 ${cw}`);
  ctx.log('micro.graffiti', `낙서 ${graf}`);
  ctx.log('micro.laundry', `빨래줄 ${laundry}, 아케이드 ${arcades}`);
  void benches; void jitterColor;
}

export function addVending(ctx, x, z, rot, rng, district, why) {
  const col = rng.chance(0.6) ? COLORS.vending : COLORS.vending2;
  ctx.add({ shape: 'box', x, y: 0, z, w: 1.0, h: 1.85, d: 0.8, rot, color: col, mat: 'std', cat: 'prop', kind: 'vending', rule: 'micro.vending', district, solid: true, name: '자판기', why });
  ctx.add({ shape: 'box', x: x + Math.cos(rot + Math.PI / 2) * 0.41, y: 1.0, z: z + Math.sin(rot + Math.PI / 2) * 0.41, w: 0.8, h: 0.6, d: 0.02, rot, color: '#e8fbff', mat: 'glow', cat: 'prop', kind: 'vending_panel', rule: 'micro.vending', district, solid: false });
}
