// 도시 일반 구역: 거점(hub), 랜드마크 비스타 선정, 용도 배정 → 건물, 특수 부지(컨테이너 미로, 공사장, 중앙탑).
import { TERRAIN, ROAD, ZONE, WORLD, COLORS } from './config.js';
import { PROGRAMS, ZONING, makeBuilding, footprintFromLot, jitterColor, skylineFactor, lw, faceInfo } from './buildings.js';
import { localToWorld } from './blocks.js';

const H = WORLD.half, N = WORLD.size;
const cid = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

export function buildHubs(ctx) {
  const hubs = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    hubs.push({ x: Math.cos(a) * 66, z: Math.sin(a) * 66, w: 1.4, name: '중앙광장' });
  }
  for (const d of ctx.districts) {
    if (d.def.campus) {
      if (d.gate) hubs.push({ x: d.gate.x, z: d.gate.z, w: 2.0, name: `${d.name} 정문` });
      continue;
    }
    if (d.def.park) continue;
    if (d.type === 'center') continue;
    const w = { commercial: 2.0, residential: 1.6, harbor: 1.0, ruins: 0.6 }[d.type] || 1;
    hubs.push({ x: d.x, z: d.z, w, name: d.name });
  }
  // 공원 입구 (존 입구 군집)
  const parkEnts = ctx.zoneEntrances.filter((e) => e.zone === ZONE.PARK);
  const picked = [];
  for (const e of parkEnts) {
    if (picked.some((p) => Math.hypot(p.x - e.x, p.z - e.z) < 70)) continue;
    picked.push(e);
  }
  ctx.parkEntrances = picked;
  for (const p of picked.slice(0, 4)) hubs.push({ x: p.x, z: p.z, w: 0.9, name: '공원 입구' });
  ctx.hubs = hubs;
}

// ---- 랜드마크 비스타 선정 ----
function vistaScore(ctx, x, z, ownR) {
  const R = ctx.road.data, T = ctx.terrain.data;
  let score = 0;
  const RAYS = 72;
  for (let r = 0; r < RAYS; r++) {
    const a = (r / RAYS) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    let len = 0;
    for (let s = ownR; s < 640; s += 2) {
      const id = cid(x + dx * s, z + dz * s);
      if (id < 0) break;
      if (R[id] || T[id] === TERRAIN.RIVER || T[id] === TERRAIN.LAKE) { len = s - ownR; continue; }
      if (s < ownR + 5) continue;
      break;
    }
    score += len * len;
  }
  return Math.sqrt(score / RAYS);
}

const LM_NAMES = { ferris: ['스타라이트 관람차', '문라이트 관람차'], clocktower: ['옛 급수탑 시계', '빨간 지붕 시계탑'], unfinished: ['미완의 타워'] };
export function chooseLandmarkSites(ctx) {
  const want = { commercial: 'ferris', residential: 'clocktower', ruins: 'unfinished' };
  const used = {};
  for (const d of ctx.districts) {
    const kind = want[d.type];
    if (!kind) continue;
    let cands = ctx.lots.filter((l) => l.district === d.id && !l.interior && !l.landmark && l.area > (kind === 'ferris' ? 650 : 280) && l.frontRank >= 3);
    // 큰 필지가 없으면 상위 면적 필지로 완화 (랜드마크 누락 방지)
    if (!cands.length) cands = ctx.lots.filter((l) => l.district === d.id && !l.interior && !l.landmark && l.frontRank >= 2).sort((a, b) => b.area - a.area).slice(0, 8);
    let best = null, bs = -1;
    for (const l of cands) {
      const s = vistaScore(ctx, l.x, l.z, Math.hypot(l.w, l.d) / 2) * Math.exp(-Math.hypot(l.x - d.x, l.z - d.z) / 260);
      if (s > bs) { bs = s; best = l; }
    }
    if (best) {
      best.landmark = kind;
      best.vista = bs;
      used[kind] = (used[kind] || 0) + 1;
      best.lmName = LM_NAMES[kind][(used[kind] - 1) % LM_NAMES[kind].length];
      d.landmarkLot = best.id;
    }
  }
}

