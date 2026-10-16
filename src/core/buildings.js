// 메조 2단계: 용도 배정(zoning) + 매싱 문법 + 파사드/옥상 소품.
// 필지 특징(구역, 코너, 접도 위계, 도로 흐름, 중심거리)을 가중치로 프로그램을 고른다.
import { COLORS, WORLD } from './config.js';
import { obbCorners } from './grid.js';

const FH = WORLD.floorH;

// ---- 건물 프로그램 표 ----
// floors: 층수 범위, set: [전면, 측면, 후면] 셋백 범위(m), roof: 옥상 문법, poi: 활동 거점
export const PROGRAMS = {
  shophouse: { label: '상가주택', color: COLORS.shop, floors: [2, 5], set: [[0.3, 1], [0.6, 1.4], [1, 3]], awning: true, sign: 'small', roof: 'res', groundShop: true },
  convenience: { label: '편의점', color: COLORS.convenience, floors: [1, 2], set: [[1.5, 2.5], [0.6, 1.2], [1, 2]], awning: true, sign: 'band', roof: 'com', poi: 'shop', vending: true },
  cafe: { label: '카페', color: COLORS.cafe, floors: [2, 3], set: [[1, 2.5], [0.6, 1.5], [1, 3]], awning: true, sign: 'small', roof: 'garden', poi: 'shop', terrace: true },
  arcade_game: { label: '게임센터', color: COLORS.arcade_game, floors: [3, 5], set: [[0.5, 1], [0.5, 1], [1, 2]], sign: 'tall', roof: 'com', poi: 'anchor', unique: 2 },
  karaoke: { label: '노래방', color: COLORS.karaoke, floors: [3, 6], set: [[0.5, 1], [0.5, 1], [1, 2]], sign: 'tall', roof: 'com', poi: 'anchor', unique: 2 },
  bookstore: { label: '서점·만화방', color: COLORS.bookstore, floors: [2, 4], set: [[0.5, 1.5], [0.5, 1.2], [1, 2]], awning: true, sign: 'small', roof: 'res', poi: 'shop', unique: 2 },
  mall: { label: '쇼핑몰', color: '#f6c177', floors: [4, 6], set: [[1, 2], [1, 2], [1, 2]], sign: 'band', roof: 'com', poi: 'anchor', massing: 'podium', unique: 1 },
  apartment: { label: '아파트', color: COLORS.apartment, floors: [5, 11], set: [[2, 4], [1.5, 3], [2, 4]], roof: 'res', massing: 'slab' },
  dorm: { label: '학생 기숙사', color: COLORS.dorm, floors: [4, 7], set: [[2, 3.5], [1.5, 2.5], [2, 3]], roof: 'res', poi: 'dorm', massing: 'slab' },
  house: { label: '주택', color: COLORS.house, floors: [2, 3], set: [[2, 4], [1.2, 2.2], [2, 4]], roof: 'house' },
  laundromat: { label: '코인 세탁소', color: COLORS.laundromat, floors: [1, 2], set: [[1, 2], [1, 1.5], [1, 3]], awning: true, sign: 'band', roof: 'res', poi: 'shop', unique: 3 },
  office: { label: '오피스', color: COLORS.office, floors: [6, 14], set: [[2, 4], [1, 2.5], [2, 4]], roof: 'com', massing: 'stepped' },
  gov: { label: '학원도시 관리청', color: COLORS.gov, floors: [4, 8], set: [[4, 7], [2, 4], [2, 4]], roof: 'flat', massing: 'podium', poi: 'anchor', unique: 2 },
  lab: { label: '연구동', color: COLORS.lab, floors: [3, 6], set: [[2, 4], [1.5, 3], [2, 4]], roof: 'tech' },
  server: { label: '데이터센터', color: COLORS.server, floors: [2, 3], set: [[2, 3], [1.5, 2.5], [2, 3]], roof: 'tech' },
  warehouse: { label: '물류창고', color: COLORS.warehouse, floors: [2, 3], set: [[2, 5], [1.5, 3], [2, 4]], roof: 'flat', tallFloors: 4.2 },
  fishmarket: { label: '수산시장', color: '#7fb7c9', floors: [1, 2], set: [[1, 2], [1, 2], [1, 2]], awning: true, sign: 'band', roof: 'flat', poi: 'anchor', unique: 1 },
  ruin: { label: '폐건물', color: COLORS.ruin, floors: [1, 5], set: [[0.5, 2], [0.5, 2], [1, 3]], roof: 'ruin', massing: 'broken' },
  ruin_shop: { label: '셔터 내린 상가', color: '#a39a8c', floors: [2, 3], set: [[0.3, 1], [0.6, 1.2], [1, 2]], awning: true, sign: 'small', roof: 'ruin' },
  construction: { label: '공사장', color: COLORS.construction, floors: [0, 0], set: [[0.5, 1], [0.5, 1], [0.5, 1]], special: 'construction' },
  courtyard: { label: '안뜰', color: '#b9d79f', floors: [0, 0], set: [[0, 0], [0, 0], [0, 0]], special: 'courtyard' },
  pocketpark: { label: '쌈지공원', color: '#9fd18a', floors: [0, 0], set: [[0, 0], [0, 0], [0, 0]], special: 'pocketpark', poi: 'micro' },
  parking: { label: '주차장', color: '#9ea3a8', floors: [0, 0], set: [[0, 0], [0, 0], [0, 0]], special: 'parking' },
  shed: { label: '창고', color: '#a58f73', floors: [1, 1], set: [[2, 4], [2, 4], [2, 4]], roof: 'flat' },
  gaado: { label: '고가 밑 상가', color: '#ffb36b', floors: [1, 1], set: [[0.3, 0.8], [0.3, 0.6], [0.5, 1]], awning: true, sign: 'band', roof: 'flat', poi: 'shop' },
};

