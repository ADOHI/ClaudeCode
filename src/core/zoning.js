// 도시 조직(fabric) 용도 데이터: 골격(역·거리·이음매·옛길)을 읽는 용도표 + 높이장 + 건축선.
// 순수 데이터 + 두 헬퍼(heightFactor, buildToFor). 레거시 경로(genCityBuildings)는 이 파일을 쓰지 않는다.
// C§4 프로그램, C§7 B3.4/B4, C§8 C1 SEAMS — 표를 고치면 도시의 성격이 바뀐다.
import { PROGRAMS, skylineFactor } from './buildings.js';
import { STREET_CHAR, WORLD } from './config.js';

const H = WORLD.half, N = WORLD.size;

// ---- C§4: 새 건물 프로그램 8종 + 문턱 쉼터 (특수 필지) ----
export const NEW_PROGRAMS = {
  stationery: { label: '문구점', color: '#f2b134', floors: [1, 2], set: [[0.3, 1], [0.5, 1], [1, 2]], awning: true, sign: 'band', roof: 'res', poi: 'shop' },
  cram: { label: '입시학원', color: '#6c8ebf', floors: [3, 5], set: [[0.5, 1.5], [0.5, 1], [1, 2]], sign: 'tall', roof: 'com' },
  izakaya: { label: '이자카야', color: '#b5523b', floors: [1, 2], set: [[0.3, 1], [0.5, 1], [1, 2]], awning: true, sign: 'small', roof: 'res', poi: 'shop', lantern: true },
  bakery: { label: '빵집', color: '#e8b07a', floors: [1, 2], set: [[1, 2], [0.5, 1], [1, 2]], awning: true, sign: 'small', roof: 'res', poi: 'shop', terrace: true },
  boarding: { label: '하숙집', color: '#d8c3a5', floors: [2, 3], set: [[1.5, 3], [1, 2], [2, 3]], roof: 'house' },
  sento: { label: '목욕탕', color: '#9ec9d9', floors: [1, 2], set: [[1, 2], [1, 2], [1, 2]], sign: 'band', roof: 'flat', poi: 'shop', chimney: 18, unique: 1 },
  old_shop: { label: '노포', color: '#a8835a', floors: [1, 2], set: [[0, 0.6], [0.3, 0.8], [1, 2]], awning: true, awningColor: '#3b4a6b', sign: 'small', roof: 'house', poi: 'shop', lantern: true },
  live_house: { label: '라이브하우스', color: '#7a3fa0', floors: [2, 3], set: [[0.5, 1], [0.5, 1], [1, 2]], sign: 'tall', roof: 'com', poi: 'anchor', unique: 1 },
  threshold_plaza: { label: '문턱 쉼터', color: '#d9cfbd', floors: [0, 0], set: [[0, 0], [0, 0], [0, 0]], special: 'threshold_plaza', poi: 'micro' },
};
// 모듈 로드 시 buildings.PROGRAMS에 병합 (이미 있는 키는 건드리지 않는다 → 레거시 프로그램 불변)
for (const [k, v] of Object.entries(NEW_PROGRAMS)) if (!(k in PROGRAMS)) Object.assign(PROGRAMS, { [k]: v });

// ---- C§7 B4: 역세권(TOD) 가중 — w = 역까지 보행거리(m) ----
export const TOD = {
  residential: { apartment: (w) => 1 + 2.5 * Math.exp(-w / 150), house: (w) => 0.35 + 0.65 * (1 - Math.exp(-w / 150)), convenience: (w) => 1 + 2 * Math.exp(-w / 90) },
  commercial: { arcade_game: (w) => 1 + 3 * Math.exp(-w / 100), karaoke: (w) => 1 + 3 * Math.exp(-w / 100), mall: (w) => 1 + 3 * Math.exp(-w / 100) },
  ruins: { construction: (w) => 1 + 4 * Math.exp(-w / 120), ruin: (w) => 0.4 + 0.6 * (1 - Math.exp(-w / 120)) }, // 재개발 전선이 역에서 번진다
  harbor: { office: (w) => 1 + 3 * Math.exp(-w / 100) },
};
// 목적별 흐름(fP: commute/school/shop/leisure/market, 0..1) 가중
export const PURPOSE_MULT = {
  bookstore: (f) => 1 + 2 * f.school, stationery: (f) => 1 + 2 * f.school, convenience: (f) => (1 + 1.5 * f.commute) * (1 + f.school),
  shophouse: (f) => 1 + 2 * f.shop, arcade_game: (f) => 1 + 2 * f.shop, karaoke: (f) => 1 + 1.5 * f.shop, cafe: (f) => 1 + 1.5 * f.leisure, izakaya: (f) => 1 + 2 * f.market,
};
// 역전 광장 필지 (EKIMAE), 옛길 필지 (HERITAGE)
export const EKIMAE = [['mall', 3], ['convenience', 2], ['cafe', 2], ['karaoke', 1.5], ['arcade_game', 1.5], ['office', (l) => (l.area > 300 ? 3 : 0.5)]];
export const HERITAGE = [['old_shop', 5], ['house', 3], ['izakaya', (l) => (l.dtype === 'commercial' || l.dtype === 'harbor' ? 1.5 : 0.3)], ['courtyard', (l) => (l.interior ? 4 : 0)]];

