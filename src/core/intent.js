// 의도 레이어: 분석 필드를 근거로 '왜 여기에'가 설명되는 게임플레이 배치.
//  · 밀도 리듬   : 메인 동선 위 POI 공백(측지거리)을 최원점 삽입으로 메운다
//  · 숨김 보상   : 아이소비스트 가시성↓ + 위요도↑ + 적당한 우회거리 → 비밀
//  · 호기심 중력 : 동선 이탈 지점에 미끼, 비밀까지 흔적
//  · 옥상 루트   : 점프 그래프 + 판자(크루스칼) + 사다리 입구 + 끝점 보상(보이지만 닿지 않는 티저)
//  · 자물쇠/열쇠 : 안뜰 접근로의 최협점에 문, 같은 구역 중거리에 열쇠
//  · 막다른 길   : 보상 없는 막다른 길 금지
//  · 경쟁 국경   : 라이벌 학원 경계 도로에 바리케이드·검문소
import { dijkstra, PointHash, obbDistance, obbCorners, segDist2 } from './grid.js';
import { ROAD, TERRAIN, ZONE, WORLD, COLORS, MICRO_POIS, SECRET_TYPES, RIVALS } from './config.js';
import { enclosure, c2x, c2z, w2c, lineOfSight } from './analysis.js';
import { faceInfo, lw } from './buildings.js';
import { addVending } from './props.js';

const H = WORLD.half, N = WORLD.size, S2 = WORLD.ana, n2 = N / S2;
export const PACING = { runSpeed: 6, targetSec: 8 }; // 메인 동선 위에서 '달려서 8초' 안에 볼거리
const GAP = PACING.runSpeed * PACING.targetSec; // 48m

const cid1 = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

const WONDERS = {
  trad_academy: ['한밤의 13번째 계단', '혼자 울리는 성당 오르간', '열리지 않는 옥상 문', '체육관 뒤의 고백 편지', '물이 마르지 않는 분수', '거울 속 다른 교복', '도서관 금서 서가'],
  tech_academy: ['꺼지지 않는 3번 서버', '스스로 학습한 청소 로봇', '존재하지 않는 7층', '새벽 4시의 드론 편대', '삭제되지 않는 학생 ID', '자판기 속 AI', '모니터에 비친 그림자'],
  free_academy: ['전설의 초대 반장 오토바이', '사라진 학생회 금고', '지워지지 않는 첫 낙서', '옥상 아지트의 맹세', '13번 사물함', '불 꺼진 매점의 등불', '폐차장의 고양이 왕'],
  arts_academy: ['혼자 연주하는 피아노', '그림 속 움직이는 소녀', '무대 아래 비밀 통로', '자정의 리허설', '완성되지 않는 조각상', '7번째 연습실', '노래하는 계단'],
};

export function genIntent(ctx) {
  const rng = ctx.rng.fork('intent');
  ctx.routes = { crumbs: [], rooftop: [], keys: [], sightlines: [] };
  ctx.secrets = [];
  placeSignposts(ctx, rng.fork('sign'));
  placeBorders(ctx, rng.fork('border'));
  const rooftop = placeRooftopRoutes(ctx, rng.fork('roof'));
  placeClimbables(ctx, rng.fork('climb'));
  placeSpecialSecrets(ctx, rng.fork('special'));
  placeGates(ctx, rng.fork('gates'));
  placeHiddenSecrets(ctx, rng.fork('secrets'));
  rewardDeadEnds(ctx, rng.fork('deadend'));
  placeRhythm(ctx, rng.fork('rhythm'));
  placeBreadcrumbs(ctx, rng.fork('crumbs'));
  placeAmbientCats(ctx, rng.fork('cats'));
  ctx.log('intent.rooftop', `옥상 루트 ${rooftop.routes}개, 지붕 ${rooftop.roofs}, 판자 ${rooftop.planks}`);
}

// ---------- 공통 ----------
function poiDistField(ctx, maxD = 400) {
  const src = [];
  for (const p of ctx.pois) {
    if (p.deleted) continue;
    const k = snap2(ctx, p.x, p.z, 4);
    if (k >= 0) src.push(k);
  }
  for (const s of ctx.secrets) {
    const k = snap2(ctx, s.x, s.z, 3);
    if (k >= 0) src.push(k);
  }
  return dijkstra(n2, n2, ctx.cost2, src, maxD, false, S2).dist;
}

export function snap2(ctx, x, z, r = 4) {
  const k = w2c(x, z);
  if (k < 0) return -1;
  if (ctx.cost2[k] > 0) return k;
  const i0 = k % n2, j0 = (k / n2) | 0;
  let best = -1, bd = Infinity;
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = i0 + di, j = j0 + dj;
    if (i < 0 || j < 0 || i >= n2 || j >= n2) continue;
    const q = j * n2 + i;
    if (ctx.cost2[q] > 0 && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = q; }
  }
  return best;
}

const roadAt = (ctx, x, z) => { const id = cid1(x, z); return id >= 0 ? ctx.road.data[id] : 0; };
const distAt = (ctx, x, z) => { const id = cid1(x, z); return id >= 0 && ctx.district.data[id] !== 255 ? ctx.districts[ctx.district.data[id]] : null; };

function addSecret(ctx, s) {
  const T = SECRET_TYPES[s.type];
  const id = ctx.secrets.length;
  const y = s.y || 0;
  const sec = { id, ...s, y, name: s.name || T.name, color: T.color };
  ctx.secrets.push(sec);
  // 몸체 (유형별로 구분되는 실루엣)
  const base = { district: s.district, mat: 'std', cat: 'secret', rule: s.rule, solid: false, secret: id };
  if (s.type === 'cat') {
    ctx.add({ ...base, shape: 'box', x: s.x, y, z: s.z, w: 0.6, h: 0.35, d: 0.3, rot: rngRot(id), color: '#f2a65a', kind: 'cat', name: sec.name, why: s.why });
    ctx.add({ ...base, shape: 'box', x: s.x + 0.3 * Math.cos(rngRot(id)), y: y + 0.3, z: s.z + 0.3 * Math.sin(rngRot(id)), w: 0.28, h: 0.26, d: 0.28, rot: rngRot(id), color: '#f2a65a', kind: 'cathead' });
  } else if (s.type === 'treasure' || s.type === 'stash') {
    ctx.add({ ...base, shape: 'box', x: s.x, y, z: s.z, w: 1.0, h: 0.7, d: 0.7, rot: rngRot(id), color: s.type === 'stash' ? '#6b4f2a' : '#b5651d', kind: 'chest', name: sec.name, why: s.why });
  } else if (s.type === 'tag') {
    ctx.add({ ...base, shape: 'cyl', x: s.x, y, z: s.z, w: 0.25, h: 0.5, d: 0.25, rot: 0, color: '#ff4fa8', kind: 'spraycan', name: sec.name, why: s.why });
  } else if (s.type === 'wonder') {
    ctx.add({ ...base, shape: 'sphere', x: s.x, y: y + 0.9, z: s.z, w: 0.7, h: 0.7, d: 0.7, rot: 0, color: '#b77bff', mat: 'glow', kind: 'wisp', name: sec.name, why: s.why });
  } else if (s.type === 'view') {
    ctx.add({ ...base, shape: 'cyl', x: s.x, y, z: s.z, w: 0.5, h: 1.2, d: 0.5, rot: 0, color: '#ffffff', kind: 'pinwheel', name: sec.name, why: s.why });
  } else {
    ctx.add({ ...base, shape: 'box', x: s.x, y, z: s.z, w: 0.5, h: 0.08, d: 0.7, rot: rngRot(id), color: '#e8f6ff', kind: 'note', name: sec.name, why: s.why });
  }
  // 수집 표식 (탐험 모드에서 근접 시 반짝임)
  ctx.add({ ...base, shape: 'oct', x: s.x, y: y + 1.6, z: s.z, w: 0.45, h: 0.7, d: 0.45, rot: 0, color: T.color, mat: 'glow', kind: 'secretmark', name: sec.name, why: s.why });
  return sec;
}
const rngRot = (id) => ((id * 2654435761) % 1000) / 1000 * Math.PI * 2;

