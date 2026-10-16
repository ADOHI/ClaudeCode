// 생성 파이프라인 오케스트레이터. 단계마다 독립 RNG 스트림 + 타이밍 + 로그.
import { RNG } from './rng.js';
import { RULES } from './config.js';
import { genTerrain } from './terrain.js';
import { genDistricts } from './districts.js';
import { genRoads, rasterizeRoads, computeNodes } from './roads.js';
import { extractBlocks, genAlleys, genLots } from './blocks.js';
import { buildHubs, chooseLandmarkSites, genCityBuildings, genCenter, markSpecialBlocks, genContainerYard, genHarborFeatures } from './city.js';
import { roadFlow, fullAnalysis } from './analysis.js';
import { genCampuses } from './campus.js';
import { genPark } from './park.js';
import { genRail } from './rail.js';
import { genProps } from './props.js';
import { genIntent } from './intent.js';
import { computeMetrics } from './metrics.js';

export const STAGES = [
  ['terrain', '섬 지형 · 하천', (c) => genTerrain(c)],
  ['districts', '구역 배치 최적화', (c) => genDistricts(c)],
  ['roads', '텐서장 가로망', (c) => { genRoads(c); rasterizeRoads(c); computeNodes(c); }],
  ['blocks', '블록 · 관통 골목', (c) => { extractBlocks(c); genAlleys(c); markSpecialBlocks(c); }],
  ['lots', '둘레형 필지 분할', (c) => genLots(c)],
  ['flow0', '도로 흐름 · 랜드마크 비스타', (c) => { buildHubs(c); roadFlow(c); chooseLandmarkSites(c); }],
  ['buildings', '용도 배정 · 건물', (c) => { genCenter(c); genCityBuildings(c); genContainerYard(c); genHarborFeatures(c); }],
  ['campus', '학원 캠퍼스 문법', (c) => genCampuses(c)],
  ['park', '공원 문법', (c) => genPark(c)],
  ['rail', '모노레일 환상선', (c) => genRail(c)],
  ['props', '마이크로 규칙', (c) => genProps(c)],
  ['analysis', '흐름 · 아이소비스트 분석', (c) => fullAnalysis(c)],
  ['intent', '의도 레이어 배치', (c) => genIntent(c)],
  ['metrics', '레벨 품질 지표', (c) => computeMetrics(c)],
];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const DEFAULT_PARAMS = { density: 1, alleys: 1 };

export function createContext(seed, params = {}) {
  const ctx = {
    seed: String(seed),
    params: { ...DEFAULT_PARAMS, ...params },
    rng: new RNG(`academy-city:${seed}`),
    entities: [], pois: [], landmarks: [], decals: [], buildings: [], secrets: [], hubs: [],
    logs: [], timings: {}, ruleCount: {},
  };
  ctx.add = (e) => {
    e.id = ctx.entities.length;
    if (e.rot === undefined) e.rot = 0;
    ctx.entities.push(e);
    return e;
  };
  ctx.addPoi = (p) => {
    p.id = ctx.pois.length;
    ctx.pois.push(p);
    return p;
  };
  ctx.addLandmark = (l) => {
    l.id = ctx.landmarks.length;
    ctx.landmarks.push(l);
    return l;
  };
  ctx.log = (rule, msg) => ctx.logs.push({ rule, msg, name: RULES[rule] ? RULES[rule].name : rule });
  ctx.removeBuilding = (b) => {
    b.deleted = true;
    for (const e of ctx.entities) if (e.ref === b.id) e.deleted = true;
    for (const p of ctx.pois) if (p.building === b.id) p.deleted = true;
  };
  return ctx;
}

/** 동기 생성 (Node/워커) */
export function generateSync(seed, onStage, params) {
  const ctx = createContext(seed, params);
  const t0 = now();
  for (const [key, label, fn] of STAGES) {
    const t = now();
    fn(ctx);
    ctx.timings[key] = now() - t;
    if (onStage) onStage(key, label, ctx);
  }
  ctx.timings.total = now() - t0;
  return ctx;
}

/** 비동기 생성 (브라우저: 단계 사이에 UI 갱신) */
export async function generate(seed, onStage, params) {
  const ctx = createContext(seed, params);
  const t0 = now();
  for (let s = 0; s < STAGES.length; s++) {
    const [key, label, fn] = STAGES[s];
    if (onStage) await onStage(key, label, s, STAGES.length);
    const t = now();
    fn(ctx);
    ctx.timings[key] = now() - t;
  }
  ctx.timings.total = now() - t0;
  return ctx;
}
