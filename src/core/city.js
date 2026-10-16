// 도시 일반 구역: 거점(hub), 랜드마크 비스타 선정, 용도 배정 → 건물, 특수 부지(컨테이너 미로, 공사장, 중앙탑).
import { TERRAIN, ROAD, ZONE, WORLD, COLORS, PLAN, SHORT } from './config.js';
import { PROGRAMS, ZONING, makeBuilding, footprintFromLot, jitterColor, skylineFactor, lw, faceInfo } from './buildings.js';
import { localToWorld } from './blocks.js';
import { addBusStop } from './props.js'; // 순환 import: 호출 시점에만 쓰는 함수 선언이라 안전
import { PointHash, obbDistance } from './grid.js';
import { TOD, PURPOSE_MULT, EKIMAE, HERITAGE, STREET_ZONING, SEAMS, seamKey, heightFactor, buildToFor, PURPOSE_KO, stationTerm, streetById, wval } from './zoning.js';

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
export function vistaScore(ctx, x, z, ownR) {
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
  if (ctx.plan) { chooseLandmarkSitesPlan(ctx); return; }
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
  // C§4 새 프로그램 (레거시 프로그램의 목록은 건드리지 않는다 → rng.pick 결과 불변)
  stationery: ['문구점 연필깎이', '팬시 문구 별사탕', '학원 앞 문방구'],
  cram: ['입시학원 합격선', '스카이 아카데미', '수험전문 청람학원'],
  izakaya: ['이자카야 등불', '선술집 갈매기'],
  bakery: ['베이커리 멜론빵', '아침빵 공방', '빵집 크루아상'],
  boarding: ['하숙집 해바라기장', '청춘 하숙 벚꽃장', '하숙 고양이집'],
  sento: ['목욕탕 유노하나'],
  old_shop: ['노포 시오야', '100년 화과자'],
  live_house: ['라이브하우스 스타더스트', '라이브하우스 지하 1층'],
};
function shopName(prog, rng) {
  const list = NAMES[prog];
  return list ? rng.pick(list) : PROGRAMS[prog].label;
}