// ---------- 방향 표지 ----------
function placeSignposts(ctx, rng) {
  const placed = [];
  const lms = ctx.landmarks;
  for (const n of ctx.nodes) {
    if (n.mainCount < 2) continue;
    if (placed.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < 110)) continue;
    if (Math.hypot(n.x, n.z) < 80) continue;
    // 근처 보도 셀
    let pos = null;
    for (let t = 0; t < 40 && !pos; t++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(8, 13);
      const x = n.x + Math.cos(a) * r, z = n.z + Math.sin(a) * r;
      if (roadAt(ctx, x, z) === ROAD.SIDEWALK && !ctx.occ1.data[cid1(x, z)]) pos = { x, z };
    }
    if (!pos) continue;
    placed.push(pos);
    const targets = lms.filter((l) => !l.global).map((l) => ({ l, d: Math.hypot(l.x - pos.x, l.z - pos.z) })).sort((a, b) => a.d - b.d).slice(0, 2);
    const spire = lms.find((l) => l.global);
    if (spire) targets.unshift({ l: spire, d: Math.hypot(spire.x - pos.x, spire.z - pos.z) });
    const d = distAt(ctx, pos.x, pos.z);
    const txt = targets.map((t) => `${t.l.name} ${Math.round(t.d)}m`).join(' / ');
    ctx.add({ shape: 'cyl', x: pos.x, y: 0, z: pos.z, w: 0.14, h: 3.4, d: 0.14, rot: 0, color: '#4b5563', mat: 'std', cat: 'prop', kind: 'signpost', rule: 'intent.signpost', district: d ? d.id : -1, solid: true, name: '방향 표지판', why: txt });
    targets.forEach((t, k) => {
      const a = Math.atan2(t.l.z - pos.z, t.l.x - pos.x);
      ctx.add({ shape: 'box', x: pos.x + Math.cos(a) * 0.75, y: 2.3 + k * 0.42, z: pos.z + Math.sin(a) * 0.75, w: 1.5, h: 0.32, d: 0.06, rot: a, color: k === 0 ? '#5b6cff' : '#2f9e6e', mat: 'std', cat: 'prop', kind: 'signplate', rule: 'intent.signpost', district: d ? d.id : -1, solid: false, name: `→ ${t.l.name}`, why: `${Math.round(t.d)}m` });
    });
  }
  ctx.log('intent.signpost', `표지판 ${placed.length}`);
}

// ---------- 경쟁 국경 ----------
function placeBorders(ctx, rng) {
  const D = ctx.district.data, R = ctx.road.data;
  let count = 0;
  for (const [ta, tb] of RIVALS) {
    const A = ctx.districts.find((d) => d.type === ta), B = ctx.districts.find((d) => d.type === tb);
    if (!A || !B) continue;
    const cross = [];
    for (let j = 4; j < N - 4; j += 2) for (let i = 4; i < N - 4; i += 2) {
      const id = j * N + i;
      const r = R[id];
      if (r !== ROAD.MAIN && r !== ROAD.MINOR) continue;
      if (D[id] !== A.id) continue;
      let hit = false;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const q = id + dz * N + dx;
        if (D[q] === B.id && (R[q] === ROAD.MAIN || R[q] === ROAD.MINOR)) hit = true;
      }
      if (!hit) continue;
      const x = i - H + 0.5, z = j - H + 0.5;
      if (cross.some((c) => Math.hypot(c.x - x, c.z - z) < 45)) continue;
      cross.push({ x, z });
    }
    for (const c of cross.slice(0, 3)) {
      // 도로 방향: 가장 가까운 도로선
      let best = null, bd = Infinity;
      ctx.roadHash.query(c.x, c.z, 12, (p) => { const d2 = (p.x - c.x) ** 2 + (p.z - c.z) ** 2; if (d2 < bd) { bd = d2; best = p; } return false; });
      if (!best) continue;
      const line = ctx.roadLines[best.line];
      const k = Math.max(1, Math.min(line.pts.length - 1, best.k || 1));
      const a = line.pts[k - 1], b = line.pts[k];
      const rot = Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
      const why = `${A.name} ↔ ${B.name} 국경 — 라이벌 학원의 긴장을 길 위에서 보여준다`;
      const hw = line.width / 2;
      for (let s = -hw + 1.2; s <= hw - 1.2; s += 2.6) {
        if (Math.abs(s) < 1.6 && rng.chance(0.7)) continue; // 가운데 한 칸은 통과 가능
        ctx.add({ shape: 'box', x: c.x + Math.cos(rot) * s, y: 0, z: c.z + Math.sin(rot) * s, w: 2.3, h: 1.05, d: 0.5, rot, color: COLORS.barricade, mat: 'std', cat: 'prop', kind: 'barricade', rule: 'intent.border', district: A.id, solid: true, why });
      }
      const bx = c.x + Math.cos(rot) * (hw + 2.2), bz = c.z + Math.sin(rot) * (hw + 2.2);
      ctx.add({ shape: 'box', x: bx, y: 0, z: bz, w: 2.4, h: 2.6, d: 2.2, rot, color: COLORS.checkpoint, mat: 'std', cat: 'prop', kind: 'checkpoint', rule: 'intent.border', district: A.id, solid: true, name: '풍기위원회 검문소', why });
      ctx.addPoi({ x: c.x, z: c.z, name: `${A.def.name.slice(0, 5)}·${B.def.name.slice(0, 5)} 검문소`, type: 'micro', tier: 2, district: A.id, rule: 'intent.border', why });
      count++;
    }
  }
  ctx.log('intent.border', `국경 검문소 ${count}`);
}