// ---- C§7 B3.4: 이름 있는 거리의 용도 혼합 (w = 0.3·구역표 + 0.7·거리표) ----
export const STREET_ZONING = {
  gakuen: [['bookstore', 3], ['stationery', 3], ['cafe', 3], ['cram', (l) => (l.area > 220 ? 2 : 0)], ['convenience', (l) => (l.corner ? 4 : 0.5)], ['bakery', 1.5], ['karaoke', 1]],
  shotengai: [['shophouse', 5], ['cafe', 2], ['convenience', (l) => (l.corner ? 3 : 0.3)], ['bookstore', 1], ['bakery', 1], ['arcade_game', (l) => (l.fP.shop > 0.5 && l.area > 200 ? 3 : 0)]],
  market: [['izakaya', 4], ['fishmarket', (l) => (l.sea < 80 ? 1 : 0)], ['shophouse', 2]],
  promenade: [['cafe', 4], ['apartment', (l) => (l.area > 300 ? 2 : 0)], ['house', 1]],
  // 하천 산책로(frontType PARK_PATH)에 면한 필지 — C§8 C4
  riverside: [['cafe', 3], ['apartment', (l) => (l.area > 300 ? 1.5 : 0)]],
};

// ---- C§8 C1: 이음매(경계 띠) 용도표 ----
const SEAM_WHY = '{A}와 {B} 사이 — {name}';
const S = (name, table, extra = {}) => ({ name, table, why: SEAM_WHY, ...extra });
export const SEAMS = {
  'academy|commercial': S('학원가', [['bookstore', 3], ['stationery', 3], ['cafe', 3], ['cram', 2], ['convenience', (l) => (l.corner ? 4 : 0.3)], ['karaoke', 1]]),
  'arts_academy|commercial': S('공연 거리', [['live_house', 2], ['cafe', 3], ['bookstore', 1], ['shophouse', 2]]),
  'academy|residential': S('하숙촌', [['boarding', 4], ['house', 2], ['dorm', (l) => (l.area > 350 ? 2 : 0)], ['laundromat', 1], ['convenience', (l) => (l.corner ? 2 : 0)], ['bakery', 1]]),
  'tech_academy|residential': S('테크 하숙촌', [['boarding', 3], ['convenience', 2], ['shophouse', 1]]),
  'academy|center': S('학원 행정가', [['gov', (l) => (l.area > 500 ? 2 : 0)], ['office', 2], ['bookstore', 2], ['cafe', 2]]),
  'academy|harbor': S('산학 창고', [['lab', 3], ['warehouse', 3], ['server', 1]]),
  'academy|ruins': S('폐교 언저리', [['ruin', 3], ['ruin_shop', 2], ['house', 1], ['shed', 1]]),
  'free_academy|ruins': S('무법지대', [['ruin_shop', 3], ['shed', 2], ['ruin', 2]]),
  'academy|park': S('숲 가장자리', [['cafe', 3], ['house', 2], ['pocketpark', 1]]),
  'commercial|residential': S('생활 상점가', [['shophouse', 4], ['laundromat', 1.5], ['convenience', (l) => (l.corner ? 3 : 0.3)], ['bakery', 1.5], ['sento', 0.6]]),
  'center|commercial': S('번화가', [['office', 3], ['karaoke', 2], ['arcade_game', 1.5], ['cafe', 1.5]]),
  'center|residential': S('도심 주거', [['apartment', 4], ['convenience', (l) => (l.corner ? 2 : 0)], ['cafe', 1]]),
  'commercial|harbor': S('어시장 골목', [['izakaya', 4], ['fishmarket', (l) => (l.sea < 80 ? 1 : 0)], ['shophouse', 2], ['warehouse', 1]]),
  'harbor|residential': S('항구 마을', [['house', 3], ['izakaya', 2], ['shed', 1], ['sento', 0.6]]),
  'harbor|ruins': S('옛 포구', [['old_shop', 2], ['izakaya', 2], ['ruin', 2], ['sento', 1]]),
  'residential|ruins': S('옛 동네', [['house', 3], ['ruin', 2], ['old_shop', 1], ['laundromat', 0.5]]),
  'commercial|ruins': S('셔터 상점가', [['ruin_shop', 3], ['shophouse', 2], ['construction', (l) => (l.area > 250 ? 1 : 0)]]),
  'park|*': S('공원 앞', [['cafe', 3], ['house', 2], ['pocketpark', 1.5]], { frontSetback: 2 }),
};