// ---- 구역별 용도 가중치 (필지 특징 → 가중치) ----
// l: {area, corner, frontRank(0..5), interior, flow(0..1), r(중심거리 m), sea(해안거리)}
export const ZONING = {
  center: [
    ['office', (l) => (l.area > 300 ? 4 : 1)],
    ['gov', (l) => (l.frontRank >= 5 && l.area > 500 ? 3 : 0)],
    ['mall', (l) => (l.area > 700 && l.flow > 0.4 ? 3 : 0)],
    ['cafe', (l) => (l.corner ? 2 : 0.5)],
    ['convenience', (l) => (l.corner ? 2 : 0)],
    ['courtyard', (l) => (l.interior ? 6 : 0)],
  ],
  commercial: [
    ['shophouse', () => 5],
    ['convenience', (l) => (l.corner ? 4 : 0.2)],
    ['cafe', (l) => 1 + l.flow * 2],
    ['arcade_game', (l) => (l.area > 220 && l.flow > 0.35 ? 3 + 4 * l.flow : 0)],
    ['karaoke', (l) => (l.area > 180 ? 1 + 2 * l.flow : 0)],
    ['bookstore', () => 1],
    ['mall', (l) => (l.area > 900 && l.frontRank >= 5 ? 2 : 0)],
    ['courtyard', (l) => (l.interior ? 4 : 0)],
    ['shed', (l) => (l.interior ? 1.5 : 0)],
  ],
  residential: [
    ['apartment', (l) => (l.area > 300 ? 4 : 0.5)],
    ['house', (l) => (l.area < 420 ? 4 : 1)],
    ['dorm', (l) => (l.area > 350 ? 2 : 0)],
    ['convenience', (l) => (l.corner && l.frontRank >= 3 ? 2 : 0)],
    ['laundromat', (l) => (l.frontRank >= 2 ? 0.6 : 0)],
    ['shophouse', (l) => (l.frontRank >= 5 ? 2 : 0.3)],
    ['pocketpark', (l) => (l.frontRank >= 3 && l.area < 500 ? 0.5 : 0)],
    ['courtyard', (l) => (l.interior ? 5 : 0)],
  ],
  harbor: [
    ['warehouse', () => 6],
    ['fishmarket', (l) => (l.sea < 60 && l.frontRank >= 4 ? 3 : 0)],
    ['office', (l) => (l.frontRank >= 5 ? 0.6 : 0)],
    ['convenience', (l) => (l.corner ? 0.8 : 0)],
    ['parking', (l) => (l.interior ? 2 : 0.4)],
    ['shed', () => 1],
  ],
  ruins: [
    ['ruin', () => 5],
    ['ruin_shop', (l) => (l.frontRank >= 3 ? 2 : 0)],
    ['construction', (l) => (l.area > 250 ? 1.2 : 0)],
    ['house', () => 1],
    ['courtyard', (l) => (l.interior ? 3 : 0)],
    ['shed', (l) => (l.interior ? 2 : 0.5)],
  ],
  park: [
    ['cafe', () => 2], ['house', () => 2], ['pocketpark', () => 2], ['convenience', (l) => (l.corner ? 1 : 0)],
  ],
  // 학원 구역의 캠퍼스 외곽 띠
  trad_academy: [['house', () => 2], ['cafe', () => 2], ['bookstore', () => 1], ['dorm', (l) => (l.area > 350 ? 2 : 0)], ['courtyard', (l) => (l.interior ? 4 : 0)]],
  tech_academy: [['lab', () => 4], ['server', (l) => (l.area > 300 ? 2 : 0)], ['convenience', (l) => (l.corner ? 1.5 : 0)], ['dorm', (l) => (l.area > 350 ? 1 : 0)], ['parking', (l) => (l.interior ? 2 : 0)]],
  free_academy: [['ruin_shop', () => 2], ['shophouse', () => 2], ['house', () => 2], ['shed', () => 1], ['courtyard', (l) => (l.interior ? 3 : 0)]],
  arts_academy: [['cafe', () => 3], ['shophouse', () => 2], ['house', () => 1], ['bookstore', () => 1], ['courtyard', (l) => (l.interior ? 4 : 0)]],
};