// ---------- 옥상 루트 ----------
function placeRooftopRoutes(ctx, rng) {
  const roofs = [];
  for (const b of ctx.buildings) {
    if (b.deleted) continue;
    const r = b.roofs.find((x) => x.main);
    if (!r || r.pitched) continue;
    if (r.y < 5 || r.y > 36 || r.w * r.d < 45) continue;
    roofs.push({ b, r, id: roofs.length });
  }
  const hash = new PointHash(24);
  for (const R of roofs) hash.add(R.r.x, R.r.z, R);
  const jumps = [], planks = [];
  for (const A of roofs) {
    hash.query(A.r.x, A.r.z, 40, (B) => {
      if (B.id <= A.id) return false;
      const dh = Math.abs(A.r.y - B.r.y);
      // 점프 + 매달려 오르기(mantle ≤3.6m) 기준
      if (dh > 3.5) return false;
      const gap = obbDistance(A.r, B.r);
      if (gap <= 0.05 && dh > 0.6) return false;
      if (gap <= 3.0) jumps.push([A.id, B.id, gap]);
      else if (gap <= 8.5 && dh <= 2.0) planks.push([A.id, B.id, gap]);
      return false;
    });
  }
  // 유니온 파인드
  const par = roofs.map((_, i) => i);
  const find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
  const adj = roofs.map(() => []);
  for (const [a, b] of jumps) { par[find(a)] = find(b); adj[a].push([b, 'jump']); adj[b].push([a, 'jump']); }
  planks.sort((p, q) => p[2] - q[2]);
  const usedPlanks = [];
  for (const [a, b, gap] of planks) {
    if (find(a) === find(b)) continue;
    // 판자는 의도된 연결: 작은 컴포넌트끼리를 잇는다
    par[find(a)] = find(b);
    adj[a].push([b, 'plank']); adj[b].push([a, 'plank']);
    usedPlanks.push([a, b, gap]);
  }
  const comps = new Map();
  for (const R of roofs) {
    const c = find(R.id);
    if (!comps.has(c)) comps.set(c, []);
    comps.get(c).push(R.id);
  }
  const routes = [...comps.values()].filter((c) => c.length >= 4).sort((a, b) => b.length - a.length).slice(0, 16);
  const inRoute = new Set(routes.flat());
  let plankCount = 0;
  for (const [a, b] of usedPlanks) {
    if (!inRoute.has(a)) continue;
    const A = roofs[a].r, B = roofs[b].r;
    const [pa, pb] = closestPoints(A, B);
    const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const rot = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
    const y = (A.y + B.y) / 2;
    ctx.add({ shape: 'box', x: (pa[0] + pb[0]) / 2, y: y - 0.15, z: (pa[1] + pb[1]) / 2, w: L + 1.6, h: 0.18, d: 1.3, rot, color: COLORS.plank, mat: 'std', cat: 'gameplay', kind: 'plank', rule: 'intent.rooftop', district: roofs[a].b.district, solid: true, deck: true, rz: Math.atan2(B.y - A.y, L), why: `틈 ${L.toFixed(1)}m — 점프 불가 간극을 의도적으로 연결` });
    plankCount++;
  }
  const n4 = N / 4;
  let made = 0;
  for (const comp of routes) {
    // 입구: 가장 낮은 지붕, 골목/뒷면이 있는 건물
    let entry = null, eh = Infinity;
    for (const id of comp) {
      const R = roofs[id];
      const k = R.b.sides.findIndex((s, i) => (s === 2 || s === 0) && i !== R.b.front);
      const score = R.r.y - (k >= 0 ? 4 : 0);
      if (score < eh) { eh = score; entry = { id, face: k >= 0 ? k : (R.b.front >= 0 ? R.b.front ^ 1 : 0) }; }
    }
    if (!entry) continue;
    // BFS
    const dist = new Map([[entry.id, 0]]);
    const prev = new Map();
    const q = [entry.id];
    while (q.length) {
      const u = q.shift();
      for (const [v] of adj[u]) if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); prev.set(v, u); q.push(v); }
    }
    let goal = entry.id, gd = 0;
    for (const [v, d] of dist) if (d > gd || (d === gd && roofs[v].r.y > roofs[goal].r.y)) { gd = d; goal = v; }
    if (gd < 2) continue;
    const E = roofs[entry.id];
    const f = faceInfo(E.b, entry.face);
    const ladder = { x: f.cx + f.nx * 0.35, z: f.cz + f.nz * 0.35, top: E.r.y, nx: -f.nx, nz: -f.nz };
    const dE = E.b.district;
    ctx.add({ shape: 'box', x: ladder.x, y: 0, z: ladder.z, w: 0.7, h: E.r.y + 1, d: 0.15, rot: f.along, color: COLORS.ladder, mat: 'std', cat: 'gameplay', kind: 'ladder', rule: 'intent.rooftop', district: dE, solid: false, climb: ladder, name: '비상 사다리', why: '루트 중 가장 낮은 지붕의 뒷면/골목면 — 아는 사람만 찾는 입구' });
    // 경로 위 동전 + 목표 보상
    const path = [goal];
    while (prev.has(path[path.length - 1])) path.push(prev.get(path[path.length - 1]));
    path.reverse();
    const pts = path.map((id) => [roofs[id].r.x, roofs[id].r.y + 0.6, roofs[id].r.z]);
    ctx.routes.rooftop.push({ pts, ladder, district: dE, len: path.length });
    for (let k = 1; k < path.length - 1; k++) {
      const R = roofs[path[k]].r;
      ctx.add({ shape: 'cyl', x: R.x, y: R.y + 0.5, z: R.z, w: 0.7, h: 0.1, d: 0.7, rot: 0, color: '#ffd23d', mat: 'glow', cat: 'gameplay', kind: 'coin', rule: 'intent.rooftop', district: R.district, solid: false, rx: Math.PI / 2, coin: true });
    }
    const G = roofs[goal];
    // 티저: 메인 동선에서 목표 지붕이 보이는가 (보이지만 닿지 않는)
    let tease = null;
    for (let t = 0; t < 40 && !tease; t++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(20, 90);
      const ox = G.r.x + Math.cos(a) * r, oz = G.r.z + Math.sin(a) * r;
      const fk = ctx.flow.at(ox, oz);
      if (fk < ctx.flowThreshold) continue;
      const k2 = w2c(ox, oz);
      if (k2 < 0 || ctx.cost2[k2] <= 0) continue;
      if (lineOfSight(ctx, ox, oz, 1.6, G.r.x, G.r.z, G.r.y + 1.0, Math.max(G.r.w, G.r.d) / 2 + 1)) tease = { x: ox, z: oz };
    }
    let sx = G.r.x, sz = G.r.z;
    if (tease) {
      const a = Math.atan2(tease.z - G.r.z, tease.x - G.r.x);
      const m = Math.min(G.r.w, G.r.d) / 2 - 1.2;
      sx += Math.cos(a) * m; sz += Math.sin(a) * m;
      ctx.routes.sightlines.push({ a: [tease.x, 1.6, tease.z], b: [sx, G.r.y + 1, sz], kind: 'tease' });
    }
    addSecret(ctx, {
      type: G.r.y > 20 ? 'view' : 'treasure', x: sx, z: sz, y: G.r.y, district: G.b.district, rule: 'intent.rooftop', reveal: tease ? 'tease' : 'rooftop',
      name: G.r.y > 20 ? '옥상 비경' : '옥상 보물', why: `사다리에서 ${gd}개 지붕 너머 (BFS 최원점)${tease ? ' · 거리에서 보이지만 닿으려면 루트를 찾아야 함' : ''}`,
      hidden: 1, detour: gd * 10,
    });
    made++;
    void n4;
  }
  ctx.roofGraph = { roofs: roofs.length, routes: made };
  return { routes: made, roofs: routes.reduce((s, c) => s + c.length, 0), planks: plankCount };
}

function closestPoints(A, B) {
  const ca = obbCorners(A), cb = obbCorners(B);
  let best = null, bd = Infinity;
  const sampleEdges = (P) => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) & 3];
      for (let t = 0.1; t <= 0.9; t += 0.1) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  };
  const sa = sampleEdges(ca), sb = sampleEdges(cb);
  for (const p of sa) for (const q of sb) {
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d < bd) { bd = d; best = [p, q]; }
  }
  // 판자는 지붕 안쪽까지 살짝 걸치게
  return best;
}