/** 구역 유형 쌍 → SEAMS 키: 정확한 정렬 쌍 → 학원 와일드카드(*_academy → academy) → park|* → null */
export function seamKey(typeA, typeB) {
  if (!typeA || !typeB || typeA === typeB) return null;
  const k = [typeA, typeB].sort().join('|');
  if (SEAMS[k]) return k;
  const g = (t) => (t.endsWith('_academy') ? 'academy' : t);
  const k2 = [g(typeA), g(typeB)].sort().join('|');
  if (SEAMS[k2]) return k2;
  if (typeA === 'park' || typeB === 'park') return 'park|*';
  return null;
}

export const PURPOSE_KO = { commute: '통근', school: '통학', shop: '쇼핑', leisure: '산책', market: '물류', through: '통과' };

// ---- C§7 B4: 역세권 높이장 (plan 경로에서 skylineFactor 대체) ----
const WS = { commercial: 1, center: 1, residential: 0.8, ruins: 0.7, harbor: 0.5, park: 0.4 }; // 학원 외곽 띠 0.6

/** 1m 격자 샘플 */
const at1 = (arr, x, z, fb) => {
  if (!arr) return fb;
  const i = Math.floor(x + H), j = Math.floor(z + H);
  if (i < 0 || j < 0 || i >= N || j >= N) return fb;
  const v = arr[j * N + i];
  return Number.isFinite(v) ? v : fb;
};
/** 256² 4m 격자 쌍선형 샘플 (셀 중심 기준) */
export function bilinear4(arr, x, z, fb = Infinity) {
  if (!arr) return fb;
  const n = 256, fx = (x + H) / 4 - 0.5, fz = (z + H) / 4 - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const c = (a, b) => arr[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))];
  const a = c(i, j), b = c(i + 1, j), d = c(i, j + 1), e = c(i + 1, j + 1);
  if (![a, b, d, e].every(Number.isFinite)) return Math.min(a, b, d, e);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
}

/** 역세권 상승 항 (원인 문구 '역세권 ×k'에도 쓴다) */
export function stationTerm(dtype, walkStation) {
  const ws = WS[dtype] ?? 0.6;
  const w = Number.isFinite(walkStation) ? walkStation : Infinity;
  return 0.8 * ws * Math.exp(-((w / 130) ** 2));
}

/** heightFactor(ctx, lot): 스파이어 + 역세권 봉우리 + 골격 연도 − 물가·공원 완화. ctx.plan 없으면 skylineFactor */
export function heightFactor(ctx, lot) {
  const d = ctx.districts[lot.district];
  const type = d ? d.type : 'residential';
  if (!ctx.plan) return type === 'ruins' || type === 'harbor' ? 1 : skylineFactor(lot.x, lot.z);
  const r = Math.hypot(lot.x, lot.z);
  const dSpine = at1(ctx.plan.distSpine, lot.x, lot.z, 1e3);
  const dRiver = at1(ctx.distRiver, lot.x, lot.z, 1e3);
  const dPark = bilinear4(ctx.plan.distPark4, lot.x, lot.z, 1e3);
  let hf = 1 + 0.85 * Math.exp(-(r * r) / (2 * 230 * 230))
    + stationTerm(type, lot.walk ? lot.walk.station : Infinity)
    + 0.15 * Math.exp(-dSpine / 25)
    - 0.25 * Math.exp(-dRiver / 35) - 0.2 * Math.exp(-dPark / 40);
  hf = Math.max(0.7, Math.min(2.6, hf));
  if (type === 'ruins') hf = 1 + 0.6 * (hf - 1);
  if (type === 'harbor') hf = 1 + 0.4 * (hf - 1);
  if (lot.heritage) hf = Math.min(hf, 1);
  return hf;
}

/** 이름 있는 거리 레코드 (id → street), plan별 캐시 */
const streetCache = new WeakMap();
export function streetById(ctx, id) {
  const plan = ctx.plan;
  if (!plan || !plan.streets || !(id >= 0)) return null;
  let m = streetCache.get(plan);
  if (!m || m.size !== plan.streets.length) {
    m = new Map();
    plan.streets.forEach((s, i) => m.set(s.id ?? i, s));
    streetCache.set(plan, m);
  }
  return m.get(id) || null;
}

/** 전면 건축선 범위 [min,max] (m): 거리 성격 → 골격 → 옛길 → 압축 문턱 → 없음 */
export function buildToFor(ctx, lot) {
  const st = lot.street >= 0 ? streetById(ctx, lot.street) : null;
  if (st && STREET_CHAR[st.kind] && STREET_CHAR[st.kind].buildTo) return STREET_CHAR[st.kind].buildTo;
  if (lot.spine && STREET_CHAR[lot.spine] && STREET_CHAR[lot.spine].buildTo) return STREET_CHAR[lot.spine].buildTo;
  if (lot.heritage && STREET_CHAR.old) return STREET_CHAR.old.buildTo;
  if (lot.compress !== undefined && lot.compress !== null) return [0, 0.4];
  return undefined;
}

/** 표 항목 가중치 (숫자 또는 함수) */
export const wval = (wf, feat) => (typeof wf === 'function' ? wf(feat) : wf) || 0;