export function jitterColor(hex, rng, amt = 0.07) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const k = 1 + rng.range(-amt, amt);
  r = Math.max(0, Math.min(255, Math.round(r * k)));
  g = Math.max(0, Math.min(255, Math.round(g * k)));
  b = Math.max(0, Math.min(255, Math.round(b * k)));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export const skylineFactor = (x, z) => 1 + 0.85 * Math.exp(-((x * x + z * z) / (2 * 230 * 230)));

/** OBB 로컬 → 월드 */
export function lw(o, u, v) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return [o.x + u * c - v * s, o.z + u * s + v * c];
}

/** 면 정보: 0 u-, 1 u+, 2 v-, 3 v+ → {cx, cz, nx, nz, len, rotFacing} */
export function faceInfo(o, k) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const hw = o.w / 2, hd = o.d / 2;
  const L = [[-hw, 0, -1, 0, o.d], [hw, 0, 1, 0, o.d], [0, -hd, 0, -1, o.w], [0, hd, 0, 1, o.w]][k];
  const [u, v, nu, nv, len] = L;
  const cx = o.x + u * c - v * s, cz = o.z + u * s + v * c;
  const nx = nu * c - nv * s, nz = nu * s + nv * c;
  // 면을 따라가는 방향의 회전 (박스의 w축이 면과 평행하도록)
  const along = k < 2 ? o.rot + Math.PI / 2 : o.rot;
  return { cx, cz, nx, nz, len, along, k };
}