// ---- 용도 배정 + 건물 ----
export function genCityBuildings(ctx) {
  const uniqueCount = {};
  const RF = ctx.roadFlow;
  for (const lot of ctx.lots) {
    const d = ctx.districts[lot.district];
    const rng = lot.rng;
    // 필지 특징
    let flow = 0;
    if (lot.front >= 0) {
      const f = faceInfo(lot, lot.front);
      for (const dist of [4, 8, 12]) flow = Math.max(flow, RF.at(f.cx + f.nx * dist, f.cz + f.nz * dist));
    }
    const id = cid(lot.x, lot.z);
    const feat = { area: lot.area, corner: lot.corner, frontRank: lot.frontRank, interior: lot.interior, flow, r: Math.hypot(lot.x, lot.z), sea: ctx.distSea[id] };
    lot.flow = flow;
    if (lot.landmark) { buildLandmarkLot(ctx, lot, d, rng); continue; }
    const table = ZONING[d.type] || ZONING.residential;
    const opts = table
      .map(([prog, wf]) => {
        const P = PROGRAMS[prog];
        const key = `${d.id}:${prog}`;
        if (P.unique && (uniqueCount[key] || 0) >= P.unique) return { prog, w: 0 };
        return { prog, w: wf(feat) };
      })
      .filter((o) => o.w > 0);
    const pick = rng.weighted(opts);
    if (!pick) continue;
    const prog = pick.prog;
    uniqueCount[`${d.id}:${prog}`] = (uniqueCount[`${d.id}:${prog}`] || 0) + 1;
    lot.prog = prog;
    const P = PROGRAMS[prog];
    const why = `${d.name} · 접도 ${['없음', '', '골목', '생활가로', '해안', '간선'][lot.frontRank] || lot.frontRank}${lot.corner ? ' · 코너' : ''}${lot.interior ? ' · 안뜰' : ''} · 흐름 ${(flow * 100).toFixed(0)}%`;
    if (P.special) { buildSpecialLot(ctx, lot, d, prog, rng, why); continue; }
    const fp = footprintFromLot(lot, P, rng);
    if (!fp) continue;
    const blk = { cx: lot.x, cz: lot.z, rot: lot.rot };
    const uc = (fp.u0 + fp.u1) / 2 - (lot.u0 + lot.u1) / 2, vc = (fp.v0 + fp.v1) / 2 - (lot.v0 + lot.v1) / 2;
    const [bx, bz] = localToWorld(blk, uc, vc);
    const sf = d.type === 'ruins' || d.type === 'harbor' ? 1 : skylineFactor(lot.x, lot.z);
    let floors = Math.round(rng.int(P.floors[0], P.floors[1]) * sf);
    floors = Math.max(1, Math.min(floors, Math.round(P.floors[1] * 1.9)));
    const b = makeBuilding(ctx, {
      x: bx, z: bz, w: fp.u1 - fp.u0, d: fp.v1 - fp.v0, rot: lot.rot, floors, prog, district: d.id,
      front: lot.front, sides: lot.sides, lot: lot.id, rule: 'meso.zoning', why, accent: d.accent,
    }, rng);
    lot.building = b.id;
    if (P.poi) {
      const f = lot.front >= 0 ? faceInfo(b, lot.front) : { cx: b.x, cz: b.z, nx: 0, nz: 0 };
      const isAnchor = P.poi === 'anchor';
      ctx.addPoi({
        x: f.cx + f.nx * 2.5, z: f.cz + f.nz * 2.5, name: shopName(prog, rng), type: P.poi, tier: isAnchor ? 1 : 2,
        district: d.id, rule: isAnchor ? 'intent.anchor' : 'meso.zoning', why: isAnchor ? `흐름 ${(flow * 100).toFixed(0)}% 필지의 핵심 활동 앵커` : why, building: b.id,
      });
    }
  }
}

const NAMES = {
  convenience: ['패밀리 루미나', '세븐스타', '로손 학원점', '미니스톱 24'],
  cafe: ['카페 하늘색', '고양이 다방', '블루 아워', '마카롱 스튜디오', '카페 별빛'],
  arcade_game: ['게임센터 SEGA-LIKE', '스타 아케이드', '리듬 파라다이스', '크레인 킹덤'],
  karaoke: ['노래방 하모니', '빅 에코', '카라오케 체리'],
  bookstore: ['애니메이트 루미나', '만화방 서고', '헌책방 시오리'],
  mall: ['루미나 쇼핑몰', '스타게이트 몰'],
  laundromat: ['코인 세탁소 거품'], fishmarket: ['청해 수산시장'], gov: ['학원도시 관리청', '총학생회 본부'],
  dorm: ['학생 기숙사 A동', '학생 기숙사 B동', '여자 기숙사 백합관'], gaado: ['고가 밑 포장마차'],
};
function shopName(prog, rng) {
  const list = NAMES[prog];
  return list ? rng.pick(list) : PROGRAMS[prog].label;
}