// ---------- 오를 수 있는 랜드마크 (사다리 + 전망 포인트) ----------
function placeClimbables(ctx, rng) {
  let n = 0;
  // 학원 본관 옥상 — 학원물의 상징 '옥상'
  for (const d of ctx.districts) {
    const c = d.campus;
    if (!c || !c.main) continue;
    const b = c.main;
    const r = b.roofs.find((x) => x.main);
    const f = faceInfo(b, 1); // 뒷면
    const ladder = { x: f.cx + f.nx * 0.35, z: f.cz + f.nz * 0.35, top: r.y, nx: -f.nx, nz: -f.nz };
    ctx.add({ shape: 'box', x: ladder.x, y: 0, z: ladder.z, w: 0.7, h: r.y + 1, d: 0.15, rot: f.along, color: COLORS.ladder, mat: 'std', cat: 'gameplay', kind: 'ladder', rule: 'intent.vantage', district: d.id, solid: false, climb: ladder, name: '본관 뒤 비상계단', why: '정면이 아닌 뒷면 — 옥상은 발견해야 하는 장소' });
    const [vx, vz] = lw(r, r.w * 0.25, 0);
    addVantage(ctx, vx, r.y, vz, d.id, `${d.name} 옥상`, '학원물의 상징 공간: 본관 옥상 (펜스 + 전망)');
    n++;
  }
  // 시계탑/미완의 타워 꼭대기
  for (const lot of ctx.lots) {
    if (!lot.towerTop) continue;
    const t = lot.towerTop;
    const k = rng.int(0, 3);
    const o = { x: t.x, z: t.z, w: t.s, d: t.s, rot: lot.rot };
    const f = faceInfo(o, k);
    const ladder = { x: f.cx + f.nx * 0.4, z: f.cz + f.nz * 0.4, top: t.y, nx: -f.nx, nz: -f.nz };
    ctx.add({ shape: 'box', x: ladder.x, y: 0, z: ladder.z, w: 0.7, h: t.y + 1, d: 0.15, rot: f.along, color: COLORS.ladder, mat: 'std', cat: 'gameplay', kind: 'ladder', rule: 'intent.vantage', district: lot.district, solid: false, climb: ladder, name: '점검용 사다리', why: '랜드마크 정상 = 구역 전체가 내려다보이는 전망점' });
    if (lot.unfinished) {
      ctx.add({ shape: 'box', x: t.x, y: t.y - 0.4, z: t.z, w: t.s, h: 0.4, d: t.s, rot: lot.rot, color: '#a7a39a', mat: 'std', cat: 'landmark', kind: 'slab', rule: 'intent.vantage', district: lot.district, solid: true, deck: true });
    } else {
      // 시계탑 꼭대기 발판 (원뿔 지붕 아래 난간)
      ctx.add({ shape: 'box', x: t.x, y: t.y - 0.3, z: t.z, w: t.s + 3, h: 0.3, d: t.s + 3, rot: lot.rot, color: '#7d6a55', mat: 'std', cat: 'landmark', kind: 'balcony', rule: 'intent.vantage', district: lot.district, solid: true, deck: true });
    }
    const [vx, vz] = lw(o, 0, t.s / 2 + 0.8);
    addVantage(ctx, lot.unfinished ? t.x : vx, t.y, lot.unfinished ? t.z : vz, lot.district, lot.unfinished ? '미완의 타워 정상' : '시계탑 발코니', '랜드마크 정상 전망점');
    addSecret(ctx, { type: 'view', x: (lot.unfinished ? t.x : vx) + 1.2, z: (lot.unfinished ? t.z : vz) + 1.2, y: t.y, district: lot.district, rule: 'intent.vantage', reveal: 'climb', name: lot.unfinished ? '미완의 타워 정상 비경' : '시계탑 위의 비경', why: '오를 수 있는 랜드마크 꼭대기 보상', hidden: 1, detour: t.y });
    n++;
  }
  ctx.log('intent.vantage', `오를 수 있는 전망점 ${n}`);
}

function addVantage(ctx, x, y, z, district, name, why) {
  ctx.add({ shape: 'cyl', x, y, z, w: 0.35, h: 3.2, d: 0.35, rot: 0, color: COLORS.vantage, mat: 'glow', cat: 'gameplay', kind: 'vantage', rule: 'intent.vantage', district, solid: false, name, why });
  ctx.add({ shape: 'torus', x, y: y + 3.4, z, w: 1.6, h: 1.6, d: 0.18, rot: 0, color: '#29e0d0', mat: 'glow', cat: 'gameplay', kind: 'vantage_ring', rule: 'intent.vantage', district, solid: false, rx: Math.PI / 2 });
  ctx.addPoi({ x, z, y, name, type: 'vantage', tier: 1, district, rule: 'intent.vantage', why });
}

// ---------- 특수 비밀: 미로 막다른 칸, 공사장, 불가사의, 전설의 나무 ----------
function placeSpecialSecrets(ctx, rng) {
  // 컨테이너 미로 막다른 칸
  const md = (ctx.mazeDeadEnds || []).slice();
  rng.shuffle(md);
  for (const m of md.slice(0, 4)) {
    addSecret(ctx, { type: 'stash', x: m.x, z: m.z, district: m.district, rule: 'meso.harbor', reveal: 'maze', why: '컨테이너 미로의 막다른 칸 — 길을 잃은 보상', hidden: 0.9, detour: 40 });
  }
  // 공사장 틈새 안쪽
  for (const lot of ctx.lots) {
    if (!lot.construction || !lot.gap) continue;
    if (!rng.chance(0.7)) continue;
    const [x, z] = lw(lot, rng.range(-0.25, 0.25) * lot.w, rng.range(-0.25, 0.25) * lot.d);
    addSecret(ctx, { type: 'memory', x, z, district: lot.district, rule: 'meso.construction', reveal: 'gap', why: '펜스 틈새 하나로만 들어가는 공사장 내부', hidden: 0.9, detour: 20 });
  }
  // 학원 불가사의 + 전설의 나무: 캠퍼스 안 숨김도 상위 지점
  for (const d of ctx.districts) {
    if (!d.campus) continue;
    const names = WONDERS[d.type] || [];
    const cands = [];
    for (let k = 0; k < n2 * n2; k++) {
      if (ctx.cost2[k] <= 0) continue;
      const x = c2x(k), z = c2z(k);
      const id = cid1(x, z);
      if (ctx.zone.data[id] !== ZONE.CAMPUS || ctx.zoneOwner[id] !== d.id) continue;
      const h = ctx.hidden[k];
      if (h < 0.55) continue;
      cands.push({ k, x, z, s: h + 0.3 * enclosure(ctx, k) + rng.next() * 0.05 });
    }
    cands.sort((a, b) => b.s - a.s);
    // 전설의 나무: 가장 은밀하면서 주변이 트인 녹지
    let tree = null;
    for (const c of cands) {
      if (enclosure(ctx, c.k) > 0.5) continue;
      if (roadAt(ctx, c.x, c.z)) continue;
      tree = c; break;
    }
    if (tree) {
      ctx.add({ shape: 'cyl', x: tree.x, y: 0, z: tree.z, w: 0.9, h: 4, d: 0.9, rot: 0, color: COLORS.trunk, mat: 'std', cat: 'tree', kind: 'legendtrunk', rule: 'intent.legendtree', district: d.id, solid: true });
      ctx.add({ shape: 'sphere', x: tree.x, y: 3.4, z: tree.z, w: 9, h: 7, d: 9, rot: 0, color: '#ff9fc8', mat: 'std', cat: 'tree', kind: 'legendtree', rule: 'intent.legendtree', district: d.id, solid: false, name: '전설의 나무', why: `캠퍼스 숨김도 ${(tree.s).toFixed(2)} 최상위 녹지 — 고백 명소` });
      addSecret(ctx, { type: 'wonder', x: tree.x + 1.5, z: tree.z, district: d.id, rule: 'intent.legendtree', reveal: 'corner', name: '전설의 나무 아래 편지', why: '캠퍼스에서 가장 숨겨진 녹지', hidden: ctx.hidden[tree.k], detour: ctx.detour[tree.k] });
      ctx.addPoi({ x: tree.x, z: tree.z, name: '전설의 나무', type: 'micro', tier: 2, district: d.id, rule: 'intent.legendtree', why: '고백 명소 (서브컬쳐 트로프)', hiddenPoi: true });
    }
    let w = 0;
    for (const c of cands) {
      if (w >= Math.min(5, names.length)) break;
      if (ctx.secrets.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 28)) continue;
      addSecret(ctx, { type: 'wonder', x: c.x, z: c.z, district: d.id, rule: 'intent.wonder', reveal: 'corner', name: `불가사의: ${names[w]}`, why: `캠퍼스 숨김도 ${ctx.hidden[c.k].toFixed(2)} · 위요도 ${enclosure(ctx, c.k).toFixed(2)}`, hidden: ctx.hidden[c.k], detour: ctx.detour[c.k] });
      w++;
    }
  }
}