/** 범용 건물 생성. spec: {x,z,w,d,rot, floors, prog, color?, name?, district, rule, why, massing?, roof?, front?, sides?} */
export function makeBuilding(ctx, spec, rng) {
  const prog = PROGRAMS[spec.prog] || {};
  const color = spec.color || jitterColor(prog.color || '#cccccc', rng);
  const floorH = prog.tallFloors || FH;
  const floors = Math.max(1, spec.floors);
  let h = floors * floorH + (prog.groundShop ? 0.8 : 0);
  const b = {
    id: ctx.buildings.length, x: spec.x, z: spec.z, w: spec.w, d: spec.d, rot: spec.rot, h, floors,
    prog: spec.prog, label: spec.name || prog.label, district: spec.district, front: spec.front ?? -1,
    sides: spec.sides || [0, 0, 0, 0], lot: spec.lot ?? -1, ents: [], roofs: [], campus: spec.campus || false,
    rule: spec.rule,
  };
  ctx.buildings.push(b);
  const base = { district: spec.district, ref: b.id, solid: true };
  const add = (e) => { const r = ctx.add({ ...base, ...e }); b.ents.push(r.id); return r; };
  const massing = spec.massing || prog.massing || 'box';
  const why = spec.why;

  if (massing === 'podium' && floors >= 4) {
    const ph = 2 * floorH + 0.6;
    add({ shape: 'box', x: b.x, y: 0, z: b.z, w: b.w, h: ph, d: b.d, rot: b.rot, color, mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, why, name: b.label });
    const tw = b.w * rng.range(0.55, 0.75), td = b.d * rng.range(0.55, 0.75);
    const [tx, tz] = lw(b, rng.range(-1, 1) * (b.w - tw) * 0.3, rng.range(-1, 1) * (b.d - td) * 0.3);
    add({ shape: 'box', x: tx, y: ph, z: tz, w: tw, h: h - ph, d: td, rot: b.rot, color: jitterColor(color, rng, 0.05), mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, name: b.label });
    b.roofs.push({ x: tx, z: tz, w: tw, d: td, rot: b.rot, y: h, main: true });
    b.roofs.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, y: ph, terrace: true });
  } else if (massing === 'stepped' && floors >= 6) {
    let y = 0, w = b.w, d = b.d;
    const tiers = floors >= 10 ? 3 : 2;
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? h - y : Math.round(floors / tiers) * floorH;
      add({ shape: 'box', x: b.x, y, z: b.z, w, h: th, d, rot: b.rot, color: t ? jitterColor(color, rng, 0.04) : color, mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, why: t ? undefined : why, name: b.label });
      y += th;
      if (t === tiers - 1) b.roofs.push({ x: b.x, z: b.z, w, d, rot: b.rot, y, main: true });
      else b.roofs.push({ x: b.x, z: b.z, w, d, rot: b.rot, y, terrace: true });
      w *= 0.78; d *= 0.78;
    }
  } else if (massing === 'broken') {
    // 폐건물: 낮아진 본체 + 무너진 상부 조각 + 잔해
    add({ shape: 'box', x: b.x, y: 0, z: b.z, w: b.w, h, d: b.d, rot: b.rot, color, mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, why, name: b.label, ruin: 1 });
    b.roofs.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, y: h, main: true });
    if (floors >= 2 && rng.chance(0.7)) {
      const pw = b.w * rng.range(0.3, 0.6), pd = b.d * rng.range(0.3, 0.6);
      const [px, pz] = lw(b, (rng.sign() * (b.w - pw)) / 2, (rng.sign() * (b.d - pd)) / 2);
      const ph = rng.range(1, 2.5) * floorH;
      add({ shape: 'box', x: px, y: h, z: pz, w: pw, h: ph, d: pd, rot: b.rot, color: COLORS.ruin_dark, mat: 'bld', cat: 'building', kind: 'ruin_part', rule: spec.rule, ruin: 1 });
      b.roofs.push({ x: px, z: pz, w: pw, d: pd, rot: b.rot, y: h + ph });
    }
    for (let k = 0; k < rng.int(1, 3); k++) {
      const side = rng.int(0, 3);
      const f = faceInfo(b, side);
      const off = rng.range(-0.35, 0.35) * f.len;
      const [ax, az] = [f.cx + Math.cos(f.along) * off + f.nx * 1.4, f.cz + Math.sin(f.along) * off + f.nz * 1.4];
      ctx.add({ shape: 'box', x: ax, y: 0, z: az, w: rng.range(1.5, 3), h: rng.range(0.5, 1.2), d: rng.range(1.2, 2.2), rot: rng.range(0, 3), color: '#7d7468', mat: 'std', cat: 'prop', kind: 'rubble', rule: 'micro.roof', district: spec.district, solid: true, rx: rng.range(-0.2, 0.2) });
    }
  } else if (massing === 'slab' && b.w > 22 && rng.chance(0.4)) {
    // ㄱ자 동
    const w1 = b.w, d1 = b.d * 0.55;
    const [x1, z1] = lw(b, 0, -(b.d - d1) / 2);
    add({ shape: 'box', x: x1, y: 0, z: z1, w: w1, h, d: d1, rot: b.rot, color, mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, why, name: b.label });
    const w2 = b.w * 0.35, d2 = b.d - d1;
    const sgn = rng.sign();
    const [x2, z2] = lw(b, (sgn * (b.w - w2)) / 2, d1 / 2);
    const h2 = Math.max(floorH * 2, h - floorH * rng.int(0, 2));
    add({ shape: 'box', x: x2, y: 0, z: z2, w: w2, h: h2, d: d2, rot: b.rot, color: jitterColor(color, rng, 0.04), mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, name: b.label });
    b.roofs.push({ x: x1, z: z1, w: w1, d: d1, rot: b.rot, y: h, main: true });
    b.roofs.push({ x: x2, z: z2, w: w2, d: d2, rot: b.rot, y: h2 });
  } else {
    add({ shape: 'box', x: b.x, y: 0, z: b.z, w: b.w, h, d: b.d, rot: b.rot, color, mat: 'bld', cat: 'building', kind: spec.prog, rule: spec.rule, why, name: b.label });
    b.roofs.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, y: h, main: true });
  }
  if (spec.roofStyle === 'gable' || prog.roof === 'house') {
    // 박공 지붕 대용: 낮은 프리즘 → 기울어진 박스 2개
    const r = b.roofs[0];
    const rh = Math.min(2.4, r.d * 0.25);
    ctx.add({ shape: 'gable', x: r.x, y: r.y, z: r.z, w: r.w + 0.6, h: rh, d: r.d + 0.6, rot: r.rot, color: spec.roofColor || jitterColor('#b5523b', rng, 0.12), mat: 'std', cat: 'roof', kind: 'gable', rule: 'micro.roof', district: spec.district, ref: b.id, solid: true });
    r.pitched = true;
  }
  b.h = Math.max(...b.roofs.map((r) => r.y));
  decorate(ctx, b, prog, rng, spec);
  return b;
}

