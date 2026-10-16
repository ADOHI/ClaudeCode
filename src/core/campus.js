// 학원 캠퍼스 문법 (shape grammar + 제약 탐색 배치).
// 축선: 정문 → 전정 → 중정(Quad) → 본관(시계탑 = 구역 랜드마크). 측면 교사동.
// 나머지 프로그램(운동장, 체육관, 동아리동, 기숙사, 식당, 특수동, 구교사)은 점수 기반 위치 탐색.
import { ROAD, ZONE, WORLD, COLORS } from './config.js';
import { makeBuilding, jitterColor } from './buildings.js';
import { addTree } from './city.js';

const H = WORLD.half, N = WORLD.size;
const cid = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

const STYLE = {
  trad_academy: { bld: COLORS.school, roofCol: '#4a6a8a', tower: 'bell', special: { name: '성당', w: 16, d: 30, floors: 3, color: COLORS.chapel }, extra: { name: '장미 온실', w: 14, d: 9, floors: 1, color: '#bfe6d6', glass: true }, tree: 'sakura' },
  tech_academy: { bld: COLORS.school_tech, roofCol: '#5a6b7a', tower: 'antenna', special: { name: '슈퍼컴퓨터동', w: 30, d: 20, floors: 2, color: COLORS.server }, extra: { name: '드론 발착장', pad: true, w: 16, d: 16 }, tree: 'tree' },
  free_academy: { bld: COLORS.school_free, roofCol: '#6a3a34', tower: 'water', special: { name: '오토바이 차고', w: 26, d: 16, floors: 1, color: COLORS.garage }, extra: { name: '고철 야적장', scrap: true, w: 18, d: 14 }, tree: 'tree' },
  arts_academy: { bld: COLORS.school_arts, roofCol: '#6b4a8a', tower: 'star', special: { name: '콘서트홀', w: 30, d: 26, floors: 3, color: COLORS.hall, dome: true }, extra: { name: '야외 원형무대', stage: true, w: 22, d: 18 }, tree: 'sakura' },
};

export function genCampuses(ctx) {
  for (const d of ctx.districts) {
    if (!d.def.campus || !d.gate) continue;
    genCampus(ctx, d);
  }
}