function buildSpecialLot(ctx, lot, d, prog, rng, why) {
  const P = PROGRAMS[prog];
  const color = P.color;
  if (prog === 'courtyard' || prog === 'pocketpark') {
    ctx.decals.push({ shape: 'rect', x: lot.x, z: lot.z, w: lot.w - 1.5, d: lot.d - 1.5, rot: lot.rot, color: prog === 'courtyard' ? '#b8d39a' : '#a6d68f' });
    lot.courtyard = prog === 'courtyard';
    const nT = Math.max(1, Math.floor(lot.area / 160));
    for (let k = 0; k < nT; k++) {
      const [tx, tz] = lw(lot, rng.range(-0.35, 0.35) * lot.w, rng.range(-0.35, 0.35) * lot.d);
      addTree(ctx, tx, tz, rng, d.id, prog === 'courtyard' ? 'meso.zoning' : 'meso.zoning', rng.chance(0.25));
    }
    if (prog === 'pocketpark') {
      const [px, pz] = lw(lot, 0, 0);
      ctx.add({ shape: 'box', x: px, y: 0, z: pz, w: 3, h: 2.2, d: 0.2, rot: lot.rot, color: '#e94f4f', mat: 'std', cat: 'prop', kind: 'swing', rule: 'meso.zoning', district: d.id, solid: true, why });
      ctx.addPoi({ x: px, z: pz, name: '쌈지공원 놀이터', type: 'micro', tier: 3, district: d.id, rule: 'meso.zoning', why });
    } else {
      // 안뜰 소품: 창고/화분/자전거
      if (rng.chance(0.6)) {
        const [sx, sz] = lw(lot, (lot.w / 2 - 2) * rng.sign(), (lot.d / 2 - 2) * rng.sign());
        ctx.add({ shape: 'box', x: sx, y: 0, z: sz, w: 2.2, h: 2.2, d: 1.8, rot: lot.rot, color: '#9c8a6e', mat: 'std', cat: 'prop', kind: 'shed', rule: 'meso.zoning', district: d.id, solid: true });
      }
    }
    return;
  }
  if (prog === 'parking') {
    ctx.decals.push({ shape: 'rect', x: lot.x, z: lot.z, w: lot.w - 1, d: lot.d - 1, rot: lot.rot, color: '#8f949a', stripes: true });
    const n = Math.floor((lot.w - 4) / 2.8);
    for (let k = 0; k < n; k++) {
      if (!rng.chance(0.55)) continue;
      const [cx, cz] = lw(lot, -lot.w / 2 + 2 + k * 2.8 + 1.4, -lot.d / 2 + 3);
      addCar(ctx, cx, cz, lot.rot + Math.PI / 2, rng, d.id, 'meso.zoning');
    }
    return;
  }
  if (prog === 'construction') {
    // 공사장: 펜스로 두르되 한 곳은 틈 → 숨은 공간
    const gapSide = rng.int(0, 3);
    const gapAt = rng.range(-0.3, 0.3);
    for (let k = 0; k < 4; k++) {
      const f = faceInfo(lot, k);
      const segs = Math.max(1, Math.round(f.len / 3));
      const ax = Math.cos(f.along), az = Math.sin(f.along);
      for (let s = 0; s < segs; s++) {
        const t = (s + 0.5) / segs - 0.5;
        if (k === gapSide && Math.abs(t - gapAt) * f.len < 1.6) continue;
        ctx.add({ shape: 'box', x: f.cx - f.nx * 0.6 + ax * t * f.len, y: 0, z: f.cz - f.nz * 0.6 + az * t * f.len, w: f.len / segs - 0.1, h: 2.4, d: 0.15, rot: f.along, color: '#e8e4d8', mat: 'std', cat: 'prop', kind: 'fence', rule: 'meso.construction', district: d.id, solid: true, why: k === gapSide && s === 0 ? '틈새 하나는 열어둔다' : undefined });
      }
    }
    const fg = faceInfo(lot, gapSide);
    lot.gap = { x: fg.cx + Math.cos(fg.along) * gapAt * fg.len, z: fg.cz + Math.sin(fg.along) * gapAt * fg.len };
    // 철골 뼈대
    const fw = lot.w * 0.6, fd = lot.d * 0.6;
    const levels = rng.int(2, 5);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [px, pz] = lw(lot, (su * fw) / 2, (sv * fd) / 2);
      ctx.add({ shape: 'box', x: px, y: 0, z: pz, w: 0.5, h: levels * 3.6, d: 0.5, rot: lot.rot, color: '#c46b2c', mat: 'std', cat: 'building', kind: 'frame', rule: 'meso.construction', district: d.id, solid: true });
    }
    for (let l = 1; l < levels; l++) {
      ctx.add({ shape: 'box', x: lot.x, y: l * 3.6, z: lot.z, w: fw, h: 0.3, d: fd, rot: lot.rot, color: '#b0a89a', mat: 'std', cat: 'building', kind: 'slab', rule: 'meso.construction', district: d.id, solid: true, deck: true });
    }
    // 자재 더미
    for (let k = 0; k < 3; k++) {
      const [mx, mz] = lw(lot, rng.range(-0.4, 0.4) * lot.w, rng.range(-0.4, 0.4) * lot.d);
      ctx.add({ shape: 'box', x: mx, y: 0, z: mz, w: rng.range(1.5, 3), h: rng.range(0.6, 1.4), d: rng.range(1, 2), rot: rng.range(0, 3), color: rng.pick(['#8b6f4e', '#9aa0a6', '#c9b27c']), mat: 'std', cat: 'prop', kind: 'material', rule: 'meso.construction', district: d.id, solid: true });
    }
    ctx.decals.push({ shape: 'rect', x: lot.x, z: lot.z, w: lot.w - 1, d: lot.d - 1, rot: lot.rot, color: '#c2ab84' });
    lot.construction = true;
  }
}