function decorate(ctx, b, prog, rng, spec) {
  const base = { district: b.district, ref: b.id, mat: 'std' };
  const front = b.front;
  // 파사드: 차양/간판/출입구 (접도면에만)
  if (front >= 0) {
    const f = faceInfo(b, front);
    const ax = Math.cos(f.along), az = Math.sin(f.along);
    // 출입구
    ctx.add({ ...base, shape: 'box', x: f.cx + f.nx * 0.12, y: 0, z: f.cz + f.nz * 0.12, w: Math.min(2.4, f.len * 0.3), h: 2.5, d: 0.25, rot: f.along, color: '#3b3f4a', cat: 'facade', kind: 'door', rule: 'micro.awning', solid: false });
    if (prog.awning && f.len > 4) {
      ctx.add({ ...base, shape: 'box', x: f.cx + f.nx * 0.9, y: 2.9, z: f.cz + f.nz * 0.9, w: f.len * 0.86, h: 0.22, d: 1.7, rot: f.along, color: jitterColor(spec.accent || '#e05a47', rng, 0.15), cat: 'facade', kind: 'awning', rule: 'micro.awning', solid: false, rx: 0 });
    }
    if (prog.sign === 'small' || prog.sign === 'band') {
      const sw = prog.sign === 'band' ? f.len * 0.8 : Math.min(f.len * 0.5, 5);
      ctx.add({ ...base, shape: 'box', x: f.cx + f.nx * 0.2, y: 3.3, z: f.cz + f.nz * 0.2, w: sw, h: prog.sign === 'band' ? 0.9 : 0.8, d: 0.25, rot: f.along, color: prog.color, cat: 'facade', kind: 'sign', rule: 'micro.awning', mat: 'glow', solid: false });
    } else if (prog.sign === 'tall') {
      // 세로 간판 (서브컬쳐 상점가 상징)
      const off = (f.len / 2 - 0.8) * rng.sign();
      ctx.add({ ...base, shape: 'box', x: f.cx + ax * off + f.nx * 0.9, y: 3, z: f.cz + az * off + f.nz * 0.9, w: 0.35, h: Math.max(4, b.h - 4), d: 1.4, rot: f.along, color: rng.pick(['#ff4f9a', '#4fd1ff', '#ffd23d', '#9b5cff']), cat: 'facade', kind: 'tallsign', rule: 'micro.awning', mat: 'glow', solid: false });
    }
    if (prog.terrace && f.len > 6) {
      for (let k = -1; k <= 1; k += 2) {
        const [tx, tz] = [f.cx + f.nx * 2.2 + ax * k * f.len * 0.25, f.cz + f.nz * 2.2 + az * k * f.len * 0.25];
        ctx.add({ ...base, shape: 'cyl', x: tx, y: 0, z: tz, w: 1, h: 0.75, d: 1, rot: 0, color: '#f2e6d0', cat: 'prop', kind: 'table', rule: 'micro.awning', solid: false });
        ctx.add({ ...base, shape: 'cone', x: tx, y: 1.9, z: tz, w: 2.6, h: 0.7, d: 2.6, rot: 0, color: '#e8796a', cat: 'prop', kind: 'parasol', rule: 'micro.awning', solid: false });
      }
    }
  }
  // 골목에 면한 벽: 실외기/배관
  for (let k = 0; k < 4; k++) {
    if (b.sides[k] !== 2 && !(b.sides[k] === 0 && rng.chance(0.25))) continue;
    if (b.prog === 'house' && rng.chance(0.5)) continue;
    const f = faceInfo(b, k);
    const ax = Math.cos(f.along), az = Math.sin(f.along);
    const n = Math.min(4, Math.floor(f.len / 5));
    for (let m = 0; m < n; m++) {
      if (!rng.chance(0.55)) continue;
      const off = (rng.next() - 0.5) * f.len * 0.8;
      const y = rng.int(0, Math.max(0, b.floors - 1)) * FH + 0.4;
      ctx.add({ ...base, shape: 'box', x: f.cx + f.nx * 0.45 + ax * off, y, z: f.cz + f.nz * 0.45 + az * off, w: 0.9, h: 0.7, d: 0.6, rot: f.along, color: COLORS.ac, cat: 'facade', kind: 'ac', rule: 'micro.ac', solid: y < 0.5 });
    }
  }
  // 옥상 문법
  const roof = b.roofs.find((r) => r.main);
  if (!roof || roof.pitched) return;
  const style = spec.roof || prog.roof || 'flat';
  const R = (u, v) => lw(roof, u, v);
  const rb = { ...base, cat: 'roof', rule: 'micro.roof' };
  const place = (du, dv) => R((rng.next() - 0.5) * (roof.w - du), (rng.next() - 0.5) * (roof.d - dv));
  // 계단실 (옥상 출입) — 대부분의 평지붕
  if (style !== 'ruin' && roof.w > 7 && roof.d > 7 && rng.chance(0.75)) {
    const [sx, sz] = place(4, 4);
    ctx.add({ ...rb, shape: 'box', x: sx, y: roof.y, z: sz, w: 3, h: 2.6, d: 3.2, rot: roof.rot, color: jitterColor('#c9c4b8', rng), kind: 'stairhut', solid: true });
  }
  if (style === 'res' || style === 'school') {
    if (roof.w > 8 && rng.chance(style === 'res' ? 0.7 : 0.4)) {
      const [tx, tz] = place(4, 4);
      ctx.add({ ...rb, shape: 'box', x: tx, y: roof.y, z: tz, w: 2.6, h: 0.8, d: 2.6, rot: roof.rot, color: '#8d939b', kind: 'tankbase', solid: true });
      ctx.add({ ...rb, shape: 'cyl', x: tx, y: roof.y + 0.8, z: tz, w: 2.4, h: 2.2, d: 2.4, rot: 0, color: COLORS.watertank, kind: 'watertank', solid: true });
    }
  }
  if (style === 'res' || style === 'com') {
    for (let k = 0; k < rng.int(1, 3); k++) {
      const [ax, az] = place(2, 2);
      ctx.add({ ...rb, shape: 'box', x: ax, y: roof.y, z: az, w: 1.1, h: 0.9, d: 0.8, rot: roof.rot, color: COLORS.ac, kind: 'ac', solid: true });
    }
  }
  if (style === 'com' && front >= 0 && roof.w > 8 && rng.chance(0.55)) {
    // 옥상 광고판: 접도면을 향하게
    const f = faceInfo(roof, front);
    ctx.add({ ...rb, shape: 'box', x: f.cx - f.nx * 1.2, y: roof.y, z: f.cz - f.nz * 1.2, w: Math.min(10, f.len * 0.8), h: 4.6, d: 0.35, rot: f.along, color: rng.pick(['#ff6f91', '#53c7f0', '#ffd166', '#9b8cff', '#7ce3b0']), kind: 'billboard', mat: 'glow', solid: true });
  }
  if (style === 'tech') {
    for (let k = 0; k < rng.int(1, 3); k++) {
      const [ax, az] = place(2, 2);
      ctx.add({ ...rb, shape: 'cyl', x: ax, y: roof.y, z: az, w: 0.25, h: rng.range(4, 9), d: 0.25, rot: 0, color: COLORS.antenna, kind: 'antenna', solid: false });
    }
    if (roof.w > 10 && roof.d > 10) {
      const rows = Math.floor((roof.d - 4) / 2.6);
      for (let r = 0; r < Math.min(rows, 5); r++) {
        const [px, pz] = R(0, -roof.d / 2 + 2.4 + r * 2.6);
        ctx.add({ ...rb, shape: 'box', x: px, y: roof.y + 0.5, z: pz, w: roof.w * 0.7, h: 0.12, d: 1.6, rot: roof.rot, color: COLORS.solar, kind: 'solar', solid: false, rx: 0.35 });
      }
    }
  }
  if (style === 'garden' && roof.w > 5) {
    ctx.add({ ...rb, shape: 'box', x: roof.x, y: roof.y, z: roof.z, w: roof.w * 0.8, h: 0.35, d: roof.d * 0.8, rot: roof.rot, color: '#8cc97a', kind: 'roofgarden', solid: true });
  }
  if (style === 'school') {
    // 학교 옥상 펜스 — 애니메이션 학원물의 상징적 장소
    for (let k = 0; k < 4; k++) {
      const f = faceInfo(roof, k);
      ctx.add({ ...rb, shape: 'box', x: f.cx - f.nx * 0.3, y: roof.y, z: f.cz - f.nz * 0.3, w: f.len - 0.4, h: 1.7, d: 0.12, rot: f.along, color: '#9fb7a8', kind: 'rooffence', solid: true, mat: 'glass' });
    }
  }
  if (style === 'ruin' && rng.chance(0.5)) {
    const [px, pz] = place(3, 3);
    ctx.add({ ...rb, shape: 'sphere', x: px, y: roof.y, z: pz, w: 2.2, h: 1.6, d: 2.2, rot: 0, color: '#6f8f4f', kind: 'overgrowth', solid: false });
  }
}