// ---------- 자물쇠와 열쇠 ----------
function placeGates(ctx, rng) {
  const cand = ctx.lots.filter((l) => l.courtyard && l.area >= 120 && ['commercial', 'residential', 'ruins', 'center'].includes(ctx.districts[l.district].type));
  rng.shuffle(cand);
  // 통로가 있는 블록의 안뜰을 우선 (설계된 최협점)
  cand.sort((a, b) => (ctx.blocks[b.block].passages ? 1 : 0) - (ctx.blocks[a.block].passages ? 1 : 0));
  const usedDistricts = new Map();
  let made = 0;
  for (const lot of cand) {
    if (made >= 5) break;
    // 구역당 최대 2쌍, 서로 150m 이상 떨어지게
    if ((usedDistricts.get(lot.district) || 0) >= 2) continue;
    if ((ctx.gates2 || []).some((g) => Math.hypot(g.x - lot.x, g.z - lot.z) < 150)) continue;
    const blk = ctx.blocks[lot.block];
    if (blk.passages && blk.passages.length) {
      const p = blk.passages[0];
      const vx = -Math.sin(p.rot), vz = Math.cos(p.rot);
      const gx = p.x + vx * (p.d / 2 - 1), gz = p.z + vz * (p.d / 2 - 1);
      const gk = snap2(ctx, gx, gz, 2);
      if (gk >= 0 && placeGateAt(ctx, rng, lot, gx, gz, p.rot + Math.PI / 2, gk, `블록 안뜰로 통하는 유일한 3.5m 통로의 안쪽 끝`, p.w)) {
        usedDistricts.set(lot.district, (usedDistricts.get(lot.district) || 0) + 1);
        made++;
        continue;
      }
    }
    const k0 = snap2(ctx, lot.x, lot.z, 4);
    if (k0 < 0) continue;
    const dj = dijkstra(n2, n2, ctx.cost2, [k0], 120, true, S2);
    // 가장 가까운 메인 동선 셀
    let tgt = -1, td = Infinity;
    for (let k = 0; k < n2 * n2; k++) if (ctx.isFlow2[k] && dj.dist[k] < td) { td = dj.dist[k]; tgt = k; }
    if (tgt < 0 || td < 10) continue;
    // 경로 (안뜰 → 동선)
    const path = [];
    let c = tgt;
    while (c >= 0 && c !== k0 && path.length < 400) { path.push(c); c = dj.prev[c]; }
    path.reverse(); // 안뜰 쪽부터
    // 최협점: 안뜰을 벗어나는 처음 25m 구간에서 주변 통행셀 수 최소
    let gk = -1, gw = Infinity, gi = -1;
    for (let i = 1; i < Math.min(path.length - 1, 14); i++) {
      const k = path[i];
      const x = c2x(k), z = c2z(k);
      if (Math.hypot(x - lot.x, z - lot.z) < Math.min(lot.w, lot.d) / 2 - 1) continue;
      let wcount = 0;
      const ii = k % n2, jj = (k / n2) | 0;
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const q = (jj + b) * n2 + ii + a; if (ctx.cost2[q] > 0) wcount++; }
      if (wcount < gw) { gw = wcount; gk = k; gi = i; }
    }
    if (gk < 0 || gw > 11) continue;
    const kA = path[Math.max(0, gi - 1)], kB = path[Math.min(path.length - 1, gi + 1)];
    const dir = Math.atan2(c2z(kB) - c2z(kA), c2x(kB) - c2x(kA));
    const gx = c2x(gk), gz = c2z(gk);
    if (placeGateAt(ctx, rng, lot, gx, gz, dir, gk, `안뜰 접근로 최협점(주변 통행셀 ${gw}/25)`, 3.6, td)) {
      usedDistricts.set(lot.district, (usedDistricts.get(lot.district) || 0) + 1);
      made++;
    }
  }
  ctx.log('intent.gate', `잠긴 문/열쇠 ${made}쌍 (후보 안뜰 ${cand.length}, 통로 블록 ${cand.filter((l) => ctx.blocks[l.block].passages).length})`);
}

function placeGateAt(ctx, rng, lot, gx, gz, dir, gk, why, width, td = 30) {
  {
    // 열쇠: 같은 구역, 게이트에서 60~220m, 중간 숨김도
    const dg = dijkstra(n2, n2, ctx.cost2, [gk], 260, false, S2).dist;
    let key = null, ks = -Infinity;
    for (let k = 0; k < n2 * n2; k += 2) {
      const dd = dg[k];
      if (!(dd > 60 && dd < 220)) continue;
      if (ctx.cost2[k] <= 0 || ctx.isFlow2[k]) continue;
      const x = c2x(k), z = c2z(k);
      const d = distAt(ctx, x, z);
      if (!d || d.id !== lot.district) continue;
      const h = ctx.hidden[k];
      if (Math.abs(h - 0.55) > 0.3) continue;
      const s = -Math.abs(h - 0.55) + enclosure(ctx, k) * 0.4 + rng.next() * 0.1;
      if (s > ks) { ks = s; key = { x, z, k, dd }; }
    }
    if (!key) return false;
    const gid = ctx.gates2 ? ctx.gates2.length : 0;
    ctx.gates2 = ctx.gates2 || [];
    const gate = ctx.add({ shape: 'box', x: gx, y: 0, z: gz, w: 0.35, h: 2.7, d: width + 0.3, rot: dir, color: COLORS.gate, mat: 'std', cat: 'gameplay', kind: 'lockgate', rule: 'intent.gate', district: lot.district, solid: true, name: '잠긴 철문', why, gate: gid });
    ctx.add({ shape: 'box', x: gx, y: 1.2, z: gz, w: 0.45, h: 0.35, d: 0.35, rot: dir, color: '#ffd23d', mat: 'glow', cat: 'gameplay', kind: 'lock', rule: 'intent.gate', district: lot.district, solid: false });
    const keyE = ctx.add({ shape: 'box', x: key.x, y: 0.9, z: key.z, w: 0.25, h: 0.5, d: 0.08, rot: 0, color: COLORS.key, mat: 'glow', cat: 'gameplay', kind: 'key', rule: 'intent.gate', district: lot.district, solid: false, name: '녹슨 열쇠', why: `문에서 보행 ${key.dd.toFixed(0)}m · 같은 구역 · 숨김도 ${ctx.hidden[key.k].toFixed(2)}`, keyFor: gid });
    ctx.gates2.push({ id: gid, x: gx, z: gz, rot: dir, entity: gate.id, key: { x: key.x, z: key.z, entity: keyE.id }, lot: lot.id, district: lot.district });
    ctx.routes.keys.push({ a: [key.x, 1, key.z], b: [gx, 1.5, gz] });
    addSecret(ctx, { type: 'treasure', x: lot.x, z: lot.z, district: lot.district, rule: 'intent.gate', reveal: 'gate', name: '비밀 동아리방의 상자', why: `잠긴 문 너머 안뜰 · 열쇠는 ${key.dd.toFixed(0)}m 떨어진 곳`, hidden: 1, detour: td });
    ctx.addPoi({ x: key.x, z: key.z, name: '녹슨 열쇠', type: 'key', tier: 2, district: lot.district, rule: 'intent.gate', why: '잠긴 철문의 열쇠', hiddenPoi: true });
    return true;
  }
}