export function addTree(ctx, x, z, rng, district, rule, sakura = false, scale = 1) {
  const h = rng.range(3.5, 6) * scale;
  ctx.add({ shape: 'cyl', x, y: 0, z, w: 0.35 * scale, h: h * 0.45, d: 0.35 * scale, rot: 0, color: COLORS.trunk, mat: 'std', cat: 'tree', kind: 'trunk', rule, district, solid: true });
  const r = rng.range(2.2, 3.4) * scale;
  ctx.add({ shape: 'sphere', x, y: h * 0.4, z, w: r * 2, h: r * 1.7, d: r * 2, rot: 0, color: sakura ? jitterColor(COLORS.sakura, rng, 0.06) : jitterColor(COLORS.tree, rng, 0.12), mat: 'std', cat: 'tree', kind: sakura ? 'sakura' : 'tree', rule, district, solid: false });
}

export function addCar(ctx, x, z, rot, rng, district, rule) {
  const col = rng.pick(COLORS.car);
  ctx.add({ shape: 'box', x, y: 0.25, z, w: 4.2, h: 0.9, d: 1.8, rot, color: col, mat: 'std', cat: 'prop', kind: 'car', rule, district, solid: true });
  ctx.add({ shape: 'box', x, y: 1.15, z, w: 2.3, h: 0.7, d: 1.6, rot, color: '#2b3440', mat: 'glass', cat: 'prop', kind: 'carcab', rule, district, solid: false });
}