/** 필지 위 건물 발자국: 셋백 적용 */
export function footprintFromLot(lot, prog, rng) {
  const set = prog.set;
  const s = [0, 0, 0, 0];
  const front = lot.front;
  const opp = front >= 0 ? front ^ 1 : -1;
  for (let k = 0; k < 4; k++) {
    let range;
    if (k === front) range = set[0];
    else if (k === opp) range = set[2];
    else range = set[1];
    // 코너 필지의 두 번째 접도면은 전면 셋백
    if (lot.sides[k] >= 3 && k !== front) range = set[0];
    s[k] = rng.range(range[0], range[1]);
  }
  let { u0, u1, v0, v1 } = lot;
  u0 += s[0]; u1 -= s[1]; v0 += s[2]; v1 -= s[3];
  if (u1 - u0 < 4 || v1 - v0 < 4) return null;
  return { u0, u1, v0, v1 };
}

export function obbFromLocal(block, r) {
  const u = (r.u0 + r.u1) / 2, v = (r.v0 + r.v1) / 2;
  const c = Math.cos(block.rot), s = Math.sin(block.rot);
  return { x: block.cx + u * c - v * s, z: block.cz + u * s + v * c, w: r.u1 - r.u0, d: r.v1 - r.v0, rot: block.rot };
}

export { obbCorners };
