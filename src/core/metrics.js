// 레벨 품질 지표 — 생성-검증(generate & test) 루프와 시드 탐색(MAP-Elites)의 적합도.
import { WORLD } from './config.js';
import { lineOfSight, c2x, c2z } from './analysis.js';

export function computeMetrics(ctx) {
  const rng = ctx.rng.fork('metrics');
  const n2 = WORLD.size / WORLD.ana;
  // 규칙별 배치 수
  const rc = {};
  for (const e of ctx.entities) if (!e.deleted && e.rule) rc[e.rule] = (rc[e.rule] || 0) + 1;
  for (const p of ctx.pois) if (!p.deleted && p.rule) rc[p.rule] = (rc[p.rule] || 0) + 1;
  // 매크로 규칙은 엔티티가 아니라 구조를 만든다 → 구조물 개수로 집계
  const live = ctx.roadLines.filter((l) => !l.removed);
  rc['macro.island'] = 1;
  rc['macro.river'] = ctx.river ? 1 : 0;
  rc['macro.district'] = ctx.districts.length;
  rc['macro.tensor'] = live.filter((l) => l.level <= 2 && !l.approach).length;
  rc['macro.approach'] = live.filter((l) => l.approach !== undefined).length;
  rc['macro.coast'] = live.filter((l) => l.coast).length;
  rc['macro.bridge'] = live.filter((l) => l.bridge).length;
  rc['meso.lot'] = ctx.lots.length;
  rc['meso.deadend'] = live.filter((l) => l.deadEnd).length;
  rc['intent.flow'] = ctx.hubs.length;
  ctx.ruleCount = rc;
  // 방향감: 메인 동선 샘플에서 랜드마크 가시율
  const flowCells = [];
  for (let k = 0; k < n2 * n2; k++) if (ctx.isFlow2[k]) flowCells.push(k);
  rng.shuffle(flowCells);
  const sample = flowCells.slice(0, 900);
  const spire = ctx.landmarks.find((l) => l.global);
  let seeSpire = 0, seeAny = 0;
  for (const k of sample) {
    const x = c2x(k), z = c2z(k);
    let any = false;
    if (spire && lineOfSight(ctx, x, z, 1.6, spire.x, spire.z, spire.h * 0.8, 24)) { seeSpire++; any = true; }
    if (!any) {
      for (const l of ctx.landmarks) {
        if (l.global) continue;
        const d = Math.hypot(l.x - x, l.z - z);
        if (d > 650) continue;
        if (lineOfSight(ctx, x, z, 1.6, l.x, l.z, l.h * 0.85, 10)) { any = true; break; }
      }
    }
    if (any) seeAny++;
  }
  const secretsByType = {};
  const revealBy = {};
  let hid = 0, det = 0, crumbed = 0;
  for (const s of ctx.secrets) {
    secretsByType[s.type] = (secretsByType[s.type] || 0) + 1;
    revealBy[s.reveal] = (revealBy[s.reveal] || 0) + 1;
    hid += s.hidden || 0;
    det += isFinite(s.detour) ? s.detour : 0;
    if (s.crumbs) crumbed++;
  }
  const ns = ctx.secrets.length || 1;
  const roadLen = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const l of ctx.roadLines) {
    if (l.removed) continue;
    let L = 0;
    for (let k = 1; k < l.pts.length; k++) L += Math.hypot(l.pts[k].x - l.pts[k - 1].x, l.pts[k].z - l.pts[k - 1].z);
    roadLen[l.level] += L;
  }
  const de = ctx.deadEndStats || { total: 0, rewarded: 0, already: 0 };
  const deCov = de.total ? (de.rewarded + de.already) / de.total : 1;
  const rh = ctx.rhythm || { after: { cov: 0, max: 0, mean: 0 }, before: { cov: 0 } };
  const m = {
    entities: ctx.entities.filter((e) => !e.deleted).length,
    buildings: ctx.buildings.filter((b) => !b.deleted).length,
    lots: ctx.lots.length,
    blocks: ctx.blocks.length,
    nodes: ctx.nodes.length,
    pois: ctx.pois.filter((p) => !p.deleted).length,
    landmarks: ctx.landmarks.length,
    secrets: ctx.secrets.length,
    secretsByType, revealBy,
    secretHiddenAvg: hid / ns,
    secretDetourAvg: det / ns,
    crumbCoverage: crumbed / ns,
    rooftopRoutes: ctx.routes ? ctx.routes.rooftop.length : 0,
    gates: ctx.gates2 ? ctx.gates2.length : 0,
    roadKm: Object.fromEntries(Object.entries(roadLen).map(([k, v]) => [k, +(v / 1000).toFixed(2)])),
    poiCoverage: rh.after.cov, poiCoverageBefore: rh.before.cov, poiGapMax: rh.after.max, poiGapMean: rh.after.mean,
    microAdded: rh.added || 0,
    spireVisible: sample.length ? seeSpire / sample.length : 0,
    landmarkVisible: sample.length ? seeAny / sample.length : 0,
    deadEnds: de.total, deadEndCoverage: deCov,
    observers: ctx.observers,
  };
  // 종합 점수 (시드 탐색용 적합도)
  m.score = +(0.3 * m.poiCoverage + 0.25 * m.landmarkVisible + 0.2 * Math.min(1, m.secrets / 60) + 0.15 * m.deadEndCoverage + 0.1 * Math.min(1, m.rooftopRoutes / 10)).toFixed(4);
  // 행동 기술자 (MAP-Elites 축): 도로 밀도, 숨김 공간 비율
  let hiddenCells = 0, walk = 0;
  for (let k = 0; k < n2 * n2; k++) if (ctx.cost2[k] > 0) { walk++; if (ctx.hidden[k] > 0.8) hiddenCells++; }
  m.bdRoadDensity = (roadLen[1] + roadLen[2] + roadLen[3]) / 1000;
  m.bdHiddenRatio = walk ? hiddenCells / walk : 0;
  ctx.metrics = m;
}