// ---------- 숨김 보상 (아이소비스트 기반) ----------
function placeHiddenSecrets(ctx, rng) {
  const quota = { ruins: 9, harbor: 5, commercial: 5, residential: 5, center: 3, park: 4, trad_academy: 2, tech_academy: 2, free_academy: 3, arts_academy: 2 };
  const spacing = { ruins: 24, harbor: 30, commercial: 30, residential: 34, center: 40, park: 38 };
  const cands = [];
  const R = ctx.road.data;
  for (let k = 0; k < n2 * n2; k++) {
    if (ctx.cost2[k] <= 0 || ctx.isFlow2[k]) continue;
    const h = ctx.hidden[k];
    if (h < 0.72) continue;
    const det = ctx.detour[k];
    if (!(det >= 10 && det <= 160)) continue;
    const x = c2x(k), z = c2z(k);
    const r = R[cid1(x, z)];
    if (r === ROAD.MAIN || r === ROAD.MINOR || r === ROAD.COAST || r === ROAD.BRIDGE) continue;
    cands.push(k);
  }
  rng.shuffle(cands);
  const scored = [];
  for (const k of cands.slice(0, 9000)) {
    const x = c2x(k), z = c2z(k);
    const d = distAt(ctx, x, z);
    if (!d) continue;
    const enc = enclosure(ctx, k);
    if (enc < 0.3) continue;
    const bonus = { ruins: 0.08, harbor: 0.05 }[d.type] || 0;
    const s = 0.45 * ctx.hidden[k] + 0.3 * enc + 0.25 * Math.min(1, ctx.detour[k] / 60) + bonus + rng.next() * 0.04;
    scored.push({ k, x, z, d, s, enc });
  }
  scored.sort((a, b) => b.s - a.s);
  const count = {};
  const freeAc = ctx.districts.find((d) => d.type === 'free_academy');
  const fx = freeAc ? (freeAc.core ? freeAc.core.cx : freeAc.x) : 1e9, fz = freeAc ? (freeAc.core ? freeAc.core.cz : freeAc.z) : 1e9;
  for (const c of scored) {
    const t = c.d.type;
    if ((count[c.d.id] || 0) >= (quota[t] || 3)) continue;
    const sp = spacing[t] || 34;
    if (ctx.secrets.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < sp)) continue;
    let type;
    const df = Math.hypot(c.x - fx, c.z - fz);
    if (c.d.def.campus) type = 'wonder';
    else if (df < 220 && rng.chance(0.6)) type = 'tag';
    else if (t === 'harbor') type = 'stash';
    else if (t === 'ruins') type = rng.chance(0.5) ? 'memory' : 'cat';
    else type = rng.chance(0.65) ? 'cat' : rng.chance(0.5) ? 'treasure' : 'memory';
    const nearDead = (ctx.deadEnds || []).some((e) => Math.hypot(e.x - c.x, e.z - c.z) < 14);
    const reveal = nearDead ? 'deadend' : c.enc > 0.6 ? 'nook' : 'corner';
    const name = type === 'wonder' ? `불가사의: ${(WONDERS[t] || ['이름 없는 소문'])[5 + (count[c.d.id] || 0)] || '이름 없는 소문'}` : undefined;
    addSecret(ctx, { type, x: c.x, z: c.z, district: c.d.id, rule: 'intent.secret', reveal, name, why: `숨김도 ${ctx.hidden[c.k].toFixed(2)} · 위요도 ${c.enc.toFixed(2)} · 동선 우회 ${ctx.detour[c.k].toFixed(0)}m`, hidden: ctx.hidden[c.k], detour: ctx.detour[c.k] });
    count[c.d.id] = (count[c.d.id] || 0) + 1;
  }
}

// ---------- 막다른 길 보상 ----------
function rewardDeadEnds(ctx, rng) {
  const all = [...(ctx.deadEnds || [])];
  let rewarded = 0, already = 0;
  const near = (x, z, r) => ctx.pois.some((p) => !p.deleted && Math.hypot(p.x - x, p.z - z) < r) || ctx.secrets.some((s) => Math.hypot(s.x - x, s.z - z) < r);
  for (const e of all) {
    const k = snap2(ctx, e.x, e.z, 3);
    if (k < 0) { e.rewarded = 'void'; continue; }
    if (near(e.x, e.z, 16)) { e.rewarded = 'existing'; already++; continue; }
    const d = distAt(ctx, e.x, e.z);
    const did = d ? d.id : -1;
    if (e.kind === 'riverside') {
      const a = Math.atan2(e.dir[1], e.dir[0]);
      ctx.add({ shape: 'box', x: e.x, y: 0, z: e.z, w: 2.2, h: 0.5, d: 0.7, rot: a + Math.PI / 2, color: COLORS.bench, mat: 'std', cat: 'prop', kind: 'bench', rule: 'intent.deadend', district: did, solid: true, why: '하천에 막힌 길 끝 → 물을 바라보는 벤치' });
      ctx.addPoi({ x: e.x, z: e.z, name: '강변 전망 벤치', type: 'micro', tier: 3, district: did, rule: 'intent.deadend', why: '막다른 길 보상 (하천변)' });
    } else if (ctx.hidden[k] > 0.6) {
      addSecret(ctx, { type: rng.chance(0.5) ? 'cat' : 'treasure', x: e.x, z: e.z, district: did, rule: 'intent.deadend', reveal: 'deadend', why: '막다른 길 + 숨김도 높음 → 비밀', hidden: ctx.hidden[k], detour: ctx.detour[k] });
    } else {
      const shrine = rng.chance(0.5);
      if (shrine) addShrine(ctx, e.x, e.z, Math.atan2(e.dir[1], e.dir[0]), did, '골목 끝 작은 신사 — 막다른 길에도 이유를');
      else addVending(ctx, e.x, e.z, Math.atan2(e.dir[1], e.dir[0]), rng, did, '막다른 길 끝 자판기');
      ctx.addPoi({ x: e.x, z: e.z, name: shrine ? '골목 끝 신사' : '골목 끝 자판기', type: 'micro', tier: 3, district: did, rule: 'intent.deadend', why: '막다른 길 보상' });
    }
    e.rewarded = 'new';
    rewarded++;
  }
  ctx.deadEndStats = { total: all.length, rewarded, already };
  ctx.log('intent.deadend', `막다른 길 ${all.length} → 신규 보상 ${rewarded}, 기존 ${already}`);
}

function addShrine(ctx, x, z, rot, district, why) {
  const c = Math.cos(rot + Math.PI / 2), s = Math.sin(rot + Math.PI / 2);
  for (const k of [-1, 1]) ctx.add({ shape: 'cyl', x: x + c * k * 1.1, y: 0, z: z + s * k * 1.1, w: 0.25, h: 2.4, d: 0.25, rot: 0, color: '#d6332a', mat: 'std', cat: 'prop', kind: 'torii', rule: 'intent.deadend', district, solid: true });
  ctx.add({ shape: 'box', x, y: 2.3, z, w: 3, h: 0.25, d: 0.35, rot: rot + Math.PI / 2, color: '#d6332a', mat: 'std', cat: 'prop', kind: 'torii', rule: 'intent.deadend', district, solid: false, name: '작은 신사', why });
  ctx.add({ shape: 'box', x: x + Math.cos(rot) * 1.6, y: 0, z: z + Math.sin(rot) * 1.6, w: 1, h: 1.2, d: 0.8, rot, color: '#a37b52', mat: 'std', cat: 'prop', kind: 'hokora', rule: 'intent.deadend', district, solid: true });
}