function genCampus(ctx, d) {
  const rng = ctx.rng.fork(`campus${d.id}`);
  const st = STYLE[d.type];
  const Z = ctx.zone.data, OW = ctx.zoneOwner, R = ctx.road.data;
  const ux = -d.gate.dir[0], uz = -d.gate.dir[1];
  const rot = Math.atan2(uz, ux);
  const gx = d.gate.x, gz = d.gate.z;
  const toW = (u, v) => [gx + u * ux - v * uz, gz + u * uz + v * ux];
  const inCampus = (x, z) => {
    const id = cid(x, z);
    return id >= 0 && Z[id] === ZONE.CAMPUS && OW[id] === d.id && !R[id];
  };
  // 캠퍼스 로컬 범위
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, area = 0;
  for (let id = 0; id < N * N; id++) {
    if (Z[id] !== ZONE.CAMPUS || OW[id] !== d.id) continue;
    const x = (id % N) - H + 0.5 - gx, z = ((id / N) | 0) - H + 0.5 - gz;
    const u = x * ux + z * uz, v = -x * uz + z * ux;
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    area++;
  }
  if (!area) return;
  const campus = { d, rot, toW, umin, umax, vmin, vmax, rects: [], buildings: [] };
  d.campus = campus;
  const fits = (r, margin = 3) => {
    const nu = Math.floor((r.u1 - r.u0 + 2 * margin) / 3) + 1, nv = Math.floor((r.v1 - r.v0 + 2 * margin) / 3) + 1;
    const allowed = Math.floor(nu * nv * 0.015);
    let fails = 0;
    // 외곽선 먼저 (대부분의 실패는 가장자리에서)
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < nu; a++) {
        for (let b = 0; b < nv; b++) {
          const edge = a === 0 || b === 0 || a === nu - 1 || b === nv - 1;
          if ((pass === 0) !== edge) continue;
          const [x, z] = toW(r.u0 - margin + a * 3, r.v0 - margin + b * 3);
          if (!inCampus(x, z) && ++fails > allowed) return false;
        }
      }
    }
    return true;
  };
  const overlaps = (r, gap = 5) => campus.rects.some((o) => !(r.u1 + gap < o.u0 || o.u1 + gap < r.u0 || r.v1 + gap < o.v0 || o.v1 + gap < r.v0));
  const obb = (r) => {
    const [x, z] = toW((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    return { x, z, w: r.u1 - r.u0, d: r.v1 - r.v0, rot };
  };
  const pathTo = (u0, v0, u1, v1, w = 3) => campus.paths.push({ a: toW(u0, v0), b: toW(u1, v1), w });
  campus.paths = [];

  // 1) 정문 + 전정
  const gateRule = 'meso.campus';
  const gateWhy = '정문은 중앙탑을 향한다 — 진입대로·축선·비스타의 시작점';
  for (const s of [-1, 1]) {
    const [px, pz] = toW(1, s * 6);
    ctx.add({ shape: 'box', x: px, y: 0, z: pz, w: 1.4, h: 5, d: 1.4, rot, color: d.accent, mat: 'std', cat: 'building', kind: 'gatepost', rule: gateRule, district: d.id, solid: true });
  }
  {
    const [px, pz] = toW(1, 0);
    ctx.add({ shape: 'box', x: px, y: 5, z: pz, w: 1.6, h: 1.2, d: 14, rot, color: d.accent, mat: 'std', cat: 'building', kind: 'gatebeam', rule: gateRule, district: d.id, solid: false, name: `${d.name} 정문`, why: gateWhy });
    const [bx, bz] = toW(4, 9);
    ctx.add({ shape: 'box', x: bx, y: 0, z: bz, w: 3, h: 2.8, d: 2.4, rot, color: '#d9d4c7', mat: 'std', cat: 'building', kind: 'guardbooth', rule: gateRule, district: d.id, solid: true });
    const [nx, nz] = toW(5, -10);
    ctx.add({ shape: 'box', x: nx, y: 0.6, z: nz, w: 0.3, h: 1.8, d: 3.6, rot, color: '#7a5a3a', mat: 'std', cat: 'prop', kind: 'noticeboard', rule: 'micro.poster', district: d.id, solid: true, name: '동아리 모집 게시판', why: '정문 옆 게시판 — 학원 생활의 첫인상' });
    for (let k = 0; k < 4; k++) {
      const [qx, qz] = toW(5 - 0.2, -11.4 + k * 0.95);
      ctx.add({ shape: 'box', x: qx, y: 1.3, z: qz, w: 0.05, h: 0.8, d: 0.7, rot, color: rng.pick(['#ff9ec4', '#9ee7ff', '#ffe28a', '#b9f5c4']), mat: 'glow', cat: 'facade', kind: 'poster', rule: 'micro.poster', district: d.id, solid: false });
    }
  }
  ctx.addPoi({ x: gx + ux * 6, z: gz + uz * 6, name: `${d.name} 정문`, type: 'gate', tier: 1, district: d.id, rule: gateRule, why: gateWhy });
  campus.rects.push({ u0: -2, u1: 14, v0: -12, v1: 12, kind: 'forecourt' });
  ctx.decals.push({ shape: 'rect', ...obb({ u0: 0, u1: 16, v0: -11, v1: 11 }), color: '#d8d2c4' });

  // 2) 중정 + 본관 (축선 문법, 길이를 줄여가며 맞춘다)
  const wq = Math.max(16, Math.min(30, (vmax - vmin) * 0.17));
  let quad = null, main = null;
  for (const Lq of [72, 60, 48, 38, 28]) {
    const q = { u0: 18, u1: 18 + Lq, v0: -wq, v1: wq };
    const m = { u0: q.u1 + 5, u1: q.u1 + 27, v0: -(wq + 16), v1: wq + 16 };
    if (fits(q, 1) && fits(m)) { quad = q; main = m; break; }
    const m2 = { u0: q.u1 + 5, u1: q.u1 + 25, v0: -(wq + 6), v1: wq + 6 };
    if (fits(q, 1) && fits(m2)) { quad = q; main = m2; break; }
  }
  if (!quad) {
    quad = { u0: 18, u1: 40, v0: -14, v1: 14 };
    main = { u0: 44, u1: 64, v0: -20, v1: 20 };
  }
  campus.rects.push({ ...quad, kind: 'quad' }, { ...main, kind: 'main' });
  ctx.decals.push({ shape: 'rect', ...obb(quad), color: '#9fd18a' });
  pathTo(0, 0, main.u0, 0, 6);
  pathTo((quad.u0 + quad.u1) / 2, quad.v0, (quad.u0 + quad.u1) / 2, quad.v1, 3);
  {
    const [cx, cz] = toW((quad.u0 + quad.u1) / 2, 0);
    if (d.type === 'tech_academy') {
      ctx.add({ shape: 'oct', x: cx, y: 2, z: cz, w: 3, h: 4, d: 3, rot: 0, color: '#4fd1ff', mat: 'glow', cat: 'prop', kind: 'holo', rule: 'meso.campus', district: d.id, solid: false, name: '홀로그램 조형물' });
      ctx.add({ shape: 'cyl', x: cx, y: 0, z: cz, w: 4, h: 1.5, d: 4, rot: 0, color: '#c3ccd6', mat: 'std', cat: 'prop', kind: 'pedestal', rule: 'meso.campus', district: d.id, solid: true });
    } else {
      ctx.add({ shape: 'cyl', x: cx, y: 0, z: cz, w: 10, h: 0.7, d: 10, rot: 0, color: '#9ccfe8', mat: 'std', cat: 'prop', kind: 'fountain', rule: 'meso.campus', district: d.id, solid: true });
      ctx.add({ shape: 'cyl', x: cx, y: 0.7, z: cz, w: 1.2, h: 3, d: 1.2, rot: 0, color: '#f0eee8', mat: 'std', cat: 'prop', kind: 'statue', rule: 'meso.campus', district: d.id, solid: true, name: '창립자 동상' });
    }
    ctx.addPoi({ x: cx, z: cz, name: '중정', type: 'micro', tier: 2, district: d.id, rule: 'meso.campus', why: '정문-본관 축선의 중간 휴식 노드' });
    // 중정 양옆 가로수 (학원별 수종)
    for (let u = quad.u0 + 4; u < quad.u1 - 2; u += 8) {
      for (const s of [-1, 1]) {
        const [tx, tz] = toW(u, s * (wq - 2));
        addTree(ctx, tx, tz, rng, d.id, 'meso.campus', st.tree === 'sakura');
      }
    }
    for (let u = quad.u0 + 8; u < quad.u1 - 4; u += 16) {
      for (const s of [-1, 1]) {
        const [bx, bz] = toW(u, s * (wq - 5));
        ctx.add({ shape: 'box', x: bx, y: 0, z: bz, w: 2.2, h: 0.5, d: 0.7, rot, color: COLORS.bench, mat: 'std', cat: 'prop', kind: 'bench', rule: 'micro.bench', district: d.id, solid: true });
      }
    }
  }
  // 본관
  const floors = d.type === 'tech_academy' ? 5 : 4;
  const mainB = makeBuilding(ctx, { ...obb(main), floors, prog: 'school', district: d.id, front: 0, sides: [0, 0, 0, 0], rule: 'meso.campus', why: '축선 종결점 — 정문에서 정면으로 보이는 본관', name: `${d.name} 본관`, color: st.bld, roof: 'school', campus: true }, rng);
  campus.buildings.push({ b: mainB, kind: 'main' });
  campus.main = mainB;
  ctx.addPoi({ x: toW(main.u0 - 3, 0)[0], z: toW(main.u0 - 3, 0)[1], name: `${d.name} 본관`, type: 'anchor', tier: 1, district: d.id, rule: 'meso.campus', why: '정문-중정-본관 축선', building: mainB.id });
  ctx.hubs.push({ x: toW(main.u0 - 3, 0)[0], z: toW(main.u0 - 3, 0)[1], w: 1.3, name: `${d.name} 본관` });
  // 시계탑 = 학원 랜드마크
  {
    const ts = 9;
    const tu = main.u0 + 6;
    const [tx, tz] = toW(tu, 0);
    const th = mainB.h + (d.type === 'tech_academy' ? 14 : 18);
    ctx.add({ shape: 'box', x: tx, y: 0, z: tz, w: ts, h: th, d: ts, rot, color: jitterColor(st.bld, rng, 0.04), mat: 'bld', cat: 'landmark', kind: 'schooltower', rule: 'intent.landmark', district: d.id, solid: true, name: `${d.name} 시계탑`, why: '본관 축선 위 탑 — 학원 실루엣의 핵' });
    const [fx, fz] = toW(tu - ts / 2 - 0.1, 0);
    ctx.add({ shape: 'cyl', x: fx, y: th - 5, z: fz, w: 5, h: 0.3, d: 5, rot: rot + Math.PI / 2, color: '#fff6d8', mat: 'glow', cat: 'landmark', kind: 'clockface', rule: 'intent.landmark', district: d.id, solid: false, rx: Math.PI / 2 });
    let top = th;
    if (st.tower === 'bell') {
      ctx.add({ shape: 'cone', x: tx, y: th, z: tz, w: ts * 1.2, h: 12, d: ts * 1.2, rot: rot + Math.PI / 4, color: st.roofCol, mat: 'std', cat: 'landmark', kind: 'towerroof', rule: 'intent.landmark', district: d.id, solid: true, sides: 4 });
      top += 12;
    } else if (st.tower === 'antenna') {
      ctx.add({ shape: 'cyl', x: tx, y: th, z: tz, w: 0.8, h: 26, d: 0.8, rot: 0, color: '#dfe6ee', mat: 'std', cat: 'landmark', kind: 'mast', rule: 'intent.landmark', district: d.id, solid: false });
      for (let k = 0; k < 3; k++) ctx.add({ shape: 'torus', x: tx, y: th + 6 + k * 7, z: tz, w: 7 - k * 1.8, h: 7 - k * 1.8, d: 0.4, rot: 0, color: '#4fd1ff', mat: 'glow', cat: 'landmark', kind: 'ring', rule: 'intent.landmark', district: d.id, solid: false, rx: Math.PI / 2 });
      top += 26;
    } else if (st.tower === 'water') {
      ctx.add({ shape: 'cyl', x: tx, y: th, z: tz, w: 8, h: 6, d: 8, rot: 0, color: '#9a8a84', mat: 'std', cat: 'landmark', kind: 'tank', rule: 'intent.landmark', district: d.id, solid: true });
      ctx.add({ shape: 'box', x: tx, y: th + 6, z: tz, w: 0.2, h: 8, d: 0.2, rot: 0, color: '#555', mat: 'std', cat: 'landmark', kind: 'flagpole', rule: 'intent.landmark', district: d.id, solid: false });
      ctx.add({ shape: 'box', x: tx + 1.6 * Math.cos(rot), y: th + 11.5, z: tz + 1.6 * Math.sin(rot), w: 3.2, h: 2, d: 0.08, rot, color: '#e0413b', mat: 'glow', cat: 'landmark', kind: 'flag', rule: 'intent.landmark', district: d.id, solid: false, name: '레드라인 깃발' });
      top += 14;
    } else {
      ctx.add({ shape: 'cone', x: tx, y: th, z: tz, w: ts, h: 8, d: ts, rot, color: st.roofCol, mat: 'std', cat: 'landmark', kind: 'towerroof', rule: 'intent.landmark', district: d.id, solid: true, sides: 4 });
      ctx.add({ shape: 'oct', x: tx, y: th + 9, z: tz, w: 4, h: 5, d: 4, rot: 0, color: '#ffe28a', mat: 'glow', cat: 'landmark', kind: 'star', rule: 'intent.landmark', district: d.id, solid: false });
      top += 14;
    }
    ctx.addLandmark({ name: `${d.name} 시계탑`, x: tx, z: tz, h: top, district: d.id, kind: 'schooltower', why: '축선 비스타 종결점' });
  }
  // 3) 측면 교사동
  const wingRects = [];
  for (const s of [-1, 1]) {
    for (const len of [quad.u1 - quad.u0, (quad.u1 - quad.u0) * 0.75, (quad.u1 - quad.u0) * 0.5]) {
      const r = s < 0 ? { u0: quad.u0 + 2, u1: quad.u0 + 2 + len, v0: -wq - 18, v1: -wq - 4 } : { u0: quad.u0 + 2, u1: quad.u0 + 2 + len, v0: wq + 4, v1: wq + 18 };
      if (fits(r) && !overlaps(r, 1)) { wingRects.push([r, s]); break; }
    }
  }
  for (const [r, s] of wingRects) {
    campus.rects.push({ ...r, kind: 'wing' });
    const b = makeBuilding(ctx, { ...obb(r), floors: 3, prog: 'school', district: d.id, front: s < 0 ? 3 : 2, sides: [0, 0, 0, 0], rule: 'meso.campus', why: '중정을 감싸는 교사동 — 위요감', name: `교사동 ${s < 0 ? 'A' : 'B'}`, color: st.bld, roof: 'res', campus: true }, rng);
    campus.buildings.push({ b, kind: 'wing' });
  }

  // 4) 나머지 프로그램: 점수 기반 위치 탐색
  const items = [
    { key: 'field', name: '운동장', w: 84, d: 50, min: 0.62, open: true, score: (r) => Math.abs((r.v0 + r.v1) / 2) * 0.6 + (r.u0 + r.u1) * 0.15 },
    { key: 'gym', name: '체육관', w: 34, d: 24, floors: 3, color: COLORS.gym, prog: 'gym', score: (r, P) => -nearDist(r, P.field) * 1.5 + (r.u0 + r.u1) * 0.1 },
    { key: 'special', ...st.special, score: (r) => -Math.abs(Math.abs((r.v0 + r.v1) / 2) - (wq + 40)) - Math.abs((r.u0 + r.u1) / 2 - main.u0) * 0.5 },
    { key: 'club', name: '동아리동', w: 26, d: 12, floors: 3, color: COLORS.club, score: (r) => Math.abs((r.v0 + r.v1) / 2) * 0.8 },
    { key: 'cafeteria', name: '학생식당', w: 24, d: 16, floors: 2, color: COLORS.cafeteria, score: (r) => -Math.abs((r.u0 + r.u1) / 2 - main.u1) - Math.abs((r.v0 + r.v1) / 2) * 0.3 },
    { key: 'dorm', name: '학원 기숙사', w: 38, d: 13, floors: 5, color: COLORS.dorm, score: (r) => (r.u0 + r.u1) * 0.5 },
    { key: 'oldschool', name: '구교사', w: 26, d: 11, floors: 2, color: COLORS.oldschool, score: (r) => (r.u0 + r.u1) * 1.0 + Math.abs((r.v0 + r.v1) / 2) * 0.5 },
    { key: 'extra', ...st.extra, score: (r) => -Math.abs((r.u0 + r.u1) / 2 - (quad.u0 + quad.u1) / 2) * 0.5 + Math.abs((r.v0 + r.v1) / 2) * 0.3 },
  ];
  const placed = {};
  for (const it of items) {
    let best = null, bs = -Infinity;
    for (const scale of [1, 0.85, it.min || 0.72]) {
      for (const turn of [false, true]) {
        const w = (turn ? it.d : it.w) * scale, dd = (turn ? it.w : it.d) * scale;
        for (let u = umin + 4; u + w < umax - 2; u += 4) {
          for (let v = vmin + 4; v + dd < vmax - 2; v += 4) {
            const r = { u0: u, u1: u + w, v0: v, v1: v + dd };
            if (overlaps(r, it.open ? 6 : 6)) continue;
            if (!fits(r, 3)) continue;
            const s = it.score(r, placed) + scale * 30;
            if (s > bs) { bs = s; best = r; }
          }
        }
      }
      if (best) break;
    }
    if (!best) continue;
    placed[it.key] = best;
    campus.rects.push({ ...best, kind: it.key });
    const o = obb(best);
    const mid = (best.v0 + best.v1) / 2;
    const front = Math.abs(mid) > Math.abs((best.u0 + best.u1) / 2 - main.u0) * 0.6 ? (mid > 0 ? 2 : 3) : 0;
    if (it.key === 'field') {
      ctx.decals.push({ shape: 'track', ...o, color: '#c9a26b' });
      ctx.addPoi({ x: o.x, z: o.z, name: '운동장', type: 'micro', tier: 2, district: d.id, rule: 'meso.campus', why: '체육관과 붙여 배치' });
      // 스탠드
      const [sx, sz] = toW((best.u0 + best.u1) / 2, best.v0 - 2.5);
      ctx.add({ shape: 'box', x: sx, y: 0, z: sz, w: (best.u1 - best.u0) * 0.5, h: 1.6, d: 3, rot, color: '#b9b2a4', mat: 'std', cat: 'prop', kind: 'bleacher', rule: 'meso.campus', district: d.id, solid: true });
    } else if (it.pad) {
      ctx.decals.push({ shape: 'circle', x: o.x, z: o.z, w: 14, d: 14, color: '#4f5f73' });
      ctx.decals.push({ shape: 'ring', x: o.x, z: o.z, w: 11, d: 11, color: '#4fd1ff', line: 0.6 });
      ctx.add({ shape: 'box', x: o.x, y: 0, z: o.z, w: 1.4, h: 0.6, d: 1.4, rot, color: '#d0d6de', mat: 'std', cat: 'prop', kind: 'drone', rule: 'meso.campus', district: d.id, solid: false });
      ctx.addPoi({ x: o.x, z: o.z, name: it.name, type: 'micro', tier: 2, district: d.id, rule: 'meso.campus', why: '테크 학원 특화 부지' });
    } else if (it.scrap) {
      for (let k = 0; k < 7; k++) {
        const [px, pz] = toW(best.u0 + rng.range(2, best.u1 - best.u0 - 2), best.v0 + rng.range(2, best.v1 - best.v0 - 2));
        ctx.add({ shape: rng.pick(['box', 'cyl']), x: px, y: 0, z: pz, w: rng.range(1, 3), h: rng.range(0.6, 2.2), d: rng.range(1, 3), rot: rng.range(0, 3), color: rng.pick(['#7d6a5a', '#a0522d', '#5f6b73', '#c19a6b']), mat: 'std', cat: 'prop', kind: 'scrap', rule: 'meso.campus', district: d.id, solid: true });
      }
      ctx.decals.push({ shape: 'rect', ...o, color: '#b7a693' });
      ctx.addPoi({ x: o.x, z: o.z, name: it.name, type: 'micro', tier: 2, district: d.id, rule: 'meso.campus', why: '자유학원 아지트 소품' });
    } else if (it.stage) {
      ctx.add({ shape: 'cyl', x: o.x, y: 0, z: o.z, w: 12, h: 1.2, d: 12, rot: 0, color: '#d6c3e6', mat: 'std', cat: 'prop', kind: 'stage', rule: 'meso.campus', district: d.id, solid: true });
      for (let k = 0; k < 3; k++) {
        ctx.add({ shape: 'torus', x: o.x, y: 0, z: o.z, w: 18 + k * 5, h: 18 + k * 5, d: 0.7, rot: 0, color: '#b9a6cc', mat: 'std', cat: 'prop', kind: 'seats', rule: 'meso.campus', district: d.id, solid: false, rx: Math.PI / 2 });
      }
      ctx.addPoi({ x: o.x, z: o.z, name: it.name, type: 'anchor', tier: 1, district: d.id, rule: 'meso.campus', why: '예술학원 공연 거점' });
    } else {
      const prog = it.key === 'dorm' ? 'dorm' : it.key === 'oldschool' ? 'ruin' : 'school';
      const b = makeBuilding(ctx, { ...o, floors: it.floors || 2, prog, massing: 'box', district: d.id, front, sides: [0, 0, 0, 0], rule: 'meso.campus', why: `${it.name}: 캠퍼스 문법 탐색 배치`, name: it.name, color: jitterColor(it.color || st.bld, rng, 0.04), roof: it.glass ? 'flat' : it.key === 'oldschool' ? 'ruin' : 'res', campus: true }, rng);
      campus.buildings.push({ b, kind: it.key });
      if (it.dome) ctx.add({ shape: 'sphere', x: o.x, y: b.h - 2, z: o.z, w: Math.min(o.w, o.d) * 0.8, h: 10, d: Math.min(o.w, o.d) * 0.8, rot: 0, color: '#b48fd8', mat: 'std', cat: 'building', kind: 'dome', rule: 'meso.campus', district: d.id, solid: true });
      if (it.key === 'special' && d.type === 'trad_academy') {
        ctx.add({ shape: 'cone', x: o.x, y: b.h, z: o.z, w: 5, h: 14, d: 5, rot: rot + Math.PI / 4, color: st.roofCol, mat: 'std', cat: 'building', kind: 'chapelspire', rule: 'meso.campus', district: d.id, solid: true, sides: 4 });
      }
      if (it.key === 'special' && d.type === 'tech_academy') {
        ctx.add({ shape: 'cyl', x: o.x, y: b.h, z: o.z, w: 8, h: 0.6, d: 8, rot: 0, color: '#e6ebf0', mat: 'std', cat: 'roof', kind: 'dish', rule: 'meso.campus', district: d.id, solid: true, rx: 0.5 });
      }
      const poiType = { gym: 'micro', club: 'anchor', cafeteria: 'anchor', dorm: 'dorm', oldschool: 'micro', special: 'anchor', extra: 'micro' }[it.key] || 'micro';
      const f = b.front >= 0 ? b : null;
      ctx.addPoi({ x: o.x, z: o.z, name: it.name, type: poiType, tier: poiType === 'anchor' ? 1 : 2, district: d.id, rule: 'meso.campus', why: it.key === 'oldschool' ? '정문에서 가장 먼 곳 — 괴담이 생기는 자리' : '캠퍼스 프로그램', building: b.id });
      if (it.key === 'cafeteria' || it.key === 'club') ctx.hubs.push({ x: o.x, z: o.z, w: 0.7, name: it.name });
      void f;
    }
    // 축선에서 각 시설로 가는 길 (ㄱ자)
    const cu = (best.u0 + best.u1) / 2, cv = (best.v0 + best.v1) / 2;
    const edgeV = cv > 0 ? best.v0 : best.v1;
    pathTo(cu, 0, cu, edgeV, 3);
  }
  campus.placed = placed;

  // 5) 나무: 빈 캠퍼스 녹지에 포아송 배치
  const trees = [];
  for (let t = 0; t < 600 && trees.length < 60; t++) {
    const u = rng.range(umin, umax), v = rng.range(vmin, vmax);
    const r = { u0: u - 2, u1: u + 2, v0: v - 2, v1: v + 2 };
    if (overlaps(r, 2)) continue;
    if (!fits(r, 2)) continue;
    if (Math.abs(v) < 5) continue;
    if (trees.some(([a, b]) => (a - u) ** 2 + (b - v) ** 2 < 64)) continue;
    trees.push([u, v]);
    const [x, z] = toW(u, v);
    addTree(ctx, x, z, rng, d.id, 'meso.campus', st.tree === 'sakura' && rng.chance(0.4));
  }

  // 6) 경로 래스터화 (campus path)
  for (const p of campus.paths) stampPath(ctx, p.a, p.b, p.w, ROAD.CAMPUS_PATH, (x, z) => inCampus(x, z) || ctx.road.data[cid(x, z)] === ROAD.CAMPUS_PATH);

  // 7) 담장: 정문/후문/개구멍만 열어둔다
  genWall(ctx, d, campus, rng, inCampus, placed);
}

function nearDist(r, o) {
  if (!o) return 0;
  const dx = Math.max(0, Math.max(o.u0 - r.u1, r.u0 - o.u1));
  const dz = Math.max(0, Math.max(o.v0 - r.v1, r.v0 - o.v1));
  return Math.hypot(dx, dz);
}

export function stampPath(ctx, a, b, w, type, okFn) {
  const R = ctx.road.data;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const hw = w / 2;
  for (let s = 0; s <= L; s += 0.7) {
    const t = L ? s / L : 0;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    for (let dz = -hw; dz <= hw; dz += 0.7) for (let dx = -hw; dx <= hw; dx += 0.7) {
      if (dx * dx + dz * dz > hw * hw) continue;
      const id = cid(x + dx, z + dz);
      if (id < 0) continue;
      if (!okFn(x + dx, z + dz)) continue;
      if (R[id] === ROAD.NONE) R[id] = type;
    }
  }
}

function genWall(ctx, d, campus, rng, inCampus, placed) {
  const Z = ctx.zone.data, OW = ctx.zoneOwner;
  const isC = (id) => id >= 0 && Z[id] === ZONE.CAMPUS && OW[id] === d.id;
  const boundary = [];
  for (let id = 0; id < N * N; id++) {
    if (!isC(id)) continue;
    const i = id % N, j = (id / N) | 0;
    if (i < 2 || j < 2 || i > N - 3 || j > N - 3) continue;
    if (!isC(id - 1) || !isC(id + 1) || !isC(id - N) || !isC(id + N)) boundary.push(id);
  }
  // 후문: 정문 반대편 경계 중 바깥이 도로인 곳
  const gate = d.gate;
  let back = null, bd = -1;
  const R = ctx.road.data;
  for (const id of boundary) {
    const x = (id % N) - H + 0.5, z = ((id / N) | 0) - H + 0.5;
    const dist = Math.hypot(x - gate.x, z - gate.z);
    if (dist < bd) continue;
    let road = false;
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) if (R[cid(x + dx, z + dz)] && !isC(cid(x + dx, z + dz))) road = true;
    if (road) { bd = dist; back = { x, z }; }
  }
  // 개구멍: 체육관 또는 구교사 뒤 경계 (정문에서 멀고 은밀한 쪽)
  const anchor = placed.oldschool || placed.gym;
  let hole = null;
  if (anchor) {
    const [ax, az] = campus.toW((anchor.u0 + anchor.u1) / 2, (anchor.v0 + anchor.v1) / 2);
    let hd = Infinity;
    for (const id of boundary) {
      const x = (id % N) - H + 0.5, z = ((id / N) | 0) - H + 0.5;
      const dd = Math.hypot(x - ax, z - az);
      if (back && Math.hypot(x - back.x, z - back.z) < 30) continue;
      if (dd < hd) { hd = dd; hole = { x, z }; }
    }
  }
  campus.backGate = back;
  campus.hole = hole;
  const taken = [];
  const hash = new Map();
  const key = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  const near = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = hash.get(`${Math.floor(x / 4) + a},${Math.floor(z / 4) + b}`);
      if (arr) for (const p of arr) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < r * r) return true;
    }
    return false;
  };
  rng.shuffle(boundary);
  const wallCol = d.def.wallColor || COLORS.wall;
  let pieces = 0;
  for (const id of boundary) {
    const x = (id % N) - H + 0.5, z = ((id / N) | 0) - H + 0.5;
    if (Math.hypot(x - gate.x, z - gate.z) < 8) continue;
    if (back && Math.hypot(x - back.x, z - back.z) < 3.2) continue;
    if (hole && Math.hypot(x - hole.x, z - hole.z) < 1.4) continue;
    if (near(x, z, 2.4)) continue;
    // 법선: 주변 캠퍼스 셀 분포
    let nx = 0, nz = 0;
    for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) {
      if (isC(id + b * N + a)) { nx -= a; nz -= b; }
    }
    const ang = Math.atan2(nz, nx) + Math.PI / 2;
    const k = key(x, z);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push([x, z]);
    taken.push([x, z]);
    ctx.add({ shape: 'box', x, y: 0, z, w: 3.1, h: 2.3, d: 0.5, rot: ang, color: wallCol, mat: 'std', cat: 'wall', kind: 'campuswall', rule: 'meso.wall', district: d.id, solid: true });
    pieces++;
  }
  if (back) {
    ctx.add({ shape: 'box', x: back.x, y: 2.4, z: back.z, w: 0.8, h: 0.5, d: 0.8, rot: 0, color: d.accent, mat: 'glow', cat: 'prop', kind: 'backgate', rule: 'meso.wall', district: d.id, solid: false, name: '후문', why: '정문에서 가장 먼 도로변 경계 — 지름길' });
    ctx.addPoi({ x: back.x, z: back.z, name: `${d.name} 후문`, type: 'gate', tier: 2, district: d.id, rule: 'meso.wall', why: '정문 반대편 출입구 → 캠퍼스 관통 동선' });
    ctx.hubs.push({ x: back.x, z: back.z, w: 0.8, name: '후문' });
  }
  if (hole) {
    ctx.add({ shape: 'box', x: hole.x, y: 0, z: hole.z, w: 1.2, h: 0.5, d: 1.2, rot: 0, color: '#7d7468', mat: 'std', cat: 'prop', kind: 'rubble', rule: 'meso.wall', district: d.id, solid: false, name: '담장 개구멍', why: '구교사/체육관 뒤 담장 틈 — 아는 사람만 아는 출입구' });
    ctx.secretHoles = ctx.secretHoles || [];
    ctx.secretHoles.push({ ...hole, district: d.id });
  }
  ctx.log('meso.wall', `${d.name} 담장 ${pieces}조각, 후문 ${back ? 1 : 0}, 개구멍 ${hole ? 1 : 0}`);
}