function buildSpecialLot(ctx, lot, d, prog, rng, why, extra) {
  const P = PROGRAMS[prog];
  const color = P.color;
  if (prog === 'threshold_plaza') { buildReleasePlaza(ctx, lot, d, rng, why, extra || {}); return; }
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

/** 가로수. canopy(#hex)를 주면 수관 색을 덮어쓴다 (학원 세력 수종) — 기본 경로는 레거시와 동일 */
export function addTree(ctx, x, z, rng, district, rule, sakura = false, scale = 1, canopy) {
  const h = rng.range(3.5, 6) * scale;
  ctx.add({ shape: 'cyl', x, y: 0, z, w: 0.35 * scale, h: h * 0.45, d: 0.35 * scale, rot: 0, color: COLORS.trunk, mat: 'std', cat: 'tree', kind: 'trunk', rule, district, solid: true });
  const r = rng.range(2.2, 3.4) * scale;
  ctx.add({ shape: 'sphere', x, y: h * 0.4, z, w: r * 2, h: r * 1.7, d: r * 2, rot: 0, color: canopy ? jitterColor(canopy, rng, 0.06) : sakura ? jitterColor(COLORS.sakura, rng, 0.06) : jitterColor(COLORS.tree, rng, 0.12), mat: 'std', cat: 'tree', kind: sakura ? 'sakura' : 'tree', rule, district, solid: false });
}

/** 옛길 소나무: 원통 줄기 + 6각 원뿔 수관 (C§8 C6) */
export function addPine(ctx, x, z, rng, district, rule, scale = 1) {
  const h = rng.range(4.0, 5.0) * scale;
  ctx.add({ shape: 'cyl', x, y: 0, z, w: 0.32 * scale, h: 1.5 * scale, d: 0.32 * scale, rot: 0, color: COLORS.trunk, mat: 'std', cat: 'tree', kind: 'trunk', rule, district, solid: true });
  ctx.add({ shape: 'cone', x, y: 1.1 * scale, z, w: 2.8 * scale, h, d: 2.8 * scale, rot: rng.range(0, Math.PI), color: jitterColor('#3f6b4a', rng, 0.08), mat: 'std', cat: 'tree', kind: 'pine', rule, district, solid: false, sides: 6 });
}

export function addCar(ctx, x, z, rot, rng, district, rule) {
  const col = rng.pick(COLORS.car);
  ctx.add({ shape: 'box', x, y: 0.25, z, w: 4.2, h: 0.9, d: 1.8, rot, color: col, mat: 'std', cat: 'prop', kind: 'car', rule, district, solid: true });
  ctx.add({ shape: 'box', x, y: 1.15, z, w: 2.3, h: 0.7, d: 1.6, rot, color: '#2b3440', mat: 'glass', cat: 'prop', kind: 'carcab', rule, district, solid: false });
}

// ---- 랜드마크 필지 ----
function buildLandmarkLot(ctx, lot, d, rng) {
  // plan 경로: 축선 종결 원인 (C§7 B5) — 레거시에선 lot.axis가 없으므로 문자열·스펙 불변
  const ac = lot.axis ? { k: 'axis', t: `${lot.axis.name} 축선 종결 · 직선 ${Math.round(lot.axis.L)}m`, rel: lot.axis.rel } : null;
  const cz0 = ac ? { cause: [ac], rel: ac.rel } : {};
  const why = `비스타 점수 ${lot.vista.toFixed(0)} — 구역 내 최장 시선축 종결점${ac ? ` · ${ac.t}` : ''}`;
  if (lot.landmark === 'ferris') {
    const fp = footprintFromLot({ ...lot, front: lot.front }, PROGRAMS.mall, rng) || lot;
    const archX = lot.arch ? { arch: { ...lot.arch, tier: 'A', crownLock: 'flat' } } : {};
    const b = makeBuilding(ctx, { x: lot.x, z: lot.z, w: (fp.u1 - fp.u0) || lot.w - 3, d: (fp.v1 - fp.v0) || lot.d - 3, rot: lot.rot, floors: 4, prog: 'mall', massing: 'box', district: d.id, front: lot.front, sides: lot.sides, lot: lot.id, rule: 'intent.landmark', why, name: '스타라이트 몰', ...archX, ...cz0 }, rng);
    if (ac) { if (b.cause === undefined) b.cause = [ac]; if (b.rel === undefined) b.rel = ac.rel; }
    if (ctx.plan || ctx.params.arch !== 0) lot.building = b.id;
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
    ctx.addPoi({ x: b.x, z: b.z, name: '스타라이트 몰', type: 'anchor', tier: 1, district: d.id, rule: 'intent.landmark', why, building: b.id, ...cz0 });
  } else if (lot.landmark === 'clocktower') {
    const s = Math.min(10, Math.min(lot.w, lot.d) * 0.6);
    const hgt = 40;
    ctx.add({ shape: 'box', x: lot.x, y: 0, z: lot.z, w: s, h: hgt, d: s, rot: lot.rot, color: '#d8b98c', mat: 'bld', cat: 'landmark', kind: 'clocktower', rule: 'intent.landmark', district: d.id, solid: true, name: lot.lmName, why, ...cz0 });
    for (let k = 0; k < 4; k++) {
      const f = faceInfo({ x: lot.x, z: lot.z, w: s, d: s, rot: lot.rot }, k);
      ctx.add({ shape: 'cyl', x: f.cx + f.nx * 0.1, y: hgt - 7, z: f.cz + f.nz * 0.1, w: s * 0.6, h: 0.3, d: s * 0.6, rot: f.along, color: '#fff6d8', mat: 'glow', cat: 'landmark', kind: 'clockface', rule: 'intent.landmark', district: d.id, solid: false, rx: Math.PI / 2 });
    }
    ctx.add({ shape: 'cone', x: lot.x, y: hgt, z: lot.z, w: s * 1.3, h: 9, d: s * 1.3, rot: Math.PI / 4 + lot.rot, color: '#3e6b8a', mat: 'std', cat: 'landmark', kind: 'spire', rule: 'intent.landmark', district: d.id, solid: true, sides: 4 });
    ctx.decals.push({ shape: 'circle', x: lot.x, z: lot.z, w: Math.min(lot.w, lot.d), d: Math.min(lot.w, lot.d), color: '#d9cfb8' });
    ctx.addLandmark({ name: lot.lmName, x: lot.x, z: lot.z, h: hgt + 9, district: d.id, kind: 'clocktower', why });
    ctx.addPoi({ x: lot.x, z: lot.z, name: '시계탑 광장', type: 'anchor', tier: 1, district: d.id, rule: 'intent.landmark', why, ...cz0 });
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
    ctx.add({ shape: 'box', x: lot.x, y: levels * fh + 1, z: lot.z, w: 3, h: 3, d: 3, rot: lot.rot, color: '#ff3d6e', mat: 'glow', cat: 'landmark', kind: 'beacon', rule: 'intent.landmark', district: d.id, solid: false, name: '미완의 타워', why, ...cz0 });
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

// =====================================================================================
// 도시 조직 (plan / arch 경로) — C§7 B4–B5, C§8 C1/C3, C§6 A6, plan §1 D5–D9.
// 레거시 genCityBuildings는 위에 그대로 남는다 ({plan:false, arch:0} 패리티).
// =====================================================================================
const has = (v) => v !== undefined && v !== null;
const ZERO_FP = Object.freeze({ commute: 0, school: 0, shop: 0, leisure: 0, market: 0 });
const LM_H = { ferris: 50, clocktower: 49, unfinished: 86 };
export const shortOf = (d) => (d ? d.short || SHORT[d.type] || d.name : '?');
const isSigLot = (lot) => has(lot.signature) || has(lot.sigMerged);
const median = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[(a.length - 1) >> 1] : 0; };

/** 관계 그래프 색인: 쌍 → 간선, 구역 → 간선 */
export function relIndex(ctx) {
  const pair = new Map(), byD = new Map();
  const edges = ctx.plan && ctx.plan.relations ? ctx.plan.relations.edges || [] : [];
  for (const e of edges) {
    const k = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    if (!pair.has(k)) pair.set(k, []);
    pair.get(k).push(e);
    for (const x of [e.a, e.b]) { if (!byD.has(x)) byD.set(x, []); byD.get(x).push(e); }
  }
  const between = (a, b, kinds) => {
    const L = pair.get(a < b ? `${a}|${b}` : `${b}|${a}`) || [];
    const e = kinds ? L.find((x) => kinds.includes(x.kind)) : L[0];
    return e ? e.id : undefined;
  };
  const touching = (a, kinds) => {
    const L = byD.get(a) || [];
    for (const k of kinds || []) { const e = L.find((x) => x.kind === k); if (e) return e.id; }
    return L.length ? L[0].id : undefined;
  };
  const byId = new Map(edges.map((e) => [e.id, e]));
  return { between, touching, byId };
}

/** 두 hex 색 선형 보간 */
function lerpHex(a, b, t) {
  const p = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
}

/** 1m 격자 샘플 */
const at1 = (arr, x, z, fb = 0) => { const id = cid(x, z); return id >= 0 && arr ? arr[id] : fb; };

/** 학원 세력 지배 (ctx.factionDom): {type, v} 또는 null */
export function factionAt(ctx, x, z) {
  const F = ctx.factionDom;
  if (!F || !F.dom || !F.types) return null;
  const k = F.dom.at(x, z, 255);
  if (k === 255 || k === undefined || !F.types[k]) return null;
  return { type: F.types[k], v: F.v ? F.v.at(x, z, 0) : 0 };
}

// ---- C§7 B5: 축선 종결 (plan 분기) ----
function endAxis(P) {
  const n = P.length;
  if (n < 2) return null;
  const e = P[n - 1];
  let acc = 0, k = n - 1;
  while (k > 0 && acc < 20) { acc += Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z); k--; }
  const dx0 = e.x - P[k].x, dz0 = e.z - P[k].z, L0 = Math.hypot(dx0, dz0);
  if (L0 < 5) return null;
  const ux = dx0 / L0, uz = dz0 / L0;
  const cos8 = Math.cos((8 * Math.PI) / 180);
  let x0 = e.x, z0 = e.z, run = 0;
  for (let m = n - 1; m > 0; m--) {
    const dx = P[m].x - P[m - 1].x, dz = P[m].z - P[m - 1].z, L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    if ((dx * ux + dz * uz) / L < cos8) break;
    run += L; x0 = P[m - 1].x; z0 = P[m - 1].z;
    if (run >= 300) break;
  }
  return { x: e.x, z: e.z, ux, uz, x0, z0, L: run };
}

function planAxes(ctx) {
  const D = ctx.district.data, out = [];
  const push = (pts, kind, name, rel) => {
    const a = endAxis(pts);
    if (!a) return;
    const id = cid(a.x, a.z);
    if (id < 0 || D[id] === 255) return;
    out.push({ ...a, district: D[id], kind, name, rel });
  };
  for (const r of ctx.plan.radials || []) if (r.pts && r.pts.length > 2) push(r.pts, 'radial', r.name || '방사 대로', r.rel);
  for (const st of ctx.plan.streets || []) {
    if (!st.pts || st.pts.length < 3) continue;
    push(st.pts, 'street', st.name, st.rel);
    push(st.pts.slice().reverse(), 'street', st.name, st.rel);
  }
  return out;
}

function axisValue(l, axes) {
  let best = 0, ba = null;
  for (const a of axes) {
    const dx = l.x - a.x, dz = l.z - a.z;
    const along = dx * a.ux + dz * a.uz;
    if (along <= 0) continue;
    const perp = Math.abs(-dx * a.uz + dz * a.ux);
    const v = Math.exp(-perp / 20) * Math.exp(-along / 80);
    if (v > best) { best = v; ba = a; }
  }
  return { v: best, a: ba };
}

function chooseLandmarkSitesPlan(ctx) {
  const want = { commercial: 'ferris', residential: 'clocktower', ruins: 'unfinished' };
  const used = {};
  const axes = planAxes(ctx);
  // 역 빌딩·광장·문턱 필지는 랜드마크 후보에서 제외 (plan §1 D6)
  const free = (l) => !l.interior && !l.landmark && !has(l.stationBuilding) && !has(l.square) && !has(l.release) && !has(l.compress);
  for (const d of ctx.districts) {
    const kind = want[d.type];
    if (!kind) continue;
    let cands = ctx.lots.filter((l) => l.district === d.id && free(l) && l.area > (kind === 'ferris' ? 650 : 280) && l.frontRank >= 3);
    if (!cands.length) cands = ctx.lots.filter((l) => l.district === d.id && free(l) && l.frontRank >= 2).sort((a, b) => b.area - a.area).slice(0, 8);
    const dAxes = axes.filter((a) => a.district === d.id);
    let best = null, bs = -1, bAx = null;
    for (const l of cands) {
      const ax = axisValue(l, dAxes);
      const s = vistaScore(ctx, l.x, l.z, Math.hypot(l.w, l.d) / 2) * Math.exp(-Math.hypot(l.x - d.x, l.z - d.z) / 260) * (1 + 3 * ax.v);
      if (s > bs) { bs = s; best = l; bAx = ax; }
    }
    if (best) {
      best.landmark = kind;
      best.vista = bs;
      used[kind] = (used[kind] || 0) + 1;
      best.lmName = LM_NAMES[kind][(used[kind] - 1) % LM_NAMES[kind].length];
      d.landmarkLot = best.id;
      if (bAx && bAx.v > 0.3) {
        const a = bAx.a;
        best.axis = { x0: a.x0, z0: a.z0, x1: a.x, z1: a.z, ux: a.ux, uz: a.uz, L: a.L, kind: a.kind, name: a.name, rel: a.rel, v: +bAx.v.toFixed(3) };
        ctx.log('meso.axis', `${d.name} ${best.lmName}: ${a.name} 축선 종결 (직선 ${Math.round(a.L)}m, 축 점수 ${bAx.v.toFixed(2)})`);
      }
    }
  }
}

// ---- 필지 특징 ----
function frontFlow(lot, RF) {
  let flow = 0;
  if (lot.front >= 0) {
    const f = faceInfo(lot, lot.front);
    for (const dist of [4, 8, 12]) flow = Math.max(flow, RF.at(f.cx + f.nx * dist, f.cz + f.nz * dist));
  }
  return flow;
}

/**
 * genCityBuildingsPlan(ctx): plan 및/또는 arch 용도 배정 — 3패스.
 *  1a 코어·오버라이드 결정 → 1b 이음매 띠(seam/leak) → 2 층수 조정(D7 순서) → 3 건설.
 *  ctx.plan이 없으면(arch 전용) ZONING만 쓰고 이음매·거리·시대는 건너뛴다 (lot.era = 2).
 */
export function genCityBuildingsPlan(ctx) {
  const plan = ctx.plan;
  const AR = ctx.params.arch !== 0;
  const RF = ctx.roadFlow;
  const coreT = PLAN.seam.coreT;
  const uniqueCount = {};
  const bump = (k) => { uniqueCount[k] = (uniqueCount[k] || 0) + 1; };
  const sqMap = new Map(plan ? (plan.squares || []).map((q) => [q.id, q]) : []);
  const stMap = new Map(plan ? (plan.stations || []).map((q) => [q.id, q]) : []);
  const thrMap = new Map(plan ? (plan.thresholds || []).map((q) => [q.id, q]) : []);
  const ringStations = plan ? (plan.stations || []).filter((q) => !q.spur) : [];
  const allStations = plan ? plan.stations || [] : [];
  const rel = relIndex(ctx);
  const origin = ctx.history && ctx.history.origin;

  // 사전 패스: 시그니처 필지는 C2가 짓는다 → 고유 카운트에만 반영
  for (const lot of ctx.lots) if (isSigLot(lot) && lot.sig && lot.sig.prog) bump(`${lot.district}:${lot.sig.prog}`);
  // 정문 광장마다 가장 큰 접도 필지 = '학원 앞 편의점'
  const gateShop = new Map();
  if (plan) for (const lot of ctx.lots) {
    const q = has(lot.square) ? sqMap.get(lot.square) : null;
    if (!q || q.kind !== 'gate' || lot.interior || lot.landmark || isSigLot(lot) || has(lot.release) || has(lot.stationBuilding)) continue;
    const cur = gateShop.get(q.id);
    if (cur === undefined || ctx.lots[cur].area < lot.area) gateShop.set(q.id, lot.id);
  }

  const okProg = (R, prog) => {
    const P = PROGRAMS[prog];
    if (!P) return false;
    if (P.unique && (uniqueCount[`${R.d.id}:${prog}`] || 0) >= P.unique) return false;
    if (R.square && (prog === 'mall' || prog === 'convenience') && (uniqueCount[`sq${R.square.id}:${prog}`] || 0) >= 1) return false;
    return true;
  };
  /** 가중 후보표: 기본(ZONING×TOD×PURPOSE_MULT, 이름 있는 거리 0.3/0.7 혼합) 또는 지정 표 */
  const options = (R, table) => {
    const { lot, d, feat } = R;
    const isBase = !table;
    const base = table || ZONING[d.type] || ZONING.residential;
    const tod = plan && isBase ? TOD[d.type] : null;
    let opts = [];
    for (const [prog, wf] of base) {
      if (!okProg(R, prog)) continue;
      let w = wval(wf, feat);
      if (tod && tod[prog]) w *= tod[prog](feat.walk);
      if (plan && isBase && PURPOSE_MULT[prog]) w *= PURPOSE_MULT[prog](feat.fP);
      if (w > 0) opts.push({ prog, w });
    }
    if (plan && isBase) {
      let mix = null;
      if (R.st && STREET_ZONING[R.st.kind]) { mix = STREET_ZONING[R.st.kind]; R.source = 'street'; }
      else if (lot.frontType === ROAD.PARK_PATH) { mix = STREET_ZONING.riverside; R.source = 'promenade'; }
      if (mix) {
        const so = [];
        for (const [prog, wf] of mix) { if (!okProg(R, prog)) continue; const w = wval(wf, feat); if (w > 0) so.push({ prog, w }); }
        const sd = opts.reduce((a, o) => a + o.w, 0), ss = so.reduce((a, o) => a + o.w, 0);
        if (ss > 0) {
          const m = new Map();
          for (const o of opts) m.set(o.prog, (sd > 0 ? (0.3 * o.w) / sd : 0));
          for (const o of so) m.set(o.prog, (m.get(o.prog) || 0) + (0.7 * o.w) / ss);
          opts = [...m].map(([prog, w]) => ({ prog, w }));
        }
      }
    }
    if (has(lot.compress)) for (const o of opts) if (o.prog === 'shophouse') o.w *= 2;
    return opts;
  };
  const floorsOf = (R, P) => {
    if (P.special) return 0;
    let f = Math.round(R.rng.int(P.floors[0], P.floors[1]) * R.hf);
    f = Math.max(1, Math.min(f, Math.round(P.floors[1] * 1.9)));
    if (has(R.lot.compress)) f += 1;
    if (R.stationBuilding) f = Math.max(f, Math.round(7 * R.hf));
    return f;
  };
  const decide = (R, forced, table) => {
    let prog = forced;
    if (!prog) {
      const pick = R.rng.weighted(options(R, table));
      if (!pick) { R.skip = true; return; }
      prog = pick.prog;
    }
    if (!R.source) R.source = has(R.lot.compress) ? 'compress' : 'district';
    bump(`${R.d.id}:${prog}`);
    if (R.square) bump(`sq${R.square.id}:${prog}`);
    R.prog = prog;
    R.P = PROGRAMS[prog];
    R.floors = floorsOf(R, R.P);
  };

  // ---- 패스 1a: 코어 + 오버라이드 ----
  const recs = [];
  for (const lot of ctx.lots) {
    if (isSigLot(lot)) continue;
    const d = ctx.districts[lot.district];
    const flow = frontFlow(lot, RF);
    lot.flow = flow;
    const id = cid(lot.x, lot.z);
    const st = plan && lot.street >= 0 ? streetById(ctx, lot.street) : null;
    const feat = {
      area: lot.area, corner: lot.corner, frontRank: lot.frontRank, interior: lot.interior, flow, r: Math.hypot(lot.x, lot.z), sea: ctx.distSea[id],
      dtype: d.type, fP: lot.fP || ZERO_FP, walk: lot.walk && Number.isFinite(lot.walk.station) ? lot.walk.station : Infinity, street: st ? st.kind : undefined, river: ctx.distRiver ? ctx.distRiver[id] : 1e3,
    };
    const t = plan && Number.isFinite(lot.seamT) ? lot.seamT : 1;
    const R = { lot, d, rng: lot.rng, feat, hf: heightFactor(ctx, lot), t, st, source: null, square: null, stationBuilding: false, extraCause: [] };
    recs.push(R);
    if (lot.landmark) { R.landmark = true; lot.source = 'landmark'; continue; }
    let forced = null, table = null;
    if (plan) {
      const q = has(lot.square) ? sqMap.get(lot.square) : null;
      if (has(lot.release)) { forced = 'threshold_plaza'; R.source = 'release'; R.thr = thrMap.get(lot.release); }
      else if (q && q.kind === 'gate' && gateShop.get(q.id) === lot.id) { forced = 'convenience'; R.source = 'gate'; R.square = q; R.name = '학원 앞 편의점'; }
      else if (has(lot.stationBuilding)) {
        forced = lot.area > 400 ? 'office' : 'mall'; R.source = 'ekimae'; R.stationBuilding = true;
        R.square = sqMap.get(lot.stationBuilding) || q;
        const s = R.square && has(R.square.station) ? stMap.get(R.square.station) : null;
        R.name = `${s ? s.name : '역'} 빌딩`;
      } else if (q && q.kind === 'stationFront') { table = EKIMAE; R.source = 'ekimae'; R.square = q; }
      else if (lot.heritage) { table = HERITAGE; R.source = 'heritage'; }
      if (!forced && !table && t < coreT) { R.band = true; continue; }
    }
    decide(R, forced, table);
  }
  // 패스 1a 결과로 구역 평균 층수
  const sumF = {}, nF = {};
  for (const R of recs) if (!R.band && !R.skip && !R.landmark && R.P && !R.P.special) { sumF[R.d.id] = (sumF[R.d.id] || 0) + R.floors; nF[R.d.id] = (nF[R.d.id] || 0) + 1; }
  const meanF = (id) => (nF[id] ? sumF[id] / nF[id] : undefined);

  // ---- 패스 1b: 이음매 띠 (seam / leak) ----
  for (const R of recs) {
    if (!R.band) continue;
    const { lot, d, rng, t } = R;
    const other = has(lot.other) && lot.other !== 255 ? ctx.districts[lot.other] : null;
    const key = other && other.id !== d.id ? seamKey(d.type, other.type) : null;
    const def = key ? SEAMS[key] : null;
    let table = null;
    if (def && rng.chance(PLAN.seam.pSeam * (1 - t) ** 1.5)) { table = def.table; R.source = 'seam'; R.def = def; R.other = other; lot.seamKey = key; }
    else if (!def && other && other.id !== d.id && rng.chance(PLAN.seam.pLeak * (1 - t)) && ZONING[other.type]) { table = ZONING[other.type]; R.source = 'leak'; R.other = other; }
    decide(R, null, table);
  }

  // ---- 패스 2: 층수 조정 (plan §1 D7 순서) ----
  const live = recs.filter((R) => !R.skip && !R.landmark && R.P && !R.P.special);
  const isAnchor = (R) => R.P.poi === 'anchor';
  // 1) 띠 층수 혼합
  if (plan) for (const R of live) {
    if (R.t >= coreT || R.stationBuilding) continue;
    const o = has(R.lot.other) ? meanF(R.lot.other) : undefined;
    if (o === undefined) continue;
    R.floors = Math.max(1, Math.round(R.floors + (o - R.floors) * PLAN.seam.floorBlend * (1 - R.t)));
  }
  // 2) 건축 블록 클램프: C 위계 층수는 블록 중앙값 ±2 (A§5.4.8)
  if (AR) {
    const byB = new Map();
    for (const R of live) if (R.lot.arch && R.lot.arch.tier === 'C') { if (!byB.has(R.lot.block)) byB.set(R.lot.block, []); byB.get(R.lot.block).push(R); }
    for (const list of byB.values()) {
      if (list.length < 2) continue;
      const m = median(list.map((R) => R.floors));
      for (const R of list) R.floors = Math.max(1, Math.max(m - 2, Math.min(m + 2, R.floors)));
    }
  }
  // 3) 가로 벽 (C§7 B3.5): 같은 블록·같은 접도선은 중앙값 ±1, 코너 +1
  if (plan) {
    const byF = new Map();
    for (const R of live) {
      const L = R.lot;
      if (!(L.street >= 0 || L.spine) || R.stationBuilding || isAnchor(R)) continue;
      const k = `${L.block}:${L.frontLine}`;
      if (!byF.has(k)) byF.set(k, []);
      byF.get(k).push(R);
    }
    for (const list of byF.values()) {
      if (list.length < 2) continue;
      const m = median(list.map((R) => R.floors));
      for (const R of list) R.floors = Math.max(1, Math.max(m - 1, Math.min(m + 1, R.floors)) + (R.lot.corner ? 1 : 0));
    }
  }
  // 4) 경계 높이 완화: 25m 이내 다른 구역 쌍은 2.5배 이하
  if (plan) {
    const cand = live.filter((R) => !R.stationBuilding && !isAnchor(R));
    const hash = new PointHash(16);
    for (const R of cand) hash.add(R.lot.x, R.lot.z, R);
    const rr = PLAN.height.pairR, cap = PLAN.height.ratioCap;
    for (let it = 0; it < PLAN.height.iters; it++) {
      let changed = 0;
      for (const A of cand) {
        hash.query(A.lot.x, A.lot.z, rr, (B) => {
          if (B === A || B.d.id === A.d.id) return false;
          if ((B.lot.x - A.lot.x) ** 2 + (B.lot.z - A.lot.z) ** 2 > rr * rr) return false;
          if (A.floors > cap * B.floors) { A.floors = Math.max(1, Math.floor(cap * B.floors)); changed++; }
          return false;
        });
      }
      if (!changed) break;
    }
  }
  // 5) 축선 조망 보호 (C§7 B5): 축당 최대 3필지, 최소 2층
  if (plan) for (const R of recs) {
    if (!R.landmark || !R.lot.axis) continue;
    const L = R.lot, a = L.axis;
    const Hlm = LM_H[L.landmark] || 50;
    const ex = a.x0, ez = a.z0, tx = L.x, tz = L.z;
    const len = Math.hypot(tx - ex, tz - ez);
    if (len < 40) continue;
    const seg = { x: (ex + tx) / 2, z: (ez + tz) / 2, w: len, d: 8, rot: Math.atan2(tz - ez, tx - ex) };
    const need = [];
    for (const Q of live) {
      const q = Q.lot;
      if (q.id === L.id) continue;
      const along = ((q.x - ex) * (tx - ex) + (q.z - ez) * (tz - ez)) / len;
      if (along < 30 || along > len) continue;
      if (Math.abs((-(q.x - ex) * (tz - ez) + (q.z - ez) * (tx - ex)) / len) > Math.hypot(q.w, q.d) / 2 + 4) continue;
      if (obbDistance(seg, q) > 0) continue;
      const tNear = Math.max(0, along - Math.hypot(q.w, q.d) / 2) / len;
      const rayY = 1.6 + (0.8 * Hlm - 1.6) * tNear;
      const fMax = Math.max(PLAN.height.axisMinFloors, Math.floor((rayY - 2) / WORLD.floorH));
      if (Q.floors > fMax) need.push({ Q, fMax, along });
    }
    if (!need.length) continue;
    if (need.length > PLAN.height.axisCapMax) { ctx.log('meso.axis', `${L.lmName} 축선: 가리는 필지 ${need.length}개 > ${PLAN.height.axisCapMax} — 조망 보호 생략`); continue; }
    need.sort((p, q) => q.along - p.along);
    for (const { Q, fMax } of need) {
      Q.extraCause.push({ p: 2.5, k: 'axis', t: `조망 보호: ${L.lmName} 축선 ${Q.floors}F→${fMax}F`, rel: a.rel });
      Q.floors = fMax;
      Q.axisCapped = true;
    }
    ctx.log('meso.axis', `${L.lmName} 축선 조망 보호 ${need.length}필지`);
  }
  // 6) 시그니처 무대 높이 상한 (C2: lot.arch.floorsCap)
  for (const R of live) if (R.lot.arch && R.lot.arch.floorsCap > 0) R.floors = Math.min(R.floors, R.lot.arch.floorsCap);
  // 7) 옛길 필지 ≤ 3층 + 시대(era)
  for (const R of recs) {
    const L = R.lot;
    if (!plan) { L.era = 2; continue; }
    if (L.era === undefined) {
      const near0 = origin && Math.hypot(L.x - origin.x, L.z - origin.z) < 120;
      const w = R.feat.walk;
      L.era = L.heritage || near0 ? 0 : w < 110 && ['commercial', 'center', 'residential', 'ruins'].includes(R.d.type) ? 3 : 2;
    }
    if (R.P && !R.P.special && (L.heritage || (L.era === 0 && (R.prog === 'house' || R.prog === 'old_shop')))) R.floors = Math.min(R.floors, 3);
  }

  // ---- 패스 3: 건설 ----
  let nSeam = 0, nLeak = 0, nStation = 0, nRelease = 0;
  for (const R of recs) {
    const { lot, d, rng } = R;
    if (R.landmark) { buildLandmarkLot(ctx, lot, d, rng); continue; }
    if (R.skip) continue;
    const prog = R.prog, P = R.P;
    lot.prog = prog;
    lot.source = R.source;
    lot.floors = R.floors;
    const flow = R.feat.flow;
    const cause = causeOf(ctx, R, { rel, stMap, sqMap, ringStations, allStations });
    lot.cause = cause;
    const relId = (cause.find((c) => c.rel !== undefined) || {}).rel;
    let why = `${d.name} · 접도 ${['없음', '', '골목', '생활가로', '해안', '간선'][lot.frontRank] || lot.frontRank}${lot.corner ? ' · 코너' : ''}${lot.interior ? ' · 안뜰' : ''} · 흐름 ${(flow * 100).toFixed(0)}%`;
    if (R.st) why += ` · ${R.st.name}`;
    if (R.source === 'seam') why += ` · ${shortOf(d)}↔${shortOf(R.other)} 이음매 「${R.def.name}」 t=${R.t.toFixed(2)}`;
    else if (R.source === 'leak') why += ` · ${shortOf(R.other)} 쪽 용도 스며듦 t=${R.t.toFixed(2)}`;
    if (P.special) {
      if (prog === 'threshold_plaza') nRelease++;
      buildSpecialLot(ctx, lot, d, prog, rng, why, { cause, rel: relId, thr: R.thr });
      continue;
    }
    const fp = footprintFromLot(lot, P, rng, buildToFor(ctx, lot));
    if (!fp) continue;
    const blk = { cx: lot.x, cz: lot.z, rot: lot.rot };
    const uc = (fp.u0 + fp.u1) / 2 - (lot.u0 + lot.u1) / 2, vc = (fp.v0 + fp.v1) / 2 - (lot.v0 + lot.v1) / 2;
    const [bx, bz] = localToWorld(blk, uc, vc);
    const rule = { seam: 'meso.seam', leak: 'meso.seam', ekimae: 'meso.station', heritage: 'meso.heritage', street: 'meso.street', promenade: 'meso.promenade' }[R.source] || 'meso.zoning';
    const fac = factionAt(ctx, lot.x, lot.z);
    const spec = {
      x: bx, z: bz, w: fp.u1 - fp.u0, d: fp.v1 - fp.v0, rot: lot.rot, floors: R.floors, prog, district: d.id,
      front: lot.front, sides: lot.sides, lot: lot.id, rule, why, accent: d.accent,
      arch: lot.arch || undefined,
      street: R.st ? { kind: R.st.kind, name: R.st.name, accent: R.st.accent } : undefined,
      ctxTags: {
        era: lot.era, street: R.st ? R.st.kind : lot.spine || (lot.heritage ? 'old' : undefined), seam: lot.seamKey,
        seamW: 0.5 * (1 - R.t), other: has(lot.other) ? lot.other : undefined, faction: fac ? fac.type : null, heritage: !!lot.heritage,
      },
      cause, rel: relId,
    };
    if (R.name) spec.name = R.name;
    if (R.stationBuilding && prog === 'office') spec.massing = 'podium';
    if (lot.era === 0 && (prog === 'house' || prog === 'old_shop')) { spec.roofStyle = 'gable'; spec.roofColor = jitterColor('#4d5866', rng, 0.08); }
    if (!AR && (R.source === 'seam' || R.source === 'leak') && R.other) spec.color = jitterColor(lerpHex(P.color, R.other.accent, PLAN.seam.colorBlend * (1 - R.t)), rng);
    const b = makeBuilding(ctx, spec, rng);
    // C1 makeBuilding이 아직 복사하지 않는 경우 대비 (undefined-safe)
    if (b.cause === undefined) b.cause = cause;
    if (b.rel === undefined) b.rel = relId;
    if (b.ctxTags === undefined) b.ctxTags = spec.ctxTags;
    if (b.street === undefined && spec.street) b.street = spec.street;
    lot.building = b.id;
    if (R.source === 'seam') nSeam++; else if (R.source === 'leak') nLeak++;
    if (R.stationBuilding) nStation++;
    if (P.poi || R.stationBuilding) {
      const f = lot.front >= 0 ? faceInfo(b, lot.front) : { cx: b.x, cz: b.z, nx: 0, nz: 0 };
      const isAnc = P.poi === 'anchor' || R.stationBuilding;
      ctx.addPoi({
        x: f.cx + f.nx * 2.5, z: f.cz + f.nz * 2.5, name: R.name || shopName(prog, rng), type: P.poi || 'anchor', tier: isAnc ? 1 : 2,
        district: d.id, rule: isAnc ? (R.stationBuilding ? 'meso.station' : 'intent.anchor') : rule,
        why: isAnc ? `${R.stationBuilding ? '역전 광장의 얼굴 · ' : ''}흐름 ${(flow * 100).toFixed(0)}% 필지의 핵심 활동 앵커` : why,
        building: b.id, cause, rel: relId,
      });
    }
  }
  const nCause = recs.filter((R) => R.lot.cause && R.lot.cause.length).length;
  ctx.log('meso.zoning', `조직 용도 배정: 이음매 ${nSeam}, 스며듦 ${nLeak}, 역 빌딩 ${nStation}, 문턱 쉼터 ${nRelease}, 원인 사슬 ${nCause}필지`);
  if (plan && nSeam) ctx.log('meso.seam', `이음매 띠 필지 ${nSeam} (경계 64m 띠, 코어 t≥${coreT})`);
}

/** C§8 C1 원인 사슬: 역 > 거리 > 축선 > 이음매 > 옛길 > 문턱 > 세력/흐름 > 구역 (최대 3) */
function causeOf(ctx, R, X) {
  const { lot, d, P } = R;
  const plan = ctx.plan;
  const C = [];
  if (plan) {
    const q = R.square || (has(lot.square) ? X.sqMap.get(lot.square) : null);
    const w = R.feat.walk;
    if (q && (q.kind === 'stationFront' || q.kind === 'stationBack')) {
      const s = has(q.station) ? X.stMap.get(q.station) : null;
      const ww = Number.isFinite(w) ? w : Math.hypot(lot.x - q.x, lot.z - q.z);
      C.push({ p: 1, k: 'station', t: `${s ? s.name : q.name} 도보 ${Math.round(ww)}m (역세권 ×${(1 + stationTerm(d.type, ww)).toFixed(2)})`, rel: (q.rels && q.rels[0]) ?? X.rel.touching(d.id, ['commute', 'afterschool', 'civic']) });
    } else if (q && q.kind === 'gate') {
      const A = has(q.gate) ? ctx.districts[q.gate] : null;
      C.push({ p: 1, k: 'relation', t: `${shortOf(A)} 정문 앞 광장 — 등굣길 첫 가게`, rel: (q.rels && q.rels[0]) ?? (A ? X.rel.touching(A.id, ['commute']) : undefined) });
    } else if (Number.isFinite(w) && w < 160 && X.allStations.length) {
      let s = null, bd = Infinity;
      for (const c of X.allStations) { const dd = Math.hypot(c.x - lot.x, c.z - lot.z); if (dd < bd) { bd = dd; s = c; } }
      C.push({ p: 1, k: 'station', t: `${s.name} 도보 ${Math.round(w)}m (역세권 ×${(1 + stationTerm(d.type, w)).toFixed(2)})`, rel: X.rel.touching(d.id, ['commute', 'afterschool', 'civic']) });
    }
    if (R.st) {
      const pk = R.st.purpose;
      const fp = (lot.fP && lot.fP[pk]) || 0;
      C.push({ p: 2, k: 'street', t: `${R.st.name} 변 · ${PURPOSE_KO[pk] || pk} 흐름 ${Math.round(fp * 100)}%`, rel: R.st.rel });
    }
    for (const c of R.extraCause) C.push(c);
    if ((R.source === 'seam' || R.source === 'leak') && R.other) {
      const mg = at1(ctx.seamMargin, lot.x, lot.z, 0);
      const r = X.rel.between(d.id, R.other.id) ?? X.rel.touching(d.id, ['civic']) ?? X.rel.touching(R.other.id, ['civic']);
      C.push(R.source === 'seam'
        ? { p: 3, k: 'seam', t: `${shortOf(d)}↔${shortOf(R.other)} 이음매 「${R.def.name}」 (경계 ${Math.round(mg / 2)}m)`, rel: r }
        : { p: 3, k: 'seam', t: `${shortOf(R.other)} 쪽 용도가 스며듦 (경계 ${Math.round(mg / 2)}m)`, rel: r });
    }
    if (lot.heritage) {
      const line = has(lot.frontLine) && ctx.roadLines[lot.frontLine] ? ctx.roadLines[lot.frontLine] : null;
      const nm = (line && line.name) || '강변 옛길';
      const r = (line && line.rel) ?? X.rel.touching(d.id, ['heritage']);
      C.push({ p: 4, k: 'heritage', t: prog0(R) ? `${nm} 변 ${P.label} — 1기 항구 마을` : `${nm} 변 옛 필지`, rel: r });
    }
    const thr = has(lot.compress) && plan.thresholds ? plan.thresholds.find((t) => t.id === lot.compress) : null;
    if (thr) C.push({ p: 5, k: 'threshold', t: `문턱: ${shortOf(ctx.districts[thr.from])} → ${shortOf(ctx.districts[thr.to])} (압축 ${PLAN.thresholds.compress}m)`, rel: thr.rel });
    if (R.thr) C.push({ p: 0, k: 'threshold', t: `문턱 쉼터: ${shortOf(ctx.districts[R.thr.from])} → ${shortOf(ctx.districts[R.thr.to])}`, rel: R.thr.rel });
  }
  const fac = factionAt(ctx, lot.x, lot.z);
  if (fac && fac.v >= 0.3 && !d.def.campus) C.push({ p: 6, k: 'influence', t: `${SHORT[fac.type] || fac.type} 세력권 ${Math.round(Math.min(1, fac.v) * 100)}%`, rel: plan ? X.rel.touching(d.id, ['commute', 'rivalry']) : undefined });
  if (P && P.poi === 'anchor') C.push({ p: 7, k: 'flow', t: `흐름 ${Math.round(R.feat.flow * 100)}% — 활동 앵커` });
  C.sort((a, b) => a.p - b.p);
  const out = C.slice(0, 3).map(({ k, t, rel }) => (rel === undefined ? { k, t } : { k, t, rel }));
  if (!out.length) {
    const r = plan ? X.rel.touching(d.id, ['civic']) : undefined;
    out.push(r === undefined ? { k: 'district', t: `${d.name} · ${P ? P.label : ''}` } : { k: 'district', t: `${d.name} · ${P ? P.label : ''}`, rel: r });
  }
  return out;
}
const prog0 = (R) => R.prog === 'old_shop' || R.prog === 'izakaya' || R.prog === 'house';

// ---- C§8 C3: 문턱 쉼터 (release plaza) ----
function buildReleasePlaza(ctx, lot, d, rng, why, extra) {
  const thr = extra.thr;
  const A = thr ? ctx.districts[thr.from] : null, B = thr ? ctx.districts[thr.to] || d : d;
  const rule = 'meso.threshold';
  const rel = extra.rel;
  const w2 = `문턱 쉼터: ${A ? A.name : '?'} → ${B.name} — 압축된 길이 풀리는 첫 광장`;
  const tag = rel === undefined ? {} : { rel };
  ctx.decals.push({ shape: 'rect', x: lot.x, z: lot.z, w: lot.w - 1.2, d: lot.d - 1.2, rot: lot.rot, color: '#d9cfbd' });
  for (let k = 0; k < 4; k++) {
    const a = lot.rot + Math.PI / 4 + (k * Math.PI) / 2;
    ctx.add({ shape: 'box', x: lot.x + Math.cos(a) * 3.5, y: 0, z: lot.z + Math.sin(a) * 3.5, w: 2.2, h: 0.5, d: 0.7, rot: a + Math.PI / 2, color: COLORS.bench, mat: 'std', cat: 'prop', kind: 'bench', rule, district: d.id, solid: true, why: w2, ...tag });
  }
  const f = lot.front >= 0 ? faceInfo(lot, lot.front) : { cx: lot.x, cz: lot.z, nx: Math.cos(lot.rot), nz: Math.sin(lot.rot) };
  const bx = f.cx - f.nx * 1.6, bz = f.cz - f.nz * 1.6, ba = Math.atan2(f.nz, f.nx);
  ctx.add({ shape: 'box', x: bx, y: 0, z: bz, w: 0.15, h: 1.9, d: 1.8, rot: ba, color: '#6d5a44', mat: 'std', cat: 'prop', kind: 'mapboard', rule, district: d.id, solid: true, name: `${B.name} 안내도`, why: w2, ...tag });
  ctx.add({ shape: 'box', x: bx + f.nx * 0.1, y: 0.6, z: bz + f.nz * 0.1, w: 0.04, h: 1.1, d: 1.5, rot: ba, color: '#fff3c8', mat: 'glow', cat: 'prop', kind: 'mappanel', rule, district: d.id, solid: false, ...tag });
  const [tx, tz] = lw(lot, (lot.w / 2 - 2.2) * (rng.chance(0.5) ? 1 : -1), -(lot.d / 2 - 2.2));
  addTree(ctx, tx, tz, rng, d.id, rule, false, 0.9);
  ctx.addPoi({ x: lot.x, z: lot.z, name: `${shortOf(B)} 쉼터`, type: 'micro', tier: 2, district: d.id, rule, why: w2, cause: extra.cause, ...tag });
}

// ---- C§6 A6: 광장 (역전 · 역 뒤 · 정문 · 구역 코어) ----
export function genSquares(ctx) {
  const plan = ctx.plan;
  if (!plan || !plan.squares) return;
  const rng = ctx.rng.fork('squares');
  const stMap = new Map((plan.stations || []).map((s) => [s.id, s]));
  const D = ctx.district.data;
  const counts = { stationFront: 0, stationBack: 0, gate: 0, core: 0 };
  for (const q of plan.squares) {
    const id = cid(q.x, q.z);
    const did = id >= 0 && D[id] !== 255 ? D[id] : has(q.district) ? q.district : -1;
    const dd = did >= 0 ? ctx.districts[did] : null;
    const r = q.r || 10;
    const tag = q.rels && q.rels.length ? { rel: q.rels[0] } : {};
    if (q.kind === 'stationFront') {
      const s = has(q.station) ? stMap.get(q.station) : null;
      let nx = s ? q.x - s.x : 1, nz = s ? q.z - s.z : 0;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;           // 역 → 광장 (도로는 -n 쪽)
      const tx = -nz, tz = nx, trot = Math.atan2(tz, tx);
      const sname = s ? s.name : q.name;
      const rule = 'meso.station';
      const why = `${sname} 앞 광장 — 역 = Node, 버스·택시·만남의 시계가 모이는 곳`;
      const base = { mat: 'std', cat: 'prop', rule, district: did, ...tag };
      ctx.decals.push({ shape: 'circle', x: q.x, z: q.z, w: r * 2, d: r * 2, color: '#e3ddd0' });
      ctx.decals.push({ shape: 'ring', x: q.x, z: q.z, w: r * 2 - 3, d: r * 2 - 3, color: '#c9c1b0', line: 1.2 });
      // 버스 터미널: 도로 쪽 가장자리 3면
      const side = Math.sign(-tz * nx + tx * nz) || 1; // 정류장 벽이 광장 안쪽(+n)을 향하게
      for (let k = -1; k <= 1; k++) {
        addBusStop(ctx, q.x - nx * (r - 2.5) + tx * k * 6, q.z - nz * (r - 2.5) + tz * k * 6, trot, rng, did, why, k === 0 ? `${sname} 버스 터미널` : '버스 승강장', { side, dir: [tx, tz], poi: k === 0, rule });
      }
      ctx.decals.push({ shape: 'rect', x: q.x + tx * (r * 0.55) - nx * (r * 0.6), z: q.z + tz * (r * 0.55) - nz * (r * 0.6), w: 8, d: 4, rot: trot, color: '#8f949a', stripes: true });
      // 만남의 시계
      ctx.add({ ...base, shape: 'cyl', x: q.x, y: 0, z: q.z, w: 0.3, h: 4, d: 0.3, rot: 0, color: '#5b6070', kind: 'clockpole', solid: true, name: '만남의 시계', why });
      for (const sg of [-1, 1]) ctx.add({ ...base, shape: 'cyl', x: q.x + nx * 0.2 * sg, y: 3.4, z: q.z + nz * 0.2 * sg, w: 1.2, h: 0.15, d: 1.2, rot: trot, color: '#fff6d8', mat: 'glow', kind: 'clockface', solid: false, rx: Math.PI / 2 });
      // 자전거 거치대 6
      for (let k = 0; k < 6; k++) ctx.add({ ...base, shape: 'box', x: q.x + nx * (r * 0.65) + tx * (k - 2.5) * 1.6, y: 0, z: q.z + nz * (r * 0.65) + tz * (k - 2.5) * 1.6, w: 1.8, h: 0.5, d: 0.8, rot: Math.atan2(nz, nx), color: '#5a5f6b', kind: 'bikerack', solid: true });
      // 화분 + 나무 4
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = q.x + tx * a * r * 0.45 + nx * b * r * 0.3, pz = q.z + tz * a * r * 0.45 + nz * b * r * 0.3;
        ctx.add({ ...base, shape: 'box', x: px, y: 0, z: pz, w: 2, h: 0.6, d: 2, rot: trot, color: '#9a8a72', kind: 'planter', solid: true });
        addTree(ctx, px, pz, rng, did, rule, false, 0.7);
      }
      ctx.addPoi({ x: q.x, z: q.z, name: q.name || `${sname} 광장`, type: 'anchor', tier: 1, district: did, rule, why, cause: [{ k: 'station', t: '역 = Node · 환상선 정차' }], ...tag });
      counts.stationFront++;
    } else if (q.kind === 'stationBack') {
      ctx.decals.push({ shape: 'circle', x: q.x, z: q.z, w: r * 2, d: r * 2, color: '#ddd6c6' });
      counts.stationBack++;
    } else if (q.kind === 'gate') {
      const A = has(q.gate) ? ctx.districts[q.gate] : dd;
      const g = A && A.gate;
      let nx = g ? g.dir[0] : 1, nz = g ? g.dir[1] : 0;
      const tx = -nz, tz = nx, trot = Math.atan2(tz, tx);
      const rule = 'macro.plan';
      const why = `${A ? A.name : ''} 정문 앞 광장 — 환상대로·방사 대로가 정문과 만나는 등굣길의 시작`;
      const base = { mat: 'std', cat: 'prop', rule, district: did, ...tag };
      ctx.decals.push({ shape: 'circle', x: q.x, z: q.z, w: r * 2, d: r * 2, color: '#e6dfcf' });
      addBusStop(ctx, q.x + nx * (r - 2), q.z + nz * (r - 2), trot, rng, did, why, `${shortOf(A)} 앞`, { side: Math.sign(-tz * -nx + tx * -nz) || 1, dir: [tx, tz], rule });
      for (const sg of [-1, 1]) addTree(ctx, q.x + tx * sg * (r - 2.5), q.z + tz * sg * (r - 2.5), rng, did, rule, true, 0.9);
      for (let k = 0; k < 4; k++) ctx.add({ ...base, shape: 'box', x: q.x - tx * (r * 0.55) + nx * (k - 1.5) * 1.6, y: 0, z: q.z - tz * (r * 0.55) + nz * (k - 1.5) * 1.6, w: 1.8, h: 0.5, d: 0.8, rot: trot, color: '#5a5f6b', kind: 'bikerack', solid: true });
      // 정문 쪽 횡단보도: 환상대로 위 정문 교차점 (가까운 환상선 점의 접선)
      const ring = plan.ring && plan.ring.pts;
      if (g && ring && ring.length > 2) {
        const jx = g.x + nx * PLAN.ring.gateJunction, jz = g.z + nz * PLAN.ring.gateJunction;
        let bi = -1, bd = 15 * 15;
        for (let k = 0; k < ring.length; k++) { const d2 = (ring[k].x - jx) ** 2 + (ring[k].z - jz) ** 2; if (d2 < bd) { bd = d2; bi = k; } }
        if (bi >= 0) {
          const p0 = ring[Math.max(0, bi - 1)], p1 = ring[Math.min(ring.length - 1, bi + 1)];
          ctx.decals.push({ shape: 'crosswalk', x: ring[bi].x, z: ring[bi].z, w: 3.2, d: PLAN.ring.width, rot: Math.atan2(p1.z - p0.z, p1.x - p0.x), color: '#f4f4f4' });
        }
      }
      counts.gate++;
    } else if (q.kind === 'core') {
      const rule = 'macro.plan';
      const why = `${dd ? dd.name : ''} 코어 광장 — 방사 대로가 끝나는 구역의 얼굴`;
      const base = { mat: 'std', cat: 'prop', rule, district: did, ...tag };
      ctx.decals.push({ shape: 'circle', x: q.x, z: q.z, w: r * 2, d: r * 2, color: '#e2dccb' });
      ctx.add({ ...base, shape: 'cyl', x: q.x, y: 0, z: q.z, w: 6, h: 0.6, d: 6, rot: 0, color: '#b9b2a2', kind: 'plinth', solid: true });
      ctx.add({ ...base, shape: 'cyl', x: q.x, y: 0.6, z: q.z, w: 1.2, h: 3, d: 1.2, rot: 0, color: '#8a8f9a', kind: 'statue', solid: true, name: `${shortOf(dd)} 광장 동상`, why });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.4;
        ctx.add({ ...base, shape: 'box', x: q.x + Math.cos(a) * 6, y: 0, z: q.z + Math.sin(a) * 6, w: 2.2, h: 0.5, d: 0.7, rot: a + Math.PI / 2, color: COLORS.bench, kind: 'bench', solid: true, why: '동상을 바라보는 벤치' });
      }
      ctx.addPoi({ x: q.x, z: q.z, name: q.name || `${shortOf(dd)} 광장`, type: 'micro', tier: 2, district: did, rule, why, cause: [{ k: 'district', t: `${shortOf(dd)} 코어 · 방사 대로 종점` }], ...tag });
      counts.core++;
    }
  }
  ctx.log('meso.station', `광장: 역전 ${counts.stationFront}, 역 뒤 ${counts.stationBack}, 정문 ${counts.gate}, 코어 ${counts.core}`);
}