// ---------- 밀도 리듬 ----------
function placeRhythm(ctx, rng) {
  let dist = poiDistField(ctx);
  const flowCells = [];
  for (let k = 0; k < n2 * n2; k++) if (ctx.isFlow2[k]) flowCells.push(k);
  let added = 0;
  const before = gapStats(dist, flowCells);
  for (let it = 0; it < 120; it++) {
    let worst = -1, wd = 0;
    for (const k of flowCells) if (dist[k] > wd && isFinite(dist[k])) { wd = dist[k]; worst = k; }
    if (wd < GAP || worst < 0) break;
    // 배치 지점: 공백 지점에서 걸어서 16m 이내, 벽에 붙은 비도로 통행셀
    const i0 = worst % n2, j0 = (worst / n2) | 0;
    const reach = dijkstra(n2, n2, ctx.cost2, [worst], 16, false, S2).dist;
    let spot = -1, ss = -Infinity;
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 1 || j < 1 || i >= n2 - 1 || j >= n2 - 1) continue;
      const k = j * n2 + i;
      if (ctx.cost2[k] <= 0 || !isFinite(reach[k])) continue;
      const r = roadAt(ctx, c2x(k), c2z(k));
      if (r === ROAD.MAIN || r === ROAD.MINOR || r === ROAD.COAST || r === ROAD.BRIDGE) continue;
      let wall = 0;
      for (const q of [k - 1, k + 1, k - n2, k + n2]) if (ctx.solid2.data[q] > 1.5) wall++;
      const s = (wall ? 1 : 0) + (r === ROAD.SIDEWALK || r === ROAD.PLAZA ? 0.6 : 0) - Math.hypot(di, dj) * 0.03 + rng.next() * 0.1;
      if (s > ss) { ss = s; spot = k; }
    }
    if (spot < 0) { dist[worst] = 0; continue; }
    const x = c2x(spot), z = c2z(spot);
    const d = distAt(ctx, x, z);
    if (!d) { dist[worst] = 0; continue; }
    const name = rng.pick(MICRO_POIS[d.type] || MICRO_POIS.residential);
    microPoiGeometry(ctx, name, x, z, rng, d.id, wd);
    ctx.addPoi({ x, z, name, type: 'micro', tier: 3, district: d.id, rule: 'intent.rhythm', why: `메인 동선 공백 ${wd.toFixed(0)}m > 목표 ${GAP}m (달리기 ${PACING.targetSec}s)` });
    added++;
    const upd = dijkstra(n2, n2, ctx.cost2, [spot], GAP * 1.6, false, S2).dist;
    for (let k = 0; k < upd.length; k++) if (upd[k] < dist[k]) dist[k] = upd[k];
    if (dist[worst] > GAP) dist[worst] = GAP; // 반복 선택 방지
  }
  const after = gapStats(dist, flowCells);
  ctx.rhythm = { before, after, added, gap: GAP };
  ctx.poiDist = dist;
  ctx.log('intent.rhythm', `공백 최대 ${before.max.toFixed(0)}m → ${after.max.toFixed(0)}m, 커버리지 ${(before.cov * 100).toFixed(0)}% → ${(after.cov * 100).toFixed(0)}% (마이크로 POI +${added})`);
}

function gapStats(dist, cells) {
  // 도달 불가 셀(고립된 동선 조각)은 별도 집계
  let mx = 0, s = 0, n = 0, cov = 0, unreach = 0;
  for (const k of cells) {
    const v = dist[k];
    if (!isFinite(v)) { unreach++; continue; }
    mx = Math.max(mx, v); s += v; n++;
    if (v <= GAP) cov++;
  }
  return { max: mx, mean: n ? s / n : 0, cov: n ? cov / n : 0, unreachable: cells.length ? unreach / cells.length : 0 };
}

export function microPoiGeometry(ctx, name, x, z, rng, district, gapM) {
  const rot = rng.range(0, Math.PI * 2);
  const base = { district, mat: 'std', cat: 'poi', rule: 'intent.rhythm', solid: true };
  const why = gapM ? `공백 ${gapM.toFixed(0)}m 메움` : undefined;
  const C = Math.cos(rot), S = Math.sin(rot);
  const at = (u, v) => [x + u * C - v * S, z + u * S + v * C];
  if (/노점|포장마차|가챠|키오스크|스티커/.test(name)) {
    ctx.add({ ...base, shape: 'box', x, y: 0, z, w: 2.6, h: 1.1, d: 1.4, rot, color: '#f7f1e3', kind: 'stall', name, why });
    ctx.add({ ...base, shape: 'box', x, y: 2.2, z, w: 3, h: 0.15, d: 2, rot, color: rng.pick(['#ff6b5e', '#ffb347', '#53c7f0', '#ff9ec4']), kind: 'stallroof', solid: false });
    for (const s of [-1, 1]) { const [px, pz] = at(s * 1.3, -0.6); ctx.add({ ...base, shape: 'cyl', x: px, y: 0, z: pz, w: 0.1, h: 2.2, d: 0.1, rot: 0, color: '#555', kind: 'pole', solid: false }); }
    ctx.add({ ...base, shape: 'box', x, y: 2.4, z, w: 1.6, h: 0.5, d: 0.1, rot, color: '#fff3a0', mat: 'glow', kind: 'stallsign', solid: false });
  } else if (/신사/.test(name)) {
    addShrine(ctx, x, z, rot, district, name);
  } else if (/무대|공연|버스킹/.test(name)) {
    ctx.add({ ...base, shape: 'cyl', x, y: 0, z, w: 4, h: 0.5, d: 4, rot: 0, color: '#c9b8e8', kind: 'busk', name, why });
    for (const s of [-1, 1]) { const [px, pz] = at(s * 2.4, 0); ctx.add({ ...base, shape: 'box', x: px, y: 0, z: pz, w: 0.6, h: 1.1, d: 0.5, rot, color: '#333842', kind: 'speaker' }); }
  } else if (/텐트|부스|이젤|포토존|드론|로봇/.test(name)) {
    ctx.add({ ...base, shape: 'cone', x, y: 0, z, w: 3.2, h: 2.6, d: 3.2, rot, color: rng.pick(['#ffffff', '#cfe8ff', '#ffe0ef']), kind: 'tent', name, why, sides: 4 });
    const [px, pz] = at(2, 0);
    ctx.add({ ...base, shape: 'box', x: px, y: 0, z: pz, w: 1.6, h: 0.8, d: 0.7, rot, color: '#8a6a4a', kind: 'table' });
  } else if (/게시판/.test(name)) {
    ctx.add({ ...base, shape: 'box', x, y: 0.5, z, w: 2.4, h: 1.6, d: 0.2, rot, color: '#7a5a3a', kind: 'board', name, why });
  } else if (/급식소|고양이/.test(name)) {
    ctx.add({ ...base, shape: 'cyl', x, y: 0, z, w: 0.5, h: 0.12, d: 0.5, rot: 0, color: '#3d7fe0', kind: 'bowl', name, why, solid: false });
    ctx.add({ ...base, shape: 'box', x: x + 0.7, y: 0, z, w: 0.55, h: 0.32, d: 0.28, rot, color: rng.pick(['#f2a65a', '#3a3a3a', '#f4f4f4']), kind: 'cat', solid: false });
  } else if (/모닥불|드럼통/.test(name)) {
    for (let k = 0; k < 3; k++) { const [px, pz] = at(Math.cos(k * 2.1) * 1.2, Math.sin(k * 2.1) * 1.2); ctx.add({ ...base, shape: 'cyl', x: px, y: 0, z: pz, w: 0.6, h: 0.9, d: 0.6, rot: 0, color: '#4a5a6a', kind: 'drum' }); }
    ctx.add({ ...base, shape: 'sphere', x, y: 0.2, z, w: 0.9, h: 1, d: 0.9, rot: 0, color: '#ff8a3d', mat: 'glow', kind: 'fire', name, why, solid: false });
  } else if (/오토바이/.test(name)) {
    for (let k = 0; k < 3; k++) { const [px, pz] = at(-1.6 + k * 1.6, 0); ctx.add({ ...base, shape: 'box', x: px, y: 0.3, z: pz, w: 0.5, h: 0.7, d: 1.8, rot, color: rng.pick(['#e0413b', '#222', '#f2c94c']), kind: 'bike', name: k ? undefined : name, why: k ? undefined : why }); }
  } else if (/낙서/.test(name)) {
    ctx.add({ ...base, shape: 'box', x, y: 0, z, w: 4, h: 2.4, d: 0.3, rot, color: '#b7ae9e', kind: 'wall', name, why });
    ctx.add({ ...base, shape: 'box', x: x - S * 0.17, y: 0.4, z: z + C * 0.17, w: 3.4, h: 1.6, d: 0.04, rot, color: '#ff3fa4', mat: 'glow', kind: 'graffiti', solid: false });
  } else if (/자판기/.test(name)) {
    addVending(ctx, x, z, rot, rng, district, name);
  } else if (/낚시|선착장|등대/.test(name)) {
    ctx.add({ ...base, shape: 'cyl', x, y: 0, z, w: 0.5, h: 0.5, d: 0.5, rot: 0, color: '#3d7fe0', kind: 'bucket', name, why });
    ctx.add({ ...base, shape: 'cyl', x: x + 0.6, y: 0, z, w: 0.05, h: 3, d: 0.05, rot: 0, color: '#3a2a1a', kind: 'rod', solid: false, rz: 0.5 });
  } else if (/홀로그램|광고/.test(name)) {
    ctx.add({ ...base, shape: 'box', x, y: 0, z, w: 0.8, h: 5, d: 0.8, rot, color: '#53c7f0', mat: 'glow', kind: 'holo', name, why });
  } else if (/분수/.test(name)) {
    ctx.add({ ...base, shape: 'cyl', x, y: 0, z, w: 3, h: 0.6, d: 3, rot: 0, color: '#9ccfe8', kind: 'fountain', name, why });
  } else if (/놀이터/.test(name)) {
    ctx.add({ ...base, shape: 'box', x, y: 0, z, w: 3, h: 2.2, d: 0.2, rot, color: '#e94f4f', kind: 'swing', name, why });
  } else {
    // 벤치/매트/소파 류
    ctx.add({ ...base, shape: 'box', x, y: 0, z, w: 2.2, h: 0.5, d: 0.8, rot, color: rng.pick(['#9a6b42', '#c94f6d', '#5b8c5a']), kind: 'seat', name, why });
  }
}