// ---- 랜드마크 필지 ----
function buildLandmarkLot(ctx, lot, d, rng) {
  const why = `비스타 점수 ${lot.vista.toFixed(0)} — 구역 내 최장 시선축 종결점`;
  if (lot.landmark === 'ferris') {
    const fp = footprintFromLot({ ...lot, front: lot.front }, PROGRAMS.mall, rng) || lot;
    const b = makeBuilding(ctx, { x: lot.x, z: lot.z, w: (fp.u1 - fp.u0) || lot.w - 3, d: (fp.v1 - fp.v0) || lot.d - 3, rot: lot.rot, floors: 4, prog: 'mall', massing: 'box', district: d.id, front: lot.front, sides: lot.sides, lot: lot.id, rule: 'intent.landmark', why, name: '스타라이트 몰' }, rng);
    const R = Math.min(20, Math.max(13, Math.min(lot.w, lot.d) * 0.45));
    const y0 = b.h + R + 2;
    const f = faceInfo(b, Math.max(0, lot.front));
    ctx.add({ shape: 'torus', x: b.x, y: y0, z: b.z, w: R * 2, h: R * 2, d: 1.2, rot: f.along, color: '#ff5fa2', mat: 'glow', cat: 'landmark', kind: 'ferris', rule: 'intent.landmark', district: d.id, solid: false, name: lot.lmName, why });
    ctx.add({ shape: 'cyl', x: b.x, y: b.h, z: b.z, w: 1.2, h: R + 2, d: 1.2, rot: 0, color: '#e0e0e0', mat: 'std', cat: 'landmark', kind: 'ferris_leg', rule: 'intent.landmark', district: d.id, solid: false });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const ax = Math.cos(f.along), az = Math.sin(f.along);
      ctx.add({ shape: 'box', x: b.x + ax * Math.cos(a) * R, y: y0 + Math.sin(a) * R - 1.2, z: b.z + az * Math.cos(a) * R, w: 1.8, h: 1.8, d: 1.8, rot: f.along, color: ['#ffd23d', '#4fd1ff', '#7ce3b0', '#b77bff'][k % 4], mat: 'glow', cat: 'landmark', kind: 'gondola', rule: 'intent.landmark', district: d.id, solid: false });
    }
    ctx.addLandmark({ name: lot.lmName, x: b.x, z: b.z, h: y0 + R, district: d.id, kind: 'ferris', why });
    ctx.addPoi({ x: b.x, z: b.z, name: '스타라이트 몰', type: 'anchor', tier: 1, district: d.id, rule: 'intent.landmark', why, building: b.id });
  } else if (lot.landmark === 'clocktower') {
    const s = Math.min(10, Math.min(lot.w, lot.d) * 0.6);
    const hgt = 40;
    ctx.add({ shape: 'box', x: lot.x, y: 0, z: lot.z, w: s, h: hgt, d: s, rot: lot.rot, color: '#d8b98c', mat: 'bld', cat: 'landmark', kind: 'clocktower', rule: 'intent.landmark', district: d.id, solid: true, name: lot.lmName, why });
    for (let k = 0; k < 4; k++) {
      const f = faceInfo({ x: lot.x, z: lot.z, w: s, d: s, rot: lot.rot }, k);
      ctx.add({ shape: 'cyl', x: f.cx + f.nx * 0.1, y: hgt - 7, z: f.cz + f.nz * 0.1, w: s * 0.6, h: 0.3, d: s * 0.6, rot: f.along, color: '#fff6d8', mat: 'glow', cat: 'landmark', kind: 'clockface', rule: 'intent.landmark', district: d.id, solid: false, rx: Math.PI / 2 });
    }
    ctx.add({ shape: 'cone', x: lot.x, y: hgt, z: lot.z, w: s * 1.3, h: 9, d: s * 1.3, rot: Math.PI / 4 + lot.rot, color: '#3e6b8a', mat: 'std', cat: 'landmark', kind: 'spire', rule: 'intent.landmark', district: d.id, solid: true, sides: 4 });
    ctx.decals.push({ shape: 'circle', x: lot.x, z: lot.z, w: Math.min(lot.w, lot.d), d: Math.min(lot.w, lot.d), color: '#d9cfb8' });
    ctx.addLandmark({ name: lot.lmName, x: lot.x, z: lot.z, h: hgt + 9, district: d.id, kind: 'clocktower', why });
    ctx.addPoi({ x: lot.x, z: lot.z, name: '시계탑 광장', type: 'anchor', tier: 1, district: d.id, rule: 'intent.landmark', why });
    lot.towerTop = { x: lot.x, z: lot.z, y: hgt, s };
  } else if (lot.landmark === 'unfinished') {
    const w = Math.min(lot.w - 4, 22), dd = Math.min(lot.d - 4, 22);
    const levels = 20, fh = 3.6;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const [px, pz] = lw(lot, (su * w) / 2, (sv * dd) / 2);
      ctx.add({ shape: 'box', x: px, y: 0, z: pz, w: 0.9, h: levels * fh, d: 0.9, rot: lot.rot, color: '#8a8f96', mat: 'std', cat: 'landmark', kind: 'column', rule: 'intent.landmark', district: d.id, solid: true });
    }
    for (let l = 1; l <= levels; l++) {
      // 위로 갈수록 슬래브가 듬성듬성 — 미완성 느낌
      if (l > 12 && rng.chance(0.45)) continue;
      ctx.add({ shape: 'box', x: lot.x, y: l * fh - 0.35, z: lot.z, w, h: 0.35, d: dd, rot: lot.rot, color: '#a7a39a', mat: 'std', cat: 'landmark', kind: 'slab', rule: 'intent.landmark', district: d.id, solid: true, deck: true });
    }
    // 타워 크레인
    const [cx, cz] = lw(lot, w / 2 + 3, 0);
    const ch = levels * fh + 14;
    ctx.add({ shape: 'box', x: cx, y: 0, z: cz, w: 1.6, h: ch, d: 1.6, rot: lot.rot, color: COLORS.crane, mat: 'std', cat: 'landmark', kind: 'crane_mast', rule: 'intent.landmark', district: d.id, solid: true });
    const jr = lot.rot + rng.range(0, Math.PI * 2);
    ctx.add({ shape: 'box', x: cx + Math.cos(jr) * 14, y: ch, z: cz + Math.sin(jr) * 14, w: 40, h: 1.2, d: 1.2, rot: jr, color: COLORS.crane, mat: 'std', cat: 'landmark', kind: 'crane_jib', rule: 'intent.landmark', district: d.id, solid: false });
    ctx.add({ shape: 'box', x: lot.x, y: levels * fh + 1, z: lot.z, w: 3, h: 3, d: 3, rot: lot.rot, color: '#ff3d6e', mat: 'glow', cat: 'landmark', kind: 'beacon', rule: 'intent.landmark', district: d.id, solid: false, name: '미완의 타워', why });
    ctx.addLandmark({ name: '미완의 타워', x: lot.x, z: lot.z, h: ch, district: d.id, kind: 'unfinished', why });
    lot.towerTop = { x: lot.x, z: lot.z, y: levels * fh, s: Math.min(w, dd) };
    lot.unfinished = { levels, fh, w, d: dd };
    ctx.decals.push({ shape: 'rect', x: lot.x, z: lot.z, w: lot.w - 1, d: lot.d - 1, rot: lot.rot, color: '#bba98a' });
  }
}