// ---------- 흔적 (breadcrumbs) ----------
function placeBreadcrumbs(ctx, rng) {
  let total = 0, withCrumbs = 0;
  for (const s of ctx.secrets) {
    if (s.y > 2) continue; // 옥상/정상 보상은 루트가 흔적
    const k = snap2(ctx, s.x, s.z, 3);
    if (k < 0) continue;
    const det = ctx.detour[k];
    if (!(det >= 8 && isFinite(det))) continue;
    // 비밀 → 동선 (detourPrev는 동선 쪽을 가리킴)
    const path = [];
    let c = k;
    while (c >= 0 && path.length < 300) { path.push(c); if (ctx.isFlow2[c]) break; c = ctx.detourPrev[c]; }
    if (path.length < 4) continue;
    path.reverse(); // 동선 → 비밀
    const pts = path.map((q) => [c2x(q), c2z(q)]);
    ctx.routes.crumbs.push({ pts, secret: s.id, type: s.type });
    const T = SECRET_TYPES[s.type];
    // 미끼: 동선에서 이탈하는 지점 (동선에서 보이는 곳)
    const li = Math.min(2, pts.length - 1);
    const [lx, lz] = pts[li];
    lure(ctx, s, lx, lz, rng);
    // 흔적: 6m 간격, 비밀 4m 전까지
    let acc = 0, placed = 0;
    for (let i = li + 1; i < pts.length - 2 && placed < 10; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc < 6) continue;
      acc = 0;
      const [x, z] = pts[i];
      const a = Math.atan2(pts[i + 1][1] - z, pts[i + 1][0] - x);
      ctx.add({ shape: s.type === 'cat' ? 'cyl' : 'box', x, y: 0.02, z, w: 0.45, h: 0.04, d: 0.3, rot: a, color: crumbColor(s.type), mat: 'glow', cat: 'crumb', kind: 'crumb', rule: 'intent.crumb', district: s.district, solid: false, name: T.crumb, why: `→ ${s.name}`, secret: s.id });
      placed++; total++;
    }
    if (placed) withCrumbs++;
    s.crumbs = placed;
    s.pathLen = path.length * S2;
  }
  ctx.crumbStats = { total, withCrumbs };
  ctx.log('intent.crumb', `흔적 ${total}개 (비밀 ${withCrumbs}개에 연결)`);
}

const crumbColor = (t) => ({ cat: '#5a4636', wonder: '#7fd7ff', tag: '#ff4fa8', memory: '#ffffff', stash: '#8a6a4a', treasure: '#ffe066' }[t] || '#62f0ff');

function lure(ctx, s, x, z, rng) {
  const base = { district: s.district, cat: 'crumb', rule: 'intent.crumb', solid: false, secret: s.id, mat: 'std' };
  const why = `동선 이탈 지점의 미끼 → ${s.name}`;
  if (s.type === 'cat') {
    ctx.add({ ...base, shape: 'box', x, y: 0, z, w: 0.55, h: 0.3, d: 0.28, rot: rng.range(0, 6), color: '#2f2f2f', kind: 'lurecat', name: '골목을 쳐다보는 고양이', why });
  } else if (s.type === 'wonder') {
    ctx.add({ ...base, shape: 'sphere', x, y: 1.4, z, w: 0.35, h: 0.35, d: 0.35, rot: 0, color: '#7fd7ff', mat: 'glow', kind: 'lurewisp', name: '푸른 도깨비불', why });
  } else if (s.type === 'tag') {
    ctx.add({ ...base, shape: 'box', x, y: 0.03, z, w: 1.4, h: 0.04, d: 0.6, rot: rng.range(0, 6), color: '#ff4fa8', mat: 'glow', kind: 'lurepaint', name: '바닥 스프레이 화살표', why });
  } else {
    ctx.add({ ...base, shape: 'cyl', x, y: 0, z, w: 0.12, h: 1.4, d: 0.12, rot: 0, color: '#ffffff', kind: 'lurepole', why });
    ctx.add({ ...base, shape: 'sphere', x, y: 1.5, z, w: 0.3, h: 0.3, d: 0.3, rot: 0, color: '#ffe066', mat: 'glow', kind: 'lureglint', name: '반짝이는 무언가', why });
  }
}

// ---------- 동네 고양이 (살아있는 도시 신호) ----------
function placeAmbientCats(ctx, rng) {
  let n = 0;
  for (let t = 0; t < 6000 && n < 36; t++) {
    const k = rng.int(0, n2 * n2 - 1);
    if (ctx.cost2[k] <= 0) continue;
    const h = ctx.hidden[k];
    if (h < 0.35 || h > 0.75) continue;
    const x = c2x(k), z = c2z(k);
    const d = distAt(ctx, x, z);
    if (!d || !['residential', 'ruins', 'park', 'commercial'].includes(d.type)) continue;
    if (roadAt(ctx, x, z) === ROAD.MAIN) continue;
    ctx.add({ shape: 'box', x, y: 0, z, w: 0.55, h: 0.3, d: 0.28, rot: rng.range(0, 6), color: rng.pick(['#f2a65a', '#3a3a3a', '#f4f4f4', '#9a8a7a']), mat: 'std', cat: 'prop', kind: 'cat', rule: 'micro.cat', district: d.id, solid: false, name: '동네 고양이' });
    n++;
  }
  void segDist2; void TERRAIN;
}