// ---- 중앙 광장 + 중앙탑 ----
export function genCenter(ctx) {
  const rng = ctx.rng.fork('center');
  const dc = ctx.districts[0].id;
  const why = '전역 랜드마크: 방사 대로 7개의 소실점, 섬 어디서든 보이는 높이';
  ctx.decals.push({ shape: 'circle', x: 0, z: 0, w: 124, d: 124, color: '#e4e1d8' });
  ctx.decals.push({ shape: 'ring', x: 0, z: 0, w: 96, d: 96, color: '#c9c3b5', line: 3 });
  ctx.decals.push({ shape: 'ring', x: 0, z: 0, w: 60, d: 60, color: '#c9c3b5', line: 2 });
  const tiers = [[20, 0, 72], [14.5, 72, 132], [9.5, 132, 186]];
  for (const [s, y0, y1] of tiers) {
    ctx.add({ shape: 'box', x: 0, y: y0, z: 0, w: s, h: y1 - y0, d: s, rot: Math.PI / 4, color: y0 === 0 ? '#eef1f7' : '#dfe5f0', mat: 'bld', cat: 'landmark', kind: 'spire', rule: 'intent.spire', district: dc, solid: true, name: '루미나 센트럴 스파이어', why });
  }
  ctx.add({ shape: 'cyl', x: 0, y: 186, z: 0, w: 2.4, h: 52, d: 2.4, rot: 0, color: '#f5f7ff', mat: 'std', cat: 'landmark', kind: 'needle', rule: 'intent.spire', district: dc, solid: false });
  ctx.add({ shape: 'torus', x: 0, y: 160, z: 0, w: 46, h: 46, d: 1.6, rot: 0, color: COLORS.halo, mat: 'glow', cat: 'landmark', kind: 'halo', rule: 'intent.spire', district: dc, solid: false, rx: Math.PI / 2, name: '스파이어 헤일로' });
  ctx.add({ shape: 'torus', x: 0, y: 214, z: 0, w: 22, h: 22, d: 1.0, rot: 0, color: '#9ee7ff', mat: 'glow', cat: 'landmark', kind: 'halo', rule: 'intent.spire', district: dc, solid: false, rx: Math.PI / 2 });
  ctx.addLandmark({ name: '센트럴 스파이어', x: 0, z: 0, h: 238, district: dc, kind: 'spire', why, global: true });
  // 분수, 대형 스크린, 벤치 링
  ctx.add({ shape: 'cyl', x: 0, y: 0, z: 0, w: 34, h: 0.7, d: 34, rot: 0, color: '#9ccfe8', mat: 'std', cat: 'prop', kind: 'fountain', rule: 'intent.spire', district: dc, solid: true });
  const scrA = rng.range(0, Math.PI);
  for (let k = 0; k < 3; k++) {
    const a = scrA + (k / 3) * Math.PI * 2;
    const x = Math.cos(a) * 54, z = Math.sin(a) * 54;
    ctx.add({ shape: 'box', x, y: 4, z, w: 14, h: 8, d: 0.8, rot: a + Math.PI / 2, color: '#53c7f0', mat: 'glow', cat: 'prop', kind: 'bigscreen', rule: 'intent.spire', district: dc, solid: false, name: '대형 홀로 스크린' });
    ctx.add({ shape: 'box', x, y: 0, z, w: 1, h: 4, d: 1, rot: a, color: '#5b6070', mat: 'std', cat: 'prop', kind: 'post', rule: 'intent.spire', district: dc, solid: true });
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + 0.1;
    const x = Math.cos(a) * 24, z = Math.sin(a) * 24;
    ctx.add({ shape: 'box', x, y: 0, z, w: 2.2, h: 0.5, d: 0.7, rot: a + Math.PI / 2, color: COLORS.bench, mat: 'std', cat: 'prop', kind: 'bench', rule: 'micro.bench', district: dc, solid: true, why: '분수를 바라보는 벤치' });
  }
  ctx.addPoi({ x: 0, z: 30, name: '중앙광장 분수', type: 'anchor', tier: 1, district: dc, rule: 'intent.spire', why });
}

// ---- 항만: 컨테이너 미로 ----
export function markSpecialBlocks(ctx) {
  const harbor = ctx.districts.find((d) => d.type === 'harbor');
  if (!harbor) return;
  let best = null, bs = 0;
  for (const b of ctx.blocks) {
    if (b.district !== harbor.id) continue;
    const id = cid(b.cx, b.cz);
    if (ctx.distSea[id] > 140) continue;
    const W = b.u1 - b.u0, D = b.v1 - b.v0;
    if (W < 40 || D < 30) continue;
    const s = b.area;
    if (s > bs) { bs = s; best = b; }
  }
  if (best) best.special = 'yard';
}

export function genContainerYard(ctx) {
  const b = ctx.blocks.find((x) => x.special === 'yard');
  if (!b) return;
  const rng = ctx.rng.fork('yard');
  const dId = b.district;
  const cs = 6.6;
  const W = b.u1 - b.u0 - 6, D = b.v1 - b.v0 - 6;
  const nx = Math.min(12, Math.floor(W / cs)), ny = Math.min(10, Math.floor(D / cs));
  if (nx < 3 || ny < 3) return;
  const u0 = (b.u0 + b.u1) / 2 - (nx * cs) / 2, v0 = (b.v0 + b.v1) / 2 - (ny * cs) / 2;
  // 미로 (반복 백트래커)
  const open = new Uint8Array(nx * ny); // bit0 east, bit1 south
  const seen = new Uint8Array(nx * ny);
  const stack = [rng.int(0, nx * ny - 1)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % nx, y = (c / nx) | 0;
    const nb = [];
    if (x > 0 && !seen[c - 1]) nb.push([c - 1, 'w']);
    if (x < nx - 1 && !seen[c + 1]) nb.push([c + 1, 'e']);
    if (y > 0 && !seen[c - nx]) nb.push([c - nx, 'n']);
    if (y < ny - 1 && !seen[c + nx]) nb.push([c + nx, 's']);
    if (!nb.length) { stack.pop(); continue; }
    const [n, dir] = rng.pick(nb);
    if (dir === 'e') open[c] |= 1; else if (dir === 'w') open[n] |= 1; else if (dir === 's') open[c] |= 2; else open[n] |= 2;
    seen[n] = 1;
    stack.push(n);
  }
  // 브레이드: 막다른 칸 일부를 뚫어 순환 생성 (좌절감 완화)
  const degree = (c) => {
    const x = c % nx, y = (c / nx) | 0;
    let d = 0;
    if (open[c] & 1) d++; if (open[c] & 2) d++;
    if (x > 0 && open[c - 1] & 1) d++; if (y > 0 && open[c - nx] & 2) d++;
    return d;
  };
  for (let c = 0; c < nx * ny; c++) {
    if (degree(c) === 1 && rng.chance(0.3)) {
      const x = c % nx, y = (c / nx) | 0;
      if (x < nx - 1 && !(open[c] & 1)) open[c] |= 1; else if (y < ny - 1 && !(open[c] & 2)) open[c] |= 2;
    }
  }
  const blk = { cx: b.cx, cz: b.cz, rot: b.rot };
  const stackAt = (u, v, alongV) => {
    const [x, z] = localToWorld(blk, u, v);
    const k = rng.weighted([{ k: 1, w: 3 }, { k: 2, w: 4 }, { k: 3, w: 1.5 }]).k;
    for (let s = 0; s < k; s++) {
      ctx.add({ shape: 'box', x, y: s * 2.6, z, w: 6.1, h: 2.58, d: 2.44, rot: b.rot + (alongV ? Math.PI / 2 : 0) + rng.range(-0.02, 0.02), color: rng.pick(COLORS.container), mat: 'std', cat: 'prop', kind: 'container', rule: 'meso.harbor', district: dId, solid: true });
    }
  };
  // 입구 3개
  const entrances = new Set([`n${rng.int(0, nx - 1)}`, `s${rng.int(0, nx - 1)}`, `w${rng.int(0, ny - 1)}`]);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = y * nx + x;
    const cu = u0 + x * cs, cv = v0 + y * cs;
    if (x < nx - 1 && !(open[c] & 1)) stackAt(cu + cs, cv + cs / 2, true);
    if (y < ny - 1 && !(open[c] & 2)) stackAt(cu + cs / 2, cv + cs, false);
    if (x === 0 && !entrances.has(`w${y}`)) stackAt(cu, cv + cs / 2, true);
    if (x === nx - 1) stackAt(cu + cs, cv + cs / 2, true);
    if (y === 0 && !entrances.has(`n${x}`)) stackAt(cu + cs / 2, cv, false);
    if (y === ny - 1 && !entrances.has(`s${x}`)) stackAt(cu + cs / 2, cv + cs, false);
  }
  ctx.mazeDeadEnds = [];
  for (let c = 0; c < nx * ny; c++) {
    if (degree(c) !== 1) continue;
    const x = c % nx, y = (c / nx) | 0;
    const [wx, wz] = localToWorld(blk, u0 + x * cs + cs / 2, v0 + y * cs + cs / 2);
    ctx.mazeDeadEnds.push({ x: wx, z: wz, district: dId });
  }
  ctx.decals.push({ shape: 'rect', x: b.cx + 0, z: b.cz, w: b.u1 - b.u0 - 2, d: b.v1 - b.v0 - 2, rot: b.rot, color: '#b5b1a6', center: localToWorld(blk, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2) });
  const [mx, mz] = localToWorld(blk, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2);
  ctx.addPoi({ x: mx, z: mz, name: '컨테이너 미로', type: 'anchor', tier: 1, district: dId, rule: 'meso.harbor', why: `${nx}×${ny} 미로, 막다른 칸 ${ctx.mazeDeadEnds.length}곳 — 보상 배치 대상` });
  ctx.log('meso.harbor', `컨테이너 미로 ${nx}×${ny}, 막다른 칸 ${ctx.mazeDeadEnds.length}`);
}

/** 항만: 등대(해안 돌출부 끝) + 갠트리 크레인 + 부두 */
export function genHarborFeatures(ctx) {
  const harbor = ctx.districts.find((d) => d.type === 'harbor');
  if (!harbor) return;
  const rng = ctx.rng.fork('harborfx');
  const D = ctx.district.data, T = ctx.terrain.data;
  // 등대: 항만 구역 해안 셀 중 섬 중심에서 가장 먼 곳
  let best = -1, bd = 0;
  for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) {
    const id = j * N + i;
    if (D[id] !== harbor.id || T[id] !== TERRAIN.LAND || ctx.distSea[id] > 5) continue;
    if (ctx.road.data[id]) continue;
    const x = i - H, z = j - H;
    const r = Math.hypot(x, z);
    if (r > bd) { bd = r; best = id; }
  }
  if (best >= 0) {
    const x = (best % N) - H + 0.5, z = ((best / N) | 0) - H + 0.5;
    const why = '항만 구역 해안 돌출부 끝 — 바다 쪽에서 보이는 방위 표지';
    ctx.add({ shape: 'cyl', x, y: 0, z, w: 5, h: 30, d: 5, rot: 0, color: '#f4f4f4', mat: 'bld', cat: 'landmark', kind: 'lighthouse', rule: 'intent.landmark', district: harbor.id, solid: true, name: '청해 등대', why });
    for (let k = 0; k < 3; k++) ctx.add({ shape: 'cyl', x, y: 6 + k * 8, z, w: 5.1, h: 2.5, d: 5.1, rot: 0, color: '#e0413b', mat: 'std', cat: 'landmark', kind: 'stripe', rule: 'intent.landmark', district: harbor.id, solid: false });
    ctx.add({ shape: 'cyl', x, y: 30, z, w: 3.6, h: 3, d: 3.6, rot: 0, color: '#fff3a0', mat: 'glow', cat: 'landmark', kind: 'lamp', rule: 'intent.landmark', district: harbor.id, solid: false });
    ctx.addLandmark({ name: '청해 등대', x, z, h: 33, district: harbor.id, kind: 'lighthouse', why });
    ctx.lighthouse = { x, z };
  }
  // 부두 + 갠트리 크레인: 항만 해안을 따라 간격 배치
  const coastPts = [];
  for (let j = 0; j < N; j += 3) for (let i = 0; i < N; i += 3) {
    const id = j * N + i;
    if (D[id] !== harbor.id || T[id] !== TERRAIN.LAND) continue;
    const ds = ctx.distSea[id];
    if (ds < 1.5 || ds > 3) continue;
    coastPts.push({ x: i - H + 0.5, z: j - H + 0.5, id });
  }
  rng.shuffle(coastPts);
  const chosen = [];
  for (const p of coastPts) {
    if (chosen.length >= 4) break;
    if (chosen.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 70)) continue;
    if (ctx.lighthouse && Math.hypot(ctx.lighthouse.x - p.x, ctx.lighthouse.z - p.z) < 40) continue;
    chosen.push(p);
  }
  for (const p of chosen) {
    // 바다 방향
    let gx = 0, gz = 0;
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const id = cid(p.x + dx, p.z + dz);
      if (id >= 0) { gx += (ctx.distSea[id] - ctx.distSea[p.id]) * dx; gz += (ctx.distSea[id] - ctx.distSea[p.id]) * dz; }
    }
    const a = Math.atan2(-gz, -gx); // 바다 쪽
    const px = p.x + Math.cos(a) * 14, pz = p.z + Math.sin(a) * 14;
    ctx.add({ shape: 'box', x: px, y: -0.2, z: pz, w: 30, h: 0.9, d: 8, rot: a, color: COLORS.pier, mat: 'std', cat: 'prop', kind: 'pier', rule: 'meso.harbor', district: harbor.id, solid: true, deck: false, walkOverWater: true });
    ctx.piers = ctx.piers || [];
    ctx.piers.push({ x: px, z: pz, w: 30, d: 8, rot: a });
    // 갠트리 크레인
    const ca = a + Math.PI / 2;
    for (const s of [-1, 1]) {
      ctx.add({ shape: 'box', x: p.x + Math.cos(ca) * 5 * s, y: 0, z: p.z + Math.sin(ca) * 5 * s, w: 1.2, h: 24, d: 1.2, rot: a, color: COLORS.crane, mat: 'std', cat: 'landmark', kind: 'gantry_leg', rule: 'meso.harbor', district: harbor.id, solid: true });
    }
    ctx.add({ shape: 'box', x: p.x + Math.cos(a) * 10, y: 24, z: p.z + Math.sin(a) * 10, w: 42, h: 2, d: 12, rot: a, color: COLORS.crane, mat: 'std', cat: 'landmark', kind: 'gantry_boom', rule: 'meso.harbor', district: harbor.id, solid: false });
  }
}
