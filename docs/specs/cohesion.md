<!-- Verbatim source spec (track "cohesion"), saved by the tech lead so work-package agents can resolve "C§" references.
     Where a work package's instructions or the combined plan differ from this text, the work package / combined plan wins. -->

# Cohesion track: final implementation spec
## 도시 골격 계획 (Structure Plan) with a relation layer and one old road

> **요약 (KR).** 지금 도시가 "청크를 흩뿌린 것" 같은 이유는 세 가지다.
> 1. 모든 규칙이 `ZONING[d.type]`처럼 "나는 어느 보로노이 칸인가"만 묻는다.
> 2. 간선 흐름선에는 목적지가 없다.
> 3. 역은 건물을 다 지은 뒤에 끼워 넣어서 오히려 건물을 깎는다.
>
> 이 명세는 순서를 뒤집는다. 먼저 도시 전체 골격을 깐다: 학원 환상대로와 그 중앙분리대 위 모노레일, 스파이어에서 각 정문·코어로 끝나는 방사 대로, 역과 역전 광장, 하구 어촌에서 시작하는 옛길 하나. 이어서 구역 사이의 관계 그래프(통학·방과후·물류·산책·국경)를 만든다. 용도, 높이, 거리 성격, 경계 띠(이음매), 문턱, 소품, 이름은 모두 이 골격과 관계를 읽고 정해진다. 그래서 모든 건물은 "센트럴역 도보 60m · 루미에르 언덕길 변 · 상점가↔여학원 이음매"처럼 이웃과의 관계로 자기 위치를 설명할 수 있다.

---

## 1. Decisions

**Winner.** Proposal 1, the planner's Structure Plan (picked by 2 of 3 judges), is the skeleton:
- ring and radials
- stations first, with a TOD height gradient
- squares
- named streets with `STREET_CHAR`
- seams
- riverside promenade
- why-chains

**Wrapped in:**
- Proposal 3's typed relation graph, as the single explanation layer.
- Proposal 2's single old road, as the history layer.

| Source | Kept or grafted |
|---|---|
| P1 | Ring boulevard, 4-7 destination-ending radials, spine-aligned tensor, stations at ring and trunk knots, station / gate / core squares, `heightFactor` and TOD weights, EKIMAE override, purpose-coded OD flow grouped by origin, named streets with `STREET_CHAR` (build-to line, grain, street wall, continuous awnings, banners, arches), `SEAMS` two-pass zoning, riverside promenade, axial landmark termination, relational signposts, metrics. |
| P3 | Relation graph `ctx.plan.relations` as the one "why" source. Annealing terms: dorm towns near academies, harbor near commercial, ruins near harbor. Thresholds (compression → release plaza + gateway). Height relaxation (cross-border ratio ≤ 2.5). `borderProgramJS` band, `borderGridAngle`. `influence(x,z)` interface. "이 관계만 강조". Up to 3 cross-district lock and key chains. |
| P2 | One old road: river-mouth fishing village → along the river terrace → ford, with a 참배길 branch to the world tree. Also: `ROAD.OLD`, level-2 streets T-junctioning into it, an old-road tensor term, heritage lots with era-0 gable roofs, the harbor-at-river-mouth annealing term, relational persona names, one influence field per academy (banners, tree species colour swap, graffiti, rival front line), and the ground seam blend done as a blurred district-colour image. |
| **Cut** | Era-replay slider. Furness gravity model. Story links except the 참배길. Full `ERA_STYLE` palettes (handed to the building-style track). Turning the eldest gate toward the old town. Golden-path DFS. Purpose kits (only school-zone paint and bike racks remain). Spine bundling. The relation diagram drawn as LineSegments. Ameyoko rail offset. P1's M7 era field. Seaside promenade. View-corridor rebuild via `removeBuilding`. Three parallel why-schemas. More than about 2.8k new entities. New materials or geometries. |

**Conflicts resolved**

1. **Road rebuild scope** (J2 against J1 and J3).
   - Spines are inserted as level-1 lines into the existing streamline machinery.
   - Only the 7 random spokes and the two `±150` seeds are removed.
   - District-seed main seeds stay when they are more than 90 m from a spine.
   - `dsepMain` and `maxMainLines` are `PLAN` table knobs. They are tuned against the acceptance checks for `mainShare`, lot count and block count.
2. **Rail.**
   - When the ring is closed, the rail rides the ring median.
   - Otherwise the legacy Catmull-Rom loop runs through the plan's stations.
   - No Ameyoko arcs. The legacy clearance-to-gaado pass stays for residual overlaps.
3. **Gate orientation is unchanged:** gates still face the spire. The ring is pulled through a gate junction 36 m in front of each gate, not 16 m, so a 10 m gate plaza fits between the wall and the boulevard. This was verified on 15 seeds.
4. **One of each.** One flow system (tagged OD), one cause schema (`cause[]` + `rel`), and one territory field per academy.
5. **View protection** is only a floor cap at zoning time: at most 3 lots per axis, minimum 2 floors.
6. **Building variety** is not in this track. This track exposes `ctxTags` and `influence()` for the building-style track (§10). Its only visible style change is era-0 gable and dark-tile roofs on old-road frontage.

---

## 2. Baseline and prototype evidence

All numbers are for seed `lumina` unless noted. Probes were run in the scratchpad.

| Quantity | Now | Source |
|---|---|---|
| Total generation time | 3.34-3.6 s | headless |
| Entities / buildings / lots / blocks | 12,722 / 675 / 857 / 264 | headless |
| Main-road share (`roadKm` L1 ÷ all) | 0.33 (7.52 of 22.75 km) | probe |
| Mean floors within 80 m of a ring station ÷ city mean | 0.83 (station areas 2.3-4.1 F, city 3.87 F) | probe |
| Building height difference across vs within a border (pairs < 30 m) | 8.43 / 6.16 m, ratio 1.37 | probe |
| Block grid angle across vs within a border (blocks < 70 m apart) | 20.9° vs 8.6° | probe |
| Program-mix Jensen-Shannon divergence within 35 m of borders | mean 0.75; several pairs at 1.00 | probe |
| Approach avenues | 51-108 m | log |
| Gate → nearest station walk | 34 / 182 / 229 / 190 m | probe |
| Academy → nearest residential seed | trad 532 m, arts 593 m | probe |
| 4 m Dijkstra / 1 m EDT / `fullAnalysis` | 3.3 ms / 54 ms / 638 ms (58 hubs) | probe |

**Prototype 1: annealing terms (§A1)**, 15 seeds (lumina, sakura-101, halo-7, aurora-42, kivo-999, nova-3, iris-55, hikari-808, yume-12, a, Z, mirai-1, kivo-2, stella-3, yume-4), median old → new:

| Measure | Old | New |
|---|---|---|
| Academy → nearest residential, median | 481 m | 283 m |
| Academy → nearest residential, max | 626 m | 484 m |
| Harbor → river mouth | 288 m | 142 m |
| Ruins → harbor | 678 m | 253 m |
| Free academy → ruins | 220 m | 240 m (still ≤ 300 m max) |

**Prototype 2: ring (§A3).**
- The ring closed on 15 of 15 seeds.
- Coverage was 360-397°, length 1.43-1.84 km, and the worst leg's length ÷ straight-line distance was ≤ 1.94.
- Run time was 26-116 ms unoptimised.
- Two fixes were required, and both are part of the spec: an angular window per leg, and a cap on the radial-deviation penalty. Without them, 5 of 15 seeds detoured around the whole island.

**Prototype 3: old road (§A2).**
- R1 (village → ford) was 321-548 m on all 15 seeds.
- R2 (참배길) was 0-357 m.
- 8 m Dijkstra cost 7-33 ms.

---

## 3. Pipeline after the change

`src/core/generator.js`:

```js
export const DEFAULT_PARAMS = { density: 1, alleys: 1, plan: true };
// createContext: ctx.plan = null; ctx.history = null;
export const STAGES = [
  ['terrain',  '섬 지형 · 하천',        c => genTerrain(c)],            // + ctx.riverMouths
  ['districts','구역 배치 최적화',       c => genDistricts(c)],          // + relation annealing terms, district2, seamMargin (plan only)
  ['history',  '연대기 · 옛길',          c => { if (c.params.plan) genHistory(c); }],   // NEW history.js
  ['plan',     '도시 골격 계획',         c => { if (c.params.plan) genPlan(c); }],      // NEW structure.js
  ['roads',    '텐서장 가로망',          c => { genRoads(c); rasterizeRoads(c); computeNodes(c); if (c.plan) planStreets(c); }],
  ['blocks',   '블록 · 관통 골목',       c => { extractBlocks(c); genAlleys(c); markSpecialBlocks(c); }],
  ['lots',     '둘레형 필지 분할',       c => { genLots(c); if (c.plan) markThresholds(c); }],
  ['flow0',    '생활 동선 · 랜드마크 축선', c => { if (c.plan) { buildOD(c); accessFields(c); } else buildHubs(c); roadFlow(c); chooseLandmarkSites(c); }],
  ['buildings','용도 배정 · 건물',       c => { genCenter(c); c.plan ? genCityBuildingsPlan(c) : genCityBuildings(c); if (c.plan) { genSquares(c); genThresholds(c); } genContainerYard(c); genHarborFeatures(c); }],
  ['campus',   '학원 캠퍼스 문법',       c => genCampuses(c)],
  ['park',     '공원 문법',              c => genPark(c)],               // uses history.sacred / parkEntry
  ['rail',     '모노레일 환상선',         c => genRail(c)],               // ring rail when plan.ring.closed
  ['props',    '마이크로 규칙',           c => genProps(c)],              // + computeAcademyInfluence, banners, arches, lanterns
  ['analysis', '흐름 · 아이소비스트 분석', c => fullAnalysis(c)],         // tagged OD flow
  ['intent',   '의도 레이어 배치',        c => genIntent(c)],             // relational signposts, front-line checkpoint, chains
  ['metrics',  '레벨 품질 지표',          c => computeMetrics(c)],        // + metrics.cohesion
];
```

**A/B rule.** With `params.plan === false`:
- every changed function takes its legacy branch;
- the two new stages are no-ops;
- the annealing terms are off;
- lumina must reproduce today's metrics exactly.

Implement this with `if (ctx.plan)` guards, plus `if (ctx.params.plan)` inside the `districts.js` score function.

**RNG.** New forks are `history`, `plan`, `streets`, `squares`, `thresholds`, `influence` and `chains`. Lot RNGs are unchanged.

**New files**

| File | Contents |
|---|---|
| `src/core/history.js` | `genHistory`, `distOldAt` |
| `src/core/structure.js` | `genPlan` (`computeGates`, `planCost4`, `traceRing`, `planParkGates`, `traceRadials`, `pickStations`, `stampSquares`, `buildRelations`, `assignPersonas`), `buildOD`, `accessFields`, `walkCost4` |
| `src/core/streets.js` | `planStreets`, `stampStreetMask`, `markThresholds` |
| `src/core/seams.js` | `seamKey`, `seamOf(ctx, lot)`, `influence(ctx, x, z)`, `lerpColor`, `districtColorField(ctx)` (blurred 256² RGB) |
| `src/core/influence.js` | `computeAcademyInfluence`, `inflAt(ctx, faction, x, z)`, `domAt(ctx, x, z)` |

**Modified files**

- Core: `config.js`, `terrain.js`, `districts.js`, `generator.js`, `roads.js`, `blocks.js`, `analysis.js`, `city.js`, `buildings.js`, `park.js`, `rail.js`, `props.js`, `intent.js`, `metrics.js`, `export.js`
- Render and game: `render/ground.js`, `render/world.js`, `render/labels.js` (CSS class only), `main.js`, `game/explore.js`, `index.html`
- Tools: `tools/headless.mjs`, `tools/sweep.mjs`, `tools/shot.mjs`
- Docs: `docs/DESIGN.md`

---

## 4. Config additions (`src/core/config.js`)

```js
export const ROAD = { ...existing, OLD: 11 };
export const ROAD_LEVELS = { ...existing, 5: { name: '옛길', width: 6, sidewalk: 1.5, type: ROAD.OLD } };

export const PLAN = {
  ring:     { rMin: 205, rMax: 270, rAdd: 12, gateJunction: 36, sigmaDeg: 25, devScale: 40, devW: 2.5, devCap: 6,
              maxGapDeg: 70, snapRange: 110, windowDeg: 20, legMaxRatio: 2.0, width: 18, sidewalk: 4, median: 4,
              plazaR: 70, innerSoftR: 150, innerSoftMul: 3, riverCost: 5, seaMargin: 20 },
  radials:  { max: 7, mergeDeg: 22, mouthGapDeg: 34, mouthR: 64, maxRiverCross: 50, spurMedian: 3 },
  stations: { max: 7, hardMax: 8, minArc: 170, gateArcPick: 150, gateArcOk: [110, 260], nearGatePenaltyArc: 90 },
  squares:  { stationFront: 20, stationBack: 11, gate: 10, gateOffset: 11, core: 12 },
  roads:    { dsepMain: 150, maxMainLines: 30, spineSeedStep: 120, coreSeedMinSpine: 90 },
  tensor:   { spineW: 1.8, spineL: 45, oldW: 1.3, oldL: 22, oldMinR: 120 },
  seam:     { band: 64, coreT: 0.6, pSeam: 0.85, pLeak: 0.35, floorBlend: 0.5, colorBlend: 0.2 },
  height:   { ratioCap: 2.5, pairR: 25, iters: 3, axisCapMax: 3, axisMinFloors: 2 },
  streets:  { max: 10, perStation: 2, minLen: 90, maxMainFrac: 0.5, jaccard: 0.5, walkMax: 520, maskR: 10 },
  thresholds: { persist: 15, merge: 60, perPair: 2, max: 24, compress: 35, release: [10, 45], skipNearSquare: 40 },
  promenade: { river: 8 },
  od:       { scale: 12, genericW: 0.5, maxDist: 1400 },
  placement:{ dormTown: 0.8, supply: 0.3, oldPort: 0.6, oldPortSlack: 150, harborMouthSlack: 120, harborMouthDiv: 200 },
};

export const SHORT = { center: '중앙', commercial: '상점가', residential: '주거구', trad_academy: '루미에르', tech_academy: '아르케',
  free_academy: '레드라인', arts_academy: '스텔라', harbor: '청해항', ruins: '구시가지', park: '미라이 공원' };

export const RELATION_KINDS = {
  commute:     { name: '통학',   color: '#5b6cff', purpose: 'school' },
  afterschool: { name: '방과후', color: '#ff5fa2', purpose: 'shop' },
  supply:      { name: '물류',   color: '#2f7fbf', purpose: 'market' },
  heritage:    { name: '옛길',   color: '#a0784a', purpose: 'leisure' },
  leisure:     { name: '산책',   color: '#3f9a4a', purpose: 'leisure' },
  rivalry:     { name: '국경',   color: '#e0413b', purpose: 'through' },
  civic:       { name: '대로',   color: '#8890a0', purpose: 'leisure' },
};
const ACADEMIES = ['trad_academy', 'tech_academy', 'free_academy', 'arts_academy'];
export const RELATION_RULES = [
  { from: 'residential', to: ACADEMIES, kind: 'commute', pick: 2, w: 3 },
  { from: ACADEMIES, to: ['commercial'], kind: 'afterschool', pick: 1, w: 2 },
  { from: 'harbor', to: ['commercial', 'center'], kind: 'supply', pick: 1, w: 1.5 },
  { from: 'ruins', to: ['harbor'], kind: 'heritage', pick: 1, w: 1 },
  { from: 'park', to: ['arts_academy', 'residential', 'trad_academy'], kind: 'leisure', pick: 2, w: 1 },
  // RIVALS → rivalry (w 0.8); every radial → civic(center, dest district) (w 1);
  // Kruskal over adjacent pairs (border > 80 cells at stride 2) adds civic edges until the graph is connected. Cap 24 edges.
];
export const RELATION_STORY = {
  commute: '{A} 학생들이 매일 {B}로 등교', afterschool: '{A} 방과후 → {B}', supply: '{A}의 물자가 {B}로',
  heritage: '{A}는 {B}의 옛 포구에서 시작', leisure: '{A} 사람들의 산책 → {B}', rivalry: '{A} vs {B} — 국경', civic: '{B} → 스파이어 대로',
};

export const STREET_CHAR = {   // buildTo = front setback range (m); grain = frontage range (m)
  ring:      { buildTo: [2, 3.5], faceVar: 1, trees: 'double', lamp: 'twin' },
  radial:    { buildTo: [1.5, 3], faceVar: 1, trees: 'row', lamp: 'twin' },
  shotengai: { buildTo: [0, 0.4], faceVar: 1, awning: 'continuous', grain: [7, 11], banner: true, arch: true, covered: 80 },
  gakuen:    { buildTo: [0.3, 1.2], faceVar: 1, awning: 'continuous', grain: [8, 13], banner: true, arch: true, sakura: 10, poster: true },
  market:    { buildTo: [0, 0.5], faceVar: 1, awning: 'continuous', grain: [8, 12], banner: true, arch: true },
  promenade: { buildTo: [3, 5], awning: 'cafe', sakura: 10, bench: 24 },
  old:       { buildTo: [0, 0.6], grain: [6, 10], depth: [12, 18], lantern: 18 },
};
export const SCHOOL_ROAD_NAMES = { trad_academy: '루미에르 언덕길', tech_academy: '아르케 테크로드', free_academy: '레드라인 골목길', arts_academy: '스텔라 오선지 거리' };
export const PURPOSE_COLORS = { commute: '#20a8a0', school: '#5b6cff', shop: '#ff8a3d', leisure: '#3f9a4a', market: '#2f7fbf' };
export const SPECIES = { trad_academy: '#f7a8c8', tech_academy: '#e8c547', arts_academy: '#b48fd8' };   // free_academy: bike racks, no tree
export const ACADEMY_LAMBDA = { trad_academy: 130, tech_academy: 150, free_academy: 190, arts_academy: 140 };
```

**`RULES` additions** (each with a Korean `name` and `desc`):

| Rule id | Korean name |
|---|---|
| `macro.plan` | 도시 골격 계획 |
| `macro.ring` | 학원 환상대로 |
| `macro.radial` | 방사 대로 · 축선 종결 |
| `macro.oldroad` | 옛길(연대기) |
| `macro.relation` | 구역 관계 그래프 |
| `meso.station` | 역세권 · 역전 광장 |
| `meso.street` | 이름 있는 거리 |
| `meso.seam` | 이음매(경계 띠) |
| `meso.threshold` | 문턱(구역 진입) |
| `meso.heritage` | 옛길 필지 |
| `meso.promenade` | 수변 산책로 |
| `meso.axis` | 축선 종결 · 조망 보호 |
| `micro.banner` | 거리 배너 |
| `micro.territory` | 학원 세력권 |
| `intent.chain` | 구역 간 열쇠 사슬 |

Existing rules whose descriptions change:
- `meso.skyline`: becomes "스파이어 + 역세권 봉우리 높이장".
- `intent.flow`: becomes "관계 OD(통학·방과후·물류·산책) + 거점 쌍 경로".

**`buildings.js` tables.** Add these alongside `PROGRAMS` and `ZONING`. They are data only and reuse the existing massing, sign and awning grammar. Exactly 8 new building programs and 1 special:

```js
stationery:  { label: '문구점',   color: '#f2b134', floors: [1, 2], set: [[0.3,1],[0.5,1],[1,2]], awning: true, sign: 'band', roof: 'res', poi: 'shop' },
cram:        { label: '입시학원', color: '#6c8ebf', floors: [3, 5], set: [[0.5,1.5],[0.5,1],[1,2]], sign: 'tall', roof: 'com' },
izakaya:     { label: '이자카야', color: '#b5523b', floors: [1, 2], set: [[0.3,1],[0.5,1],[1,2]], awning: true, sign: 'small', roof: 'res', poi: 'shop', lantern: true },
bakery:      { label: '빵집',     color: '#e8b07a', floors: [1, 2], set: [[1,2],[0.5,1],[1,2]], awning: true, sign: 'small', roof: 'res', poi: 'shop', terrace: true },
boarding:    { label: '하숙집',   color: '#d8c3a5', floors: [2, 3], set: [[1.5,3],[1,2],[2,3]], roof: 'house' },
sento:       { label: '목욕탕',   color: '#9ec9d9', floors: [1, 2], set: [[1,2],[1,2],[1,2]], sign: 'band', roof: 'flat', poi: 'shop', chimney: 18, unique: 1 },
old_shop:    { label: '노포',     color: '#a8835a', floors: [1, 2], set: [[0,0.6],[0.3,0.8],[1,2]], awning: true, awningColor: '#3b4a6b', sign: 'small', roof: 'house', poi: 'shop', lantern: true },
live_house:  { label: '라이브하우스', color: '#7a3fa0', floors: [2, 3], set: [[0.5,1],[0.5,1],[1,2]], sign: 'tall', roof: 'com', poi: 'anchor', unique: 1 },
threshold_plaza: { label: '문턱 쉼터', color: '#d9cfbd', floors: [0,0], set: [[0,0],[0,0],[0,0]], special: 'threshold_plaza', poi: 'micro' },
```

These also need `NAMES` entries in `city.js`, for example:
- 이자카야: '이자카야 등불', '선술집 갈매기'
- 목욕탕: '목욕탕 유노하나'
- 노포: '노포 시오야', '100년 화과자'

`decorate()` gets three new cases:
- `prog.lantern`: a red glow sphere (0.6 m) beside the door at y 2.2.
- `prog.chimney`: a cylinder 1.2 × `chimney` at the back corner.
- `prog.awningColor`: overrides the accent colour.

`SEAMS`, `STREET_ZONING`, `HERITAGE`, `EKIMAE`, `TOD` and `PURPOSE_MULT` are listed in §8 and §7.

---

## 5. Data model

**Cause schema.** One schema replaces the separate `b.rel`, `b.cause` and `edge` fields from the proposals. `why` strings stay as they are for compatibility.

```js
cause = [{ k: 'district'|'station'|'street'|'seam'|'threshold'|'axis'|'heritage'|'flow'|'influence'|'relation', t: '<Korean clause>', rel?: 'R3' }]   // ≤ 3 relational clauses
building.cause, building.rel (primary relation id) ; entity.rel?, entity.cause? ; poi.cause?, poi.rel?
```

```js
ctx.riverMouths = [{x,z}]                                   // terrain.js
ctx.district2  : Grid Uint8 1m   // 2nd-nearest district (warped Voronoi)
ctx.seamMargin : Uint8Array 1m   // min(255, round(bd2 - bd1)) metres
ctx.history = { mouth, origin:{x,z,name:'청해 어촌'}, ford:{x,z,name:'옛 나루터'}, market:{x,z,name:'옛 나루 시장'},
                sacred:{x,z,name:'신목 언덕'}|null, parkEntry:{x,z}|null,
                oldRoads:[{id:'R1',name:'강변 옛길',pts:[{x,z,bridge?}]},{id:'R2',name:'참배길',pts}], len } | null
ctx.distOld2   : Float32Array(512²)   // 2m EDT to old-road centrelines; distOldAt(ctx,x,z) bilinear
ctx.plan = {
  gates: [...],                                 // ctx.gates (moved from roads.js)
  ring: { pts:[{x,z,bridge?}], closed, coverageDeg, len, Rr, lineId },
  radials: [{ id, pts, angle, dests:[destId], trunkEnd:{x,z,ringIdx}, kind:'trunk'|'branch', rel, lineId }],
  dests: [{ id, kind:'gate'|'core'|'parkGate', district, x, z, w }],
  parkGates: [{x,z}],
  stations: [{ id, x, z, ringIdx, tx, tz, n:[nx,nz], serves:[districtId], academy?, name, short, weight, front:sqId, back:sqId, spur? }],
  squares: [{ id, kind:'stationFront'|'stationBack'|'gate'|'core', x, z, r, district, station?, name, rels:[] }],
  relations: { edges:[{ id, kind, a, b, w, name, story, realizedBy:[] }], adj },
  streets:   [{ id, kind, name, short, purpose, accent, pts:[{x,z}], len, from, to, rel, station? }],
  thresholds:[{ id, x, z, tx, tz, from, to, line, street?, rel, release?:lotId }],
  od: [{ a, b, w, purpose, rel }], nodes: [{ x, z, w, name, kind, ref }],
  walk: { station, gate, core: Float32Array(256²) },
  distSpine: Float32Array(1M), spineHash: PointHash(16) of {x,z,t}, distPark4: Float32Array(256²),
};
ctx.roadLine   : Int16Array(1M)  // line id that wrote each road/sidewalk cell (-1 none)
ctx.streetMask : Uint8Array(1M)  // street id + 1 on road cells within 10 m of a named street path
ctx.roadFlowP  : { commute, school, shop, leisure, market } Grid 4m   ; ctx.flowP same after fullAnalysis
ctx.academyInfl: { trad_academy: Float32Array(128²), ... , dom: Uint8Array(128²), domV: Float32Array(128²) }
district: + baseName, relName (also written to d.name), short, persona, story
roadLine: + spine?:'ring'|'radial', median?, old?, name?, rel?
lot: + seamT, other (district2 id), seamKey?, frontLine, frontType, street (-1|id), spine?, heritage, square?, walk:{station,gate,core},
       fP:{commute,school,shop,leisure,market}, era (0 heritage | 2 planned | 3 station redevelopment), compress?, release?, axis?, source
```

---

## 6. Phase A: skeleton (the biggest visible change)

### A1. Relation-aware district placement

**`terrain.js genTerrain`.** After `computeWaterFields`, compute `ctx.riverMouths`:
1. Walk `ctx.river` from each end inward.
2. Stop at the first point whose cell is `TERRAIN.RIVER`.
3. If `distSea < 14` there, it is a mouth. Otherwise that end has no mouth.

Both mouths were found on all 15 prototype seeds.

**`districts.js genDistricts` → `score(assign)`.** When `ctx.params.plan` is set, replace the existing residential term with the following. These are the prototyped weights.

```js
const P = PLAN.placement, H0 = pos.harbor[0];
for (const a of acad) sc -= (P.dormTown * Math.min(...pos.residential.map((r) => dist(a, r)))) / 400;      // dorm town per academy
sc -= (P.supply * Math.min(...pos.commercial.map((c) => dist(H0, c)))) / 400;                             // supply
sc -= (P.oldPort * Math.max(0, dist(pos.ruins[0], H0) - P.oldPortSlack)) / 350;                            // old town by old port
if (ctx.riverMouths.length) sc -= Math.max(0, Math.min(...ctx.riverMouths.map((m) => dist(H0, m))) - P.harborMouthSlack) / P.harborMouthDiv;
```

Keep the existing rival and free↔ruins terms. Afterwards, call `ctx.log('macro.relation', ...)` with the satisfied reasons, for example `항만은 하구 옆 131m · 주거구는 학원 사이(최대 283m) · 구시가지는 항만 옆 253m`.

**Voronoi loop.** Track `best2` and `bd2` alongside `best` and `bd`, and write `ctx.district2` and `ctx.seamMargin`. Expected cost is about 5% of a 727 ms stage.

### A2. History: one old road (`history.js genHistory`)

1. **Mouth.** `mouth*` is the river mouth nearest the harbour seed. If there is none, set `ctx.history = null` and return.
2. **Origin O.** Scan at a 2 m step within 70 m of `mouth*`. Among land `CITY` cells with `10 ≤ distSea ≤ 30` and `distRiver ≤ 25`, take the one nearest the harbour seed. If there is none, set `history = null`.
3. **Ford F.** F is the `ctx.river` point that minimises `hypot(x, z)` subject to `r ≥ 95`.
   - `Fb` is the land cell within 40 m of F with `8 ≤ distRiver ≤ 16` nearest to F.
   - Fb may be on the far bank. In that case R1 crosses the river: a stone-bridge ford.
4. **Sacred S.** S is the park-zone cell, at a 4 m step, that maximises `distBorder + 0.3·distRiver` with `distBorder ≥ 30`. Without a park, `S = null`.
5. **Cost grid.** Use an 8 m grid (128²), with a noise fork `ctx.rng.fork('history')`:

   ```
   oldCost: 0 if sea || distSea<6 || r<75 ;  c=1 ; river/lake c=28 ; campus/park c*=3.5
            c -= 0.45·exp(-((distRiver-12)/8)²)   // river terrace: old road hugs the bank, promenade fills the gap
            c -= 0.30·exp(-((distSea-30)/12)²)
            c += 0.35·(fbm(x/90,z/90,3)+1)/2 ;  max(0.25, c)
   ```

6. **R1 '강변 옛길'** is `dijkstra(128,128,cost,[cell(O)],∞,true,8)` followed by `tracePath(cell(Fb))`.
7. **Market M** is the R1 point at fraction 0.25-0.85 that minimises the distance to S.
8. **R2 '참배길'** is the Dijkstra path from M to S, clipped at the first `ZONE.PARK` cell, which becomes `parkEntry`. Skip R2 if it is shorter than 30 m.
9. **Smoothing.** Convert cell centres to world coordinates, apply Chaikin smoothing 3 times, and resample at 2.5 m. Set `bridge = T ≠ LAND`. Drop points inside a non-`CITY` zone.
10. **Distance field.** Compute `ctx.distOld2` as a 2 m EDT of cells within 1.2 m of the samples (about 15 ms). Export `distOldAt(ctx, x, z)`, which samples it bilinearly.
11. **Log** `macro.oldroad`, for example `강변 옛길 438m · 참배길 225m · 옛 나루 r137`.

### A3. Plan (`structure.js genPlan`)

**1. `computeGates(ctx)`.** Move the gate ray-march out of `genRoads` verbatim. It fills `ctx.gates` and `d.gate` (`dir` points toward the centre).

**2. `planCost4`** is a Float32 256² grid sampled at the cell centre `(j*4+2)*N + i*4+2`:

| Cell | Cost |
|---|---|
| Sea, `distSea < 20`, `ZONE.CAMPUS`, `ZONE.PARK`, `r < 70` | 0 (blocked) |
| Water (not land) | 5 |
| `70 ≤ r < 150` | 3 |
| Anything else | 1 |

**3. `traceRing`.**

- **Gate junction.** For each gate, `J_g = gate + 36·dir`.
- **Ring radius.** `Rr = clamp(median(|gate|) + 12, 205, 270)`. This gives 238 on lumina.
- **Target radius.** `r*(θ) = Rr + Σ_g exp(-½(Δθ/25°)²)·(|J_g| − Rr)`.
- **Ring cost.** `cost = planCost4 · (1 + min(6, 2.5·((r − r*)/40)²))`.
- **Waypoints.**
  - Every `J_g` is a waypoint, sorted by θ.
  - For each angular gap larger than 70°, add `ceil(gap/70°) − 1` mid-points at `r*(θ)`. Snap each one along its ray within ±110 m to the nearest passable cell, preferring the inner side on ties.
- **Legs.** For consecutive waypoints a→b:
  - Block every cell whose angle lies outside `[θa − 20°, θb + 20°]`. This window is required: without it, 5 of 15 seeds detoured around the island.
  - Run `dijkstra` from a and `tracePath` to b.
  - Reject the leg if `L/euclid > 2.0`.
  - On failure, drop the next non-gate waypoint and retry once.
  - If a gate leg still fails, set `ring.closed = false` (an open arc).
- **Geometry.** Concatenate the legs, apply Douglas–Peucker (ε 4 m), then Chaikin smoothing 3 times, and resample at 3 m. If a smoothed sample lands on a blocked cell, use the DP polyline for that segment. Set `bridge` where T ≠ LAND.
- **Closure.** `coverageDeg` is the sum of |Δθ|. The ring counts as closed when every leg succeeded and `330 ≤ coverageDeg ≤ 450`.

**4. `planParkGates`.**
1. Take park-zone boundary cells (a park cell with a non-park 4-neighbour) at a 4 m step.
2. Pick the one nearest the centre.
3. Pick the one nearest each non-campus core within 400 m.
4. Add `history.parkEntry`.
5. Merge candidates closer than 70 m and keep at most 4.

**5. `traceRadials`.**

*Destinations.* Core points are the district seed, snapped to the nearest `CITY` land cell with `distSea ≥ 20` and `distRiver ≥ 15`.

| Destination | Weight |
|---|---|
| Gate junction `J_g` | 2.5 |
| Commercial core | 3 |
| Residential core | 2 |
| Harbour core | 1.5 |
| Ruins core | 1 |
| Park gate | 1 |

*Clustering.*
1. Merge destinations whose angles are within 22°. The cluster angle is weight-averaged, except that a cluster containing a gate uses `atan2(J_g)` exactly.
2. Sort clusters by summed weight.
3. Keep at most 7, requiring a mouth gap of at least 34° at r = 64.

*Trunks.*
- A trunk runs from `(64·cosθ, 64·sinθ)` to the ring.
- For a gate cluster, the end is `J_g`. Gate, `J_g`, campus core and origin are collinear, so the trunk is the spire → gate → quad → tower ceremonial axis.
- For other clusters, the end is the ring sample nearest θ.
- The trunk is straight if every 3 m sample has `planCost4 > 0` and there is at most one water crossing of 50 m or less. Otherwise it is a 4 m Dijkstra path on `planCost4` without the ring penalty, smoothed with Chaikin twice.

*Branches.*
- Each non-gate destination in a kept cluster gets a branch from the trunk's ring point to the destination, ending at its square edge. This is a 4 m Dijkstra path.
- A destination in a dropped cluster gets a branch from the nearest ring point only if it is within 220 m of the ring. Otherwise it is served by streamlines.
- Every radial and branch gets `rel`, the civic edge (center, district).

**6. Spine fields.**
1. Rasterise the ring, trunk and branch centrelines into a 1 m mask.
2. Compute `plan.distSpine` as an EDT of that mask (about 55 ms).
3. Build `plan.spineHash = PointHash(16)` of the 3 m samples, each with tangent angle `t`.
4. Compute `plan.distPark4` as a 4 m EDT of park cells.

**7. `pickStations`.**

*Candidates.*
- (a) Each trunk∩ring point of a non-gate cluster. Score = cluster weight.
- (b) For each gate, the ring points at ±150 m of arc from `J_g`. Score = 1.5, plus 0.5 if the point's district is commercial, residential or center.

*Selection.*
1. Subtract 2 from any candidate within 90 m of arc of any `J_g`.
2. Pick greedily by score, with arc spacing of at least 170 m, up to 7 stations.
3. **Gate coverage pass.** Every academy must have a station 110-260 m of arc from its `J_g`. If one does not, force its best (b) candidate, up to a hard limit of 8 stations. If that exceeds 8, drop the lowest-scored non-gate station.

*Station attributes.*
- `n` is the ring side, inner or outer, with the larger summed weight of served destinations.
- `serves` lists the districts of the destinations in its cluster, plus the academy for (b) candidates.

*Fallback.* If the ring is open, use the same candidates restricted to arc points that exist. If there are fewer than 3 stations, `plan.stations` keeps whatever exists and rail uses the legacy loop.

*Central station.* 센트럴역 sits at r = 74 on the highest-weight trunk (`spur: true`).

**8. `stampSquares`.** Write `ZONE.PLAZA` only on land `CITY` cells. The squares are:

| Square | Centre | Radius |
|---|---|---|
| Station front | `station + n·35` | 20 m |
| Station back | `station − n·26` | 11 m |
| Gate plaza | `gate + 11·dir` | 10 m |
| Core square | each core point | 12 m |

`rasterizeRoads` already paints `PLAZA` zones. Streamlines stop at them with `stop = 'zone'`, and `extractBlocks` excludes them.

**9. `buildRelations`.**
1. Apply `RELATION_RULES`, picking nearest targets by seed distance.
2. Add rivalry edges and civic edges per radial.
3. Compute adjacency by scanning `ctx.district` at stride 2 and counting border cells.
4. Run Kruskal over adjacent pairs with more than 80 border cells, adding civic edges until the graph is connected.
5. Cap at 24 edges.
6. Assign ids `R0…`. The name is `${short(A)}↔${short(B)} ${kind.name}` and the story comes from `RELATION_STORY`.

**10. `assignPersonas`.** Store `d.baseName = d.name` and set `d.name = d.relName`. Every later `why` string then carries the relational name. The first matching predicate wins.

| District | Predicate | Name |
|---|---|---|
| residential | an academy core is within 380 m | `${A.short} 기숙사촌` (story: 아침마다 통학로가 붐빈다) |
| residential | `dist(origin) < 320` | 청해 옛마을 |
| residential | otherwise | `${dir} 주택가` |
| commercial | the one with the lowest mean `distOld` over its cells, if that mean is under 120 | 옛나루 상점가 |
| commercial | a station within 200 m of the core | `${station.short} 역전 상점가` |
| commercial | otherwise | `아케이드 상점가 ${dir}부` |
| harbor | origin within 150 m of a harbour cell | 청해 어항 |
| harbor | otherwise | 청해 컨테이너항 |
| ruins | `dist(origin) < 330` | 옛마을 재개발 중단구역 |
| ruins | adjacent to residential or the free academy | 1기 기숙사 단지 폐허 |
| ruins | otherwise | 구시가지 재개발구역 |

- Academies, center and park keep their names.
- Duplicate names get a 방위 suffix, as `districts.js` does now.
- `short` is the relational stem; for residential it is `SHORT` + 기숙사촌.

**11. Station names.**
- Gate-coverage (b) stations are named `${A.short}학원앞역`.
- Other stations are `${district at station}.short + 역`.
- Duplicates get 동/서/남/북.
- Square names are `${station.name} 광장` / `${A.short} 정문 앞` / `${d.short} 광장`.

**12. Logs.** `macro.ring`, for example `환상대로 1509m · 폐합 360° · 정문 4곳 통과`. `macro.radial`, for example `방사 대로 6 · 종결: 정문 4, 코어 2`. `meso.station`.

### A4. Roads (`roads.js`)

**`buildTensorField(ctx)`.** If `ctx.plan` is set, add two terms after the river term and before the blur:

```js
const dS = ctx.plan.distSpine[cid];
const ws = PLAN.tensor.spineW * Math.exp(-dS / PLAN.tensor.spineL);
if (ws > 0.02) { const s = nearestSpineSample(ctx.plan.spineHash, x, z, dS + 6); if (s) { a += ws * Math.cos(2 * s.t); b += ws * Math.sin(2 * s.t); } }
if (ctx.history && Math.hypot(x, z) > PLAN.tensor.oldMinR) {
  const dO = distOldAt(ctx, x, z), wo = PLAN.tensor.oldW * Math.exp(-dO / PLAN.tensor.oldL);
  if (wo > 0.02) { const g = gradOld(ctx, x, z); if (Math.hypot(g[0], g[1]) > 0.1) { const t = Math.atan2(g[1], g[0]) + Math.PI / 2; a += wo * Math.cos(2 * t); b += wo * Math.sin(2 * t); } }
}
```

The spine query radius is the EDT distance plus 6 m, which keeps it cheap.

**`genRoads(ctx)` order when `ctx.plan` is set.**

1. Build the tensor field.
2. **Old roads.** For each, call `addLine(o.pts, -1, 5, {old: true, name, rel: heritageEdge, ends: [{stop:'joined'}, {stop:'joined'}]})`. Build `oldHash = PointHash(8)` from their points.
3. **Spines.** Add them with a helper `addSpine(pts, meta)` that calls `addLine(pts, -1, 1, meta)`, then adds each point only to `hashes[fam]`, where `fam` is the family whose `fieldDir` has the larger |dot| with the spine tangent.
   - **Ring:** `{spine: 'ring', width: 18, sidewalk: 4, median: 4, ends: loop}`.
   - **Trunks:** `{spine: 'radial', rel, approach: gate district id or undefined, ends: [{stop: 'zone'}, {stop: 'joined'}]}`.
   - **Branches:** level 1 with `{spine: 'radial', branch: true, rel, dest}`.
   - The spur trunk also gets `median: 3`.
4. **Level-1 seeds.**
   - Every 120 m along each spine, add `{x, z, family: 1 − fam(p)}` (the perpendicular family).
   - Add both families at a district seed only if `distSpine > 90`.
   - Delete the 7 spokes and the `±150` seeds.
   - Call `runLevel(1, seeds1, () => PLAN.roads.dsepMain, PLAN.roads.maxMainLines)`.
5. **Approach avenue.** Only for gates whose trunk failed. Keep the legacy code and `macro.approach`.
6. Coast road: unchanged.
7. **Level 2.** In `integrate()`, add a T-junction test for `level === 2 && oldHash`:

   ```js
   if (len > 6 && oldHash.query(nx, nzz, 4, (p) => (p.x - nx) ** 2 + (p.z - nzz) ** 2 < 16)) { pts.push({ x: nx, z: nzz }); stop = 'joined'; break; }
   ```

   Level-1 lines ignore `oldHash`, so avenues cut across the old road and leave triangular blocks.
8. `connectEnds`: unchanged. It skips `loop` and `joined` ends.

**`rasterizeRoads(ctx)`.**
- Use `PRI = {1:6, 4:5, 5:4, 2:3, 3:2}` and `canBridge = level ∈ {1, 4, 5}`.
- Fill `ctx.roadLine = new Int16Array(N*N).fill(-1)` on every call, and set it on every carriageway and sidewalk write.
- **Median.** If `line.median` and `d2 ≤ (median/2)²`, set `R = SIDEWALK`, `pri = p0` and `roadLine = id`.
- **Riverside promenade.** After the plaza loop, if `ctx.plan` is set: any cell with `T == LAND`, `Z == CITY`, `R == NONE` and `distRiver ≤ 8` becomes `R = PARK_PATH`. This has to live here because `genAlleys` re-rasterises with `R.fill(0)`.
- If `ctx.plan.streets` exists, call `stampStreetMask(ctx)`.

**`computeNodes`.** Level 5 maps to node level 2 (`l.level === 5 ? 2 : …`).

**Other `ROAD.OLD` plumbing.**
- `analysis.js ROAD_COST[OLD] = 1.0`
- `blocks.js RANK[OLD] = 3`, `RANK[PARK_PATH] = 3`
- `ground.js ROAD_RGB[OLD] = '#c8b597'`, plus a 0.4 m `#9c8a6e` kerb stroke along level-5 lines
- `tools/headless.mjs roadCol[OLD] = [200, 181, 151]`
- `metrics.roadLen[5]`
- `intent.js` lines 539 and 636: add `ROAD.OLD` to the carriageway exclusion lists

### A5. Rail on the ring (`rail.js genRail`)

If `ctx.plan?.ring?.closed && ctx.plan.stations.length ≥ 3`, use the ring rail:

- **Track.** The path is `ring.pts` as `[x, z]`, closed. Reuse the existing track-box and pillar loop. Pillars land in the median, which is `SIDEWALK`, so the existing road-type check allows them.
- **Spur.** Follows the spur trunk's points; the median is 3 m.
- **Stations.** Use `plan.stations`; `rot` is the ring tangent. For ring stations:
  - platform: `w 40, d 8`, centred at offset `6·n` (2-10 m from the centreline)
  - canopy: `d 12` at offset `4·n`
  - front ramp: `w 24, d 3` at offset `(hw + sw/2)·n = 11·n`, on the front sidewalk, landing toward the front square
  - second ramp toward `−n` if a back square exists
  - `s.foot` is the front square centre
  - the station POI and hub are unchanged and use the plan name
  - `s.obb` and `s.ramp` as before
- **Back square stalls.** In each back square, place 2 `gaado` stalls with `makeBuilding({prog: 'gaado', w: 6, d: 4, floors: 1, rule: 'meso.station', name: '고가 밑 포장마차'})`. This keeps the 고가 밑 texture without demolishing anything.
- The clearance pass stays unchanged, for residual overlaps.

**Otherwise:** run the legacy loop, but take the station list from `plan.stations` when `ctx.plan` is set instead of the `want` list and `rng.int`.

### A6. Squares (`city.js genSquares`, buildings stage)

Use the `squares` fork, rule `meso.station`. Extract `addBusStop(ctx, x, z, rot, rng, did, why)` from `props.js` (5 entities) and reuse it.

**Station front** (about 38 entities):
- paving: circle decal `#e3ddd0` plus a ring decal
- bus terminal: 3 bus stops along the square edge that faces the road
- taxi bay: rect decal `#8f949a` with `stripes`
- 만남의 시계: cylinder 0.3 × 4 `#5b6070`, plus 2 glow clock faces (cylinder 1.2 × 0.15, `rx π/2`, `#fff6d8`)
- 6 `bikerack` boxes, 1.8 × 0.8 × 0.5 `#5a5f6b`
- 4 planters (box 2 × 0.6 × 2 `#9a8a72`, plus `addTree`)
- anchor POI `${station} 광장`, tier 1, with `cause [{k: 'station', t: '역 = Node · 환상선 정차'}]`

**Station back:** the 2 gaado stalls from A5, plus a circle decal.

**Gate plaza:**
- `addBusStop` named `${A.short} 앞`
- 2 sakura trees
- crosswalk decal toward the gate
- 4 bike racks

**Core square:**
- circle decal
- statue (cylinder 1.2 × 3 on cylinder 6 × 0.6)
- 4 benches
- POI `${d.short} 광장`, tier 2

### A7. Park (`park.js genPark`)

If `ctx.history?.sacred` is set:
- Use it as the world-tree hill `best`, instead of the random search.
- Set the lake angle to `la = atan2(S − core) + π`.
- Prepend `history.parkEntry` as entrance `nodes[0]`.
- Add the fixed edge `[0, hillNodeIdx]` before the MST.
- Place a vermilion torii (2 cylinders `#d6332a` 0.35 × 4, plus a beam box 4.2 × 0.4 × 0.5 at y 3.8) on the entry. Rule `macro.oldroad`, name '참배길 도리이'.
- Change the hill's `why` to '옛 어촌 사람들이 참배하던 신목 — 참배길의 끝'.

---

## 7. Phase B: daily-life flows, named streets, height

### B1. Tagged OD flow (`structure.js buildOD`, `analysis.js computeFlowOD`)

**`buildOD(ctx)`** fills `plan.nodes` and sets `ctx.hubs = plan.nodes`. Campus, rail, park and props stages still append to `ctx.hubs` later.

| Nodes | Weight |
|---|---|
| 6 centre plaza points | 1.4 |
| Station front squares | 1.5 |
| Station back squares | 0.8 |
| Gate plazas | 2.0 |
| Core squares: commercial / residential / harbour / ruins | 2.0 / 1.6 / 1.0 / 0.6 |
| Park gates | 0.9 |
| Origin (if any) | 0.6 |

`plan.od` holds the relation-derived pairs. For each edge, add `{a, b, w, purpose, rel: edge.id}` per the leg table below.

- `station:X` is the station whose front square has the smallest straight-line distance to X's core. The `walk` fields do not exist yet when `buildOD` runs.
- `station:B` for an academy is its gate-coverage station.

| Kind | Legs (from → to, weight, purpose) |
|---|---|
| commute (res A → acad B) | `core:A → station:A`, 3, commute · `station:B → gate:B`, 2.5, school · `core:A → gate:B`, 1.5, school |
| afterschool (acad A → com B) | `gate:A → core:B`, 2, shop |
| supply | `core:A → core:B`, 0.8, market |
| heritage | `core:A → origin`, 0.6, leisure |
| leisure (park A, X) | `core:X or gate:X → parkGate(A) nearest`, 1, leisure |
| rivalry | `gate:A → gate:B`, 0.4, through |
| civic | `core:B or gate:B → plaza`, 0.8, leisure |

Extra legs:
- every station front → each commercial core within 600 m straight-line distance: weight 1, purpose shop
- every residential core → nearest commercial core: weight 1.5, purpose shop

**`computeFlowOD(cost, n, S, nodes, pairs, opts)`.**
1. Snap the nodes.
2. `pairsAll = pairs.map(p => ({...p, w: p.w·PLAN.od.scale}))`, plus generic all-pairs among all nodes with `w = 0.5·wa·wb` and purpose `'through'`.
3. Group by origin and run one Dijkstra per distinct origin (`maxDist` ∞ for generic pairs).
4. `tracePath` to each destination; add `acc.total += w` and, for relation pairs, `acc[purpose] += w_unscaled`.
5. Apply the existing 1-cell blur and log-normalisation to the total, and to each purpose by its own maximum.

The number of origins equals the number of nodes, the same as today, so the cost is neutral. `scale 12` makes the relation flows about 50% of the total, so daily-life routes visibly become the main flow.

**`roadFlow(ctx)`.** If `plan.od` exists, call `computeFlowOD`, and set `ctx.roadFlow` (the total, for compatibility) and `ctx.roadFlowP`.

**`fullAnalysis`.** Do the same on `cost4`. The first `plan.nodes.length` hubs map one-to-one to the plan nodes. Store `ctx.flowP`. The `isFlow2` top-16% rule is unchanged. Log `intent.flow` with `관계 OD n쌍 + 거점 m개`.

**`accessFields(ctx)`.**
1. Build a 4 m road cost with `walkCost4(ctx)`, the same as `roadFlow`'s cost, with OLD at 1.0.
2. Run three multi-source Dijkstras (`maxDist 1200`) from snapped square cells:
   - `station`: front and back squares
   - `gate`: gate plazas
   - `core`: core squares
3. For each lot, set `lot.walk` by sampling at the front point (front face centre + normal·4).

**Lot purpose features.** `lot.fP[p]` is the maximum of `roadFlowP[p]` at 4, 8 and 12 m in front of the lot, the same pattern as today's `flow`.

### B2. Named streets (`streets.js planStreets`, end of the roads stage)

**Walk cost.** 4 m cells, minimum over the same 5 subsamples `roadFlow` uses. Each road cell costs by the level of `roadLine` (so a sidewalk inherits its line's level) and by type:

| Road | Cost |
|---|---|
| MINOR | 1.0 |
| ALLEY | 1.1 |
| PLAZA, PARK_PATH, OLD | 1.0 |
| BRIDGE | 1.2 |
| COAST | 1.5 |
| MAIN (level-1 line or its sidewalk) | 1.8 |

Shopping and school streets therefore run one block in from the boulevard.

**Candidates**, processed in this weight order:

| Kind | From → to | Weight | Purpose |
|---|---|---|---|
| gakuen | academy's station front square → its gate plaza | 3 | school |
| shotengai | station front → nearest commercial core square (walk ≤ 520) | 2 | shop |
| shotengai | station front → nearest residential core (walk ≤ 520) | 2 | commute |
| market | harbour core → nearest commercial core (walk ≤ 700) | 1.5 | market |
| promenade | residential core or station front → nearest park gate (walk ≤ 520) | 1 | leisure |

**Filters and limits.**
- Path length at least 90 m.
- At most 50% of the path's cells on MAIN.
- Cell-Jaccard overlap with an accepted street at most 0.5; otherwise keep the one with the higher weight.
- At most 10 streets in total, at most 2 per station, at most 1 gakuen per academy.
- If a gakuen path is shorter than 90 m, retry from the academy's second-nearest station.

**Street record.**
- `pts` = cell centres smoothed with Chaikin twice.
- `rel` = the matching relation edge:
  - gakuen: commute(*, A)
  - shotengai: afterschool or civic
  - market: supply
  - promenade: leisure
  If none exists, create one with `derived: true`.
- Push the street onto `edge.realizedBy`.

**Names and accents.**

| Kind | Name | Accent |
|---|---|---|
| gakuen | `SCHOOL_ROAD_NAMES[A.type]` | the academy's accent |
| shotengai | `${station.short} 상점가` | `#ff8a3d` |
| market | 어시장 거리 | `#2f7fbf` |
| promenade | 벚꽃 산책길 (`' 2'` on duplicates) | `#3f9a4a` |

**`stampStreetMask(ctx)`.** Each street, in weight order, writes `id + 1` to road cells (`R ≠ NONE`) within 10 m of its points. It runs inside `rasterizeRoads`, so it survives `genAlleys`.

Streets add no new road geometry. They name existing paths and give them a character.

### B3. Consuming `STREET_CHAR` (`blocks.js`, `buildings.js`, `props.js`)

1. **`genLots`: grain.**
   - Before `splitRow` computes `ws`, `rowChar(b, u0, u1, v0, v1, front)` probes 3 points (t = 0.25, 0.5, 0.75) on the row's front edge, each outward at 3, 5 and 8 m.
   - If at least 2 hit `streetMask`, use `f = STREET_CHAR[kind].grain`.
   - Else if at least 2 hit `ROAD.OLD`, use `f = STREET_CHAR.old.grain`.
   - **Heritage depth.** Before choosing `dep`, probe the block's 4 side midpoints outward to 8 m. If any hits OLD, use `dep = STREET_CHAR.old.depth` and set `b.heritage = true`.
2. **`classifyFrontage`.**
   - `probe()` also returns the first road cell's `roadLine` id and `R` type.
   - Set `lot.frontLine` to the most common line id on the front side, `lot.frontType` to its type, `lot.street = streetMask − 1`, `lot.spine = roadLines[frontLine].spine` and `lot.heritage = frontType === OLD`.
   - `lot.square` is the plan square whose disc contains the probe cell, when the type is PLAZA.
3. **`footprintFromLot(lot, prog, rng, buildTo)`.** If `k === front && buildTo`, use `range = buildTo`.
   - `buildTo` comes from `STREET_CHAR`, keyed by the street kind, then the spine kind, then `old` for heritage lots.
   - Compressed lots use `[0, 0.4]`.
4. **Zoning mix.** If `lot.street ≥ 0`, mix weights as `w = 0.3·w_d/Σw_d + 0.7·w_s/Σw_s` over the union with `STREET_ZONING[kind]`:

   ```js
   gakuen:    [['bookstore',3],['stationery',3],['cafe',3],['cram', l => l.area>220?2:0],['convenience', l => l.corner?4:0.5],['bakery',1.5],['karaoke',1]],
   shotengai: [['shophouse',5],['cafe',2],['convenience', l => l.corner?3:0.3],['bookstore',1],['bakery',1],['arcade_game', l => l.fP.shop>0.5&&l.area>200?3:0]],
   market:    [['izakaya',4],['fishmarket', l => l.sea<80?1:0],['shophouse',2]],
   promenade: [['cafe',4],['apartment', l => l.area>300?2:0],['house',1]],
   ```

5. **Street wall** (zoning pass 2).
   - For lots with `lot.street ≥ 0` or `lot.spine`, group them by `${block}:${frontLine}`.
   - `target = median(floors)`; clamp each lot to `[target − 1, target + 1]`.
   - Corner lots get +1.
   - Exempt landmark, anchor-POI and station-building lots.
6. **`decorate()`.** It receives `spec.street = {kind, accent}`:
   - With `awning: 'continuous'` and a front face longer than 3 m, add the awning even if the program has none, coloured with the street accent, plus a band sign.
   - For gakuen, add 1-2 glow club posters (box 0.05 × 0.8 × 0.6) on the front face, `micro.poster`.
7. **`props.js`.**
   - **Lamp banners.** After placing a lamp:
     - `streetMask` at the lamp → street accent;
     - else if `domV ≥ 0.3` → faction accent;
     - else none.
     The banner is a box 0.06 × 1.5 × 0.55 at y 3.4, offset 0.35 toward the road. Kind `banner`, rule `micro.banner` (or `micro.territory`), with `rel`. Cap 420 in total.
   - **Arches.** At both ends of gakuen, shotengai and market streets. `hw` is from `roadLine` at the end point.
     - posts: box 0.6 × 6.5 × 0.6 at ±(hw + 1.2) along the normal
     - beam: box (2hw + 3) × 0.7 × 0.7 at y 6.5
     - sign: glow box min(10, 2hw) × 1.2 × 0.25 at y 7.25, street accent
     - kinds `arch_post` / `arch_beam` / `arch_sign`, rule `meso.street`, name = street name, `rel`
   - **Covered roof** on the first 80 m of a shotengai from its station end. Reuse the `arcaderoof` boxes (w = segment, d = road width + 2, y 7.5, glass) and a lantern every third box.
   - **Sakura** every 10 m on gakuen and promenade streets, on both `SIDEWALK` sides at offset `hw + sw·0.62` where `free()` allows. The generic tree loop skips cells already in those streets' masks.
   - **School-zone paint.** The last 60 m of each gakuen before the gate: rect decals `#e7a198`, the width of the carriageway, at 4 m pitch.

### B4. Stations-first height and TOD (`buildings.js`, `city.js genCityBuildingsPlan`)

**`heightFactor(ctx, lot)`** replaces `skylineFactor` on the plan path:

```js
const WS = { commercial: 1, center: 1, residential: 0.8, ruins: 0.7, harbor: 0.5, park: 0.4 }; // academies' outer band 0.6
let hf = 1 + 0.85 * Math.exp(-(r * r) / (2 * 230 * 230))
       + 0.8 * ws * Math.exp(-((lot.walk.station / 130) ** 2))
       + 0.15 * Math.exp(-distSpine / 25)
       - 0.25 * Math.exp(-distRiver / 35) - 0.2 * Math.exp(-distPark / 40);
hf = clamp(hf, 0.7, 2.6); if (ruins) hf = 1 + 0.6 * (hf - 1); if (harbor) hf = 1 + 0.4 * (hf - 1); if (lot.heritage) hf = Math.min(hf, 1);
```

**TOD and purpose multipliers.** These are applied on top of the base `ZONING` weight, which is unchanged.

```js
export const TOD = {
  residential: { apartment: w => 1 + 2.5*Math.exp(-w/150), house: w => 0.35 + 0.65*(1 - Math.exp(-w/150)), convenience: w => 1 + 2*Math.exp(-w/90) },
  commercial:  { arcade_game: w => 1 + 3*Math.exp(-w/100), karaoke: w => 1 + 3*Math.exp(-w/100), mall: w => 1 + 3*Math.exp(-w/100) },
  ruins:       { construction: w => 1 + 4*Math.exp(-w/120), ruin: w => 0.4 + 0.6*(1 - Math.exp(-w/120)) },   // redevelopment front spreads from the station
  harbor:      { office: w => 1 + 3*Math.exp(-w/100) },
};
export const PURPOSE_MULT = { bookstore: f => 1+2*f.school, stationery: f => 1+2*f.school, convenience: f => (1+1.5*f.commute)*(1+f.school),
  shophouse: f => 1+2*f.shop, arcade_game: f => 1+2*f.shop, karaoke: f => 1+1.5*f.shop, cafe: f => 1+1.5*f.leisure, izakaya: f => 1+2*f.market };
export const EKIMAE = [['mall',3],['convenience',2],['cafe',2],['karaoke',1.5],['arcade_game',1.5],['office', l => l.area>300?3:0.5]];
export const HERITAGE = [['old_shop',5],['house',3],['izakaya', l => l.dtype==='commercial'||l.dtype==='harbor'?1.5:0.3],['courtyard', l => l.interior?4:0]];
```

**Uniqueness and overrides.**
- `uniqueCount` keys: `${square.id}:mall`, `${square.id}:convenience`, `${gate.id}:convenience`.
- **Station building.** The largest EKIMAE lot per front square becomes the station building:
  - `office` (podium massing) if area > 400, else `mall`
  - name `${station} 역 빌딩`
  - floors at least `round(7·hf)`
  - the existing 'com' billboard already faces the lot front, which is the square
- **Gate plaza.** The lot facing a gate plaza is forced to `convenience`, named '학원 앞 편의점'.

### B5. Axial termination (`city.js chooseLandmarkSites`)

**Axes** are the end segments of radial branches and named streets that end inside the district: the end point plus the unit direction of the last 20 m.

**Score.** For each candidate lot:

```
score = vista · e^(−d/260) · (1 + 3·axis)
axis  = max over axes of e^(−perp/20) · [along > 0] · e^(−along/80)
```

`along` and `perp` are measured from the axis end along its direction. If `axis > 0.3`, set `lot.axis = {x0, z0, ux, uz}`:
- `x0, z0` is the start of the straight run, found by walking back while the turn stays under 8° (at most 300 m).
- `ux, uz` is the direction.

**`buildLandmarkLot`** adds the cause `{k: 'axis', t: '${street|radial} 축선 종결 · 직선 ${L}m'}`.

**View protection** (zoning pass 2, rule `meso.axis`):
1. The eye is `(x0, 1.6, z0)` and the target is `(lot, 0.8·H_lm)`, with H_lm = 50 (ferris), 49 (clock tower) or 86 (unfinished).
2. Consider decided non-landmark, non-campus lots whose OBB intersects the eye→target segment (half-width 4 m) more than 30 m from the eye.
3. Cap such a lot to `max(2, floor((rayY(t) − 2)/3.2))` floors.
4. Cap at most 3 lots per axis, nearest the landmark first. If more would need a cap, skip that axis and log it.
5. Add the cause `조망 보호: ${lmName} 축선 ${f0}F→${f1}F`.

---

## 8. Phase C: seams, transitions, territory, history dressing

### C1. Three-pass zoning (`city.js genCityBuildingsPlan`)

Keep the legacy `genCityBuildings` untouched. `seamOf(ctx, lot)` (in `seams.js`) returns:
- `t = smoothstep(0, 64, seamMargin)`
- `other = district2`
- `key = seamKey(typeA, typeB)`: exact sorted pair, then the academy wildcard (`*_academy` → `academy`), then `park|*`, else null
- `def = SEAMS[key]`

Lots with `t ≥ 0.6` are cores.

**Pass 1a: decide cores.** In lot order:
1. Landmark lots: mark them and skip.
2. Pick a table by priority:
   1. `release` → `threshold_plaza`
   2. gate square → `convenience`
   3. station-front square → `EKIMAE`
   4. heritage → `HERITAGE`
   5. otherwise `ZONING[d.type]` × `TOD` × `PURPOSE_MULT`, mixed with `STREET_ZONING` when the lot is on a named street
3. Compressed lots: `shophouse` ×2.
4. Floors: `round(rng.int(P.floors) · hf)`, clamped to `1.9·P.floors[1]`; compressed lots +1.
5. Record `lot.source`.

**Pass 1b: decide band lots** (`t < 0.6`, no override). Use the same base table, then:
- If `def` exists and `rng.chance(0.85·(1−t)^1.5)`: table = `def.table`, `source = 'seam'`, `lot.seamKey = key`.
- Else if no `def` and `rng.chance(0.35·(1−t))`: table = `ZONING[other.type]`, `source = 'leak'`.

Before pass 1b, compute `meanF[d]` from the pass-1a lots.

**Pass 2: adjust.**
1. **Band floors:** `round(lerp(f, meanF[other], 0.5(1−t)))`.
2. **Street wall** (B3.5).
3. **Height relaxation.** Build `PointHash(16)` of decided lots. For pairs in different districts with centres within 25 m, if `fa > 2.5·fb` then `fa = floor(2.5·fb)`. Run 3 iterations. Skip landmark, anchor and station-building lots.
4. **Axis caps** (B5).
5. **Era.**
   - 0 if heritage or within 120 m of the origin.
   - 3 if `walk.station < 110` and the type is commercial, center, residential or ruins.
   - Otherwise 2.

**Pass 3: build.** Order: footprint (with `buildTo`), then `makeBuilding`.

**Colour.** Seam and leak lots use `jitterColor(lerpColor(P.color, other.accent, 0.2·(1−t)))`.

**Heritage lots** (`era 0`) on house or `old_shop`:
- `roofStyle: 'gable'`
- `roofColor: jitterColor('#4d5866', rng, 0.08)`
- floors ≤ 3

**`makeBuilding` spec additions:**
- `street`
- `ctxTags: {era, street: kind, seam: key, seamW: 0.5(1−t), other, faction: dom, heritage}`
- `cause`
- `rel`

**Causes** (up to 3, in this priority):
1. square / station: `${station} 도보 ${walk}m (역세권 ×${hfTerm})`
2. street: `${street.name} 변 · ${purposeKo} 흐름 ${pct}%`
3. seam: `${A.short}↔${B.short} 이음매 「${def.name}」 (경계 ${round(dist)}m)`
4. heritage: `강변 옛길 변 노포 — 1기 항구 마을`
5. threshold: `문턱: ${A.short} → ${B.short} (압축 35m)`

`b.rel` is the first clause's `rel`.

**`SEAMS` table** (`buildings.js`; each entry also has `why: '{A}와 {B} 사이 — {name}'`):

```js
'academy|commercial':   { name:'학원가', table:[['bookstore',3],['stationery',3],['cafe',3],['cram',2],['convenience',l=>l.corner?4:0.3],['karaoke',1]] },
'arts_academy|commercial': { name:'공연 거리', table:[['live_house',2],['cafe',3],['bookstore',1],['shophouse',2]] },
'academy|residential':  { name:'하숙촌', table:[['boarding',4],['house',2],['dorm',l=>l.area>350?2:0],['laundromat',1],['convenience',l=>l.corner?2:0],['bakery',1]] },
'tech_academy|residential': { name:'테크 하숙촌', table:[['boarding',3],['convenience',2],['shophouse',1]] },
'academy|center':       { name:'학원 행정가', table:[['gov',l=>l.area>500?2:0],['office',2],['bookstore',2],['cafe',2]] },
'academy|harbor':       { name:'산학 창고', table:[['lab',3],['warehouse',3],['server',1]] },
'academy|ruins':        { name:'폐교 언저리', table:[['ruin',3],['ruin_shop',2],['house',1],['shed',1]] },
'free_academy|ruins':   { name:'무법지대', table:[['ruin_shop',3],['shed',2],['ruin',2]] },
'academy|park':         { name:'숲 가장자리', table:[['cafe',3],['house',2],['pocketpark',1]] },
'commercial|residential':{ name:'생활 상점가', table:[['shophouse',4],['laundromat',1.5],['convenience',l=>l.corner?3:0.3],['bakery',1.5],['sento',0.6]] },
'center|commercial':    { name:'번화가', table:[['office',3],['karaoke',2],['arcade_game',1.5],['cafe',1.5]] },
'center|residential':   { name:'도심 주거', table:[['apartment',4],['convenience',l=>l.corner?2:0],['cafe',1]] },
'commercial|harbor':    { name:'어시장 골목', table:[['izakaya',4],['fishmarket',l=>l.sea<80?1:0],['shophouse',2],['warehouse',1]] },
'harbor|residential':   { name:'항구 마을', table:[['house',3],['izakaya',2],['shed',1],['sento',0.6]] },
'harbor|ruins':         { name:'옛 포구', table:[['old_shop',2],['izakaya',2],['ruin',2],['sento',1]] },
'residential|ruins':    { name:'옛 동네', table:[['house',3],['ruin',2],['old_shop',1],['laundromat',0.5]] },
'commercial|ruins':     { name:'셔터 상점가', table:[['ruin_shop',3],['shophouse',2],['construction',l=>l.area>250?1:0]] },
'park|*':               { name:'공원 앞', table:[['cafe',3],['house',2],['pocketpark',1.5]], frontSetback: 2 },
```

Seam rule id: `meso.seam`. The `why` names both districts and t.

### C2. Ground seam blend (`seams.js districtColorField`, `render/ground.js paintGround`, `tools/headless.mjs`)

1. Build a 256² RGB image of `ctx.districts[D].color` sampled at 4 m cell centres. Sea cells take the colour of their nearest land.
2. Box-blur it with radius 4 cells, 2 passes.
3. In `paintGround`, city land cells that are not road, campus or park use the bilinear sample instead of `dcol[D[id]]`.
4. Headless `writePng` does the same, so topdown screenshots show the blend.

Roads, campus walls and the river remain the only hard edges.

### C3. Thresholds (`streets.js markThresholds`; `city.js genThresholds`)

**Detection** (end of the lots stage).
- **Polylines checked:** in priority order, named streets (`street.pts`), radial trunks and branches, the ring, and old roads.
- **Walk:** sample at 3 m and read D.
- **What counts as a crossing:** D changes A → B and B persists for at least 15 m (5 samples). The crossing point is the first B sample.
- **Skip** a crossing if any of these hold:
  - it is within 40 m of a square centre;
  - `r < 90`;
  - A or B is 255.
- **Merge and cap:**
  - merge crossings within 60 m;
  - at most 2 per unordered pair;
  - at most 24 in total.
- **Record:** `{x, z, tx, tz, from, to, line, street, rel}`. `rel` is the A–B relation edge if one exists, otherwise the line's or street's `rel`.

**Lot flags.**
- **Release.** The lot in B whose `frontLine` is the threshold's line, or whose `street` matches, with `along ∈ [10, 45]`, not interior and area 120-700, nearest the crossing. Set `lot.release = id`.
- **Compress.** Lots in A on the same line with `along ∈ [−35, 0]` get `lot.compress = id`.

**Set pieces** (buildings stage, rule `meso.threshold`). The `why` is `여기서부터 ${B.name} · ${seamName || rel.name}`; each gets a tier-2 POI `${B.short} 입구`. The marker depends on B's type:

| B | Marker | Entities |
|---|---|---|
| commercial | Neon arch (same as street arch) with sign `어서오세요 · ${B.name}` | 4 |
| residential | Small torii (2 cylinders `#d6332a` 0.3 × 3.2 + beam) + map board (box 0.15 × 1.4 × 1.8 + glow panel) | 5 |
| academy band | Two flagpoles (cylinder 0.15 × 8) + accent flags (box 0.05 × 1.2 × 2 at y 6.4) + glow sign | 5 |
| harbor | Anchor monument: cylinder base 2.2 × 0.8 + shaft box + crossbar box + sphere, plus sign | 5 |
| ruins | '재개발 예정지' billboard (box 6 × 3 × 0.3 `#e0b84a` on 2 posts) + 3 cones `#ff7a2a` | 6 |
| park | Hedge gate (2 boxes 1.2 × 1.8 × 3 `#5f9a4f` + beam) | 3 |
| center | Pylon pair (box 0.8 × 7) + glow strips | 4 |

**Release plaza.** The `threshold_plaza` special lot, built through `buildSpecialLot`:
- decal `#d9cfbd`
- 4 benches in a ring of radius 3.5 m
- map board
- 1 tree
- POI tier 2 `${B.short} 쉼터`

**Explore** (`game/explore.js`, around line 256).
- If the player comes within 8 m of a threshold different from the last one, call `app.districtBanner(B, {via: streetName, from: A})`. The banner shows `{via} · {A.short} → {B.name}` and B's story.
- Elsewhere, a district change must persist for 25 m of travel before the banner fires. Track a candidate id and the distance accumulated since the change. This removes the flicker along meandering borders.

### C4. Riverside promenade

The raster is stamped in A4. Additional changes:
- **`props.js` river sakura loop.** Accept `R[id] === ROAD.PARK_PATH`; it currently rejects any non-sidewalk road.
- Benches every 24 m, facing the water.
- **Zoning.** Lots whose `frontType` is PARK_PATH: cafe ×3, apartment ×1.5.
- Rule `meso.promenade`.

### C5. Academy territory (`influence.js computeAcademyInfluence`, start of `genProps`)

**Field.** For each academy:
- Walk cost on an 8 m grid:
  - road: 1.0
  - other land: 1.6
  - campus: 1.3
  - water: 0, except bridge cells, which cost 1.0 (so the field stops at the river except at bridges)
- Sources:
  - gate: weight 1.0
  - `campus.backGate`: 0.8
  - `campus.hole`: 0.6
  - campus boundary samples every 16 m: 0.55
- Run `dijkstra(128, 128, c8, src, 4λ, false, 8, srcDist)` with `srcDist = −λ·ln(w)`, then `F = exp(−dist/λ)`. λ comes from `ACADEMY_LAMBDA`.
- `dom = argmax`; `domV = max − 0.5·second`.

**Consumers.**
- **Banners** (B3.7).
- **Tree species.** In `props.js`'s tree loop, set the faction to the gakuen street's academy if the tree is on one, else `dom` where `domV ≥ 0.35`. The canopy colour becomes `SPECIES[faction]` via a new `addTree(..., canopy)` parameter. For the free academy, skip the tree and place a `bikerack` box every second slot instead (at most 40).
- **Graffiti.** `p = 0.75·inflAt('free_academy', b.x, b.z)`, replacing `0.75·exp(−dd/170)`. The `why` becomes `레드라인 세력권 ${pct}%`.
- **Discipline posters.** On buildings with `dom = trad` and `domV ≥ 0.3`: `p = 0.6·infl.trad`. A white box 0.05 × 0.9 × 0.7 `#f4f1ea` on a non-front face, name '풍기위원회 공고', rule `micro.territory`, at most 80.
- **Rival front line** (`intent.js placeBorders`).
  1. For each RIVALS pair, run a 4 m `walkCost4` Dijkstra from A's gate plaza and trace the path to B's gate plaza.
  2. The checkpoint goes at the first point where `inflA − inflB` changes sign. It is oriented along the path tangent and keeps the existing barricade and booth geometry, with the `why` `두 학원 세력이 맞서는 지점 (영향 ${a} : ${b})`.
  3. Then add up to 2 legacy raster crossings, but only on spines or named streets.

### C6. Old-road dressing (`props.js`)

- **Lamps.** For level-5 lines, replace lamps with a stone lantern every 18 m, alternating sides at `hw + sw/2`. Four entities, kind `stonelantern`, rule `macro.oldroad`:
  - base box 0.8 × 0.4 × 0.8 `#8f8a80`
  - shaft box 0.3 × 1.0 × 0.3
  - light box 0.55 × 0.45 × 0.55, glow `#ffd9a0`
  - cap cone (4 sides) 0.9 × 0.4 `#7d7a72`
- **Pines.** Every 16 m on one side: cylinder trunk plus a 6-sided cone canopy `#3f6b4a`, size 2.8 × 4.5 (new helper `addPine`).
- **Willows.** Within 30 m of the river: a squashed sphere `#8fbf6a`.
- **Origin.** At O, 3 small boats on the bank (reuse park `boat` boxes) and a POI '청해 어촌 나루터', tier 2, rule `macro.oldroad`, `why` '섬에서 가장 오래된 동네 — 옛길의 시작'.

---

## 9. Phase D: legibility, UI, gameplay, metrics

### D1. Inspector cause chain (`main.js select`, `render/world.js`)

**Inspector.**
- **Building entities** (`e.ref ≥ 0`) render `ctx.buildings[e.ref].cause`. **POIs** render `p.cause`.
- The cause list appears as a numbered list under `<dt>왜 여기에?</dt>`, after `배치 근거`.
- **Relation block.** When there is a `rel`, add `관계: ${edge.name} — ${edge.story}` and a button `이 관계만 강조`.

**Highlighting.**
- `highlightRule(ctx, world, ruleOrPred)` accepts a function predicate.
- The relation predicate is:

  ```js
  e => (e.rel ?? (e.ref >= 0 ? ctx.buildings[e.ref].rel : undefined)) === id
  ```

- The banner text is `강조 중: 관계 ${edge.name}`.

### D2. Overlay, labels, panels

**Overlay.**
- `index.html` gets `<button data-overlay="relation">관계</button>` and a legend `lg-relation` listing the purpose colours, named street, old road, seam and threshold.
- `paintOverlay(ctx, 'relation')` at 2 m. Draw order, later wins:
  1. **Seam hatch:** city cells with `seamT < 0.6` and `(i + j) % 6 < 2`, in the seam colour, α 90.
  2. **Purpose flow:** walk cells where the `ctx.flow` total is at least 0.3, coloured `PURPOSE_COLORS[argmax flowP]`, with α = 60 + 140·flow.
  3. **Spines:** `#2b2f3a`, α 200.
  4. **Old road:** `#a0784a`, α 230.
  5. **Named streets:** in their accent, α 230.
  6. **Squares:** white, α 200.
  7. **Thresholds:** canvas `arc` rings, r 6 px, stroke `#e0413b`.

**Labels (`main.js updateLabels`, map mode).**
- Street names at each street's mid point: `cls 'street'`, `pri 2`, `maxDist 700`.
- Old-road names.
- Station-front square names: `pri 1.5`, `maxDist 500`.
- District labels already use `d.name`, which is now the relational name.
- Add CSS for `.lbl.street`: an italic pill with an accent border.

**Panels.**
- The district list shows `relName` and `story`.
- The metrics panel gets a group '유기성' with: 환상선 폐합, 역세권 상승비, 경계 높이차비, 경계 격자각, 경계 용도 JS, 통학로 수, 문턱 수.

**Export (`export.js`).**
- Entities gain `rel` and `cause`; POIs keep them.
- Add a top-level `plan` object containing `ring`, `radials`, `stations`, `squares`, `streets`, `relations`, `thresholds` and `oldRoads`.

### D3. Relational signposts (`intent.js placeSignposts`)

There are 3 plates. Spine junctions have `mainCount ≥ 2`, so those nodes are selected automatically.
1. The spire.
2. The nearest station: `${station} ${m}m`, with `m` sampled from `plan.walk.station`.
3. Either:
   - `→ ${street.name}`, if the node lies on a named street's mask; or
   - `→ ${district across nearest threshold}`.

### D4. Cross-district lock and key (`intent.js placeRelationChains`)

**When.** After `placeHiddenSecrets` and before `rewardDeadEnds`, using rng fork `chains`.

**Which relations.** At most 3 chains. Relation kinds are taken in priority order: supply, heritage, rivalry, commute, afterschool. Each relation needs a realisation polyline (a street, the old road, or a radial) that runs from district A to district B.

**Placement.**
- **Lock:** a courtyard lot in B that has a passage, within 200 m walk of the polyline's end inside B.
- **Key:** generalise `placeGateAt(..., opts = {keyDistrict, range: [120, 400], nearHash})`. The key goes in A:
  - within 25 m of the polyline;
  - `|hidden − 0.55| ≤ 0.3`;
  - not on the main flow.
- **Text:** the `why` is `열쇠는 ${A.name}의 ${street.name} 위 — ${rel.name}`. The entities get `rel`.

**Limits.**
- The existing courtyard treasure and the breadcrumbs apply unchanged.
- The total of `gates2` is capped at 7.
- Rule `intent.chain` (`intent.gate` stays for single-district gates).

### D5. Metrics (`metrics.js` → `m.cohesion`)

**Definitions.** "Live, non-campus buildings with `lot ≥ 0`" applies throughout.

| Metric | Definition | lumina now | Target |
|---|---|---|---|
| `ringClosed`, `ringCoverageDeg`, `ringLen` | from `plan.ring` | n/a | true; 330-450°; 1300-2000 m |
| `radials`, `radialsTerminated` | trunks; trunks ending at J_g or a square | 7 spokes ending nowhere | 4-7; terminated = radials |
| `stations` | ring stations (+ central) | 7 + 1 | 5-8 (+1) |
| `stationUplift` | mean floors within 80 m of ring stations ÷ city mean | 0.83 | ≥ 1.35 |
| `gateStationWalk` | per academy, walk from gate plaza to nearest station square (`plan.walk.station`) | max 229 | every value in [80, 260] |
| `gakuenCoverage` | academies with a gakuen street ≥ 90 m, ÷ academies | 0 | 1.0 |
| `namedStreets`, `namedStreetKm` | | 0 | 5-10; ≥ 1.0 km |
| `mainShare` | level-1 km ÷ km of levels 1-5 | 0.33 | 0.15-0.27 |
| `borderDhRatio` | mean \|Δh\| of building pairs < 30 m, across ÷ within district | 1.37 | ≤ 1.12 |
| `borderGridAngle` | mean block-rotation difference (mod 90°) for blocks < 70 m apart across a border | 20.9° | ≤ 14° |
| `borderProgramJS` | mean JS divergence of program mix of lots within 35 m of the border, per adjacent pair with ≥ 4 lots per side | 0.75 | 0.25-0.55 |
| `corePurity` | lots with `seamT ≥ 0.6` whose source ∈ {district, street, ekimae, heritage, gate, release} | n/a | ≥ 0.9 |
| `districtIdentityMin` | min over non-campus districts of the share of lots whose program is in their own `ZONING` table | n/a | ≥ 0.6 |
| `thresholds`, `releasePlazas` | | 0 | ≥ 8; ≥ 5 |
| `oldRoadKm`, `heritageFrontShare` | km of level 5; share of old-road-fronting lots with an era-0 program (old_shop, house gable, izakaya) | 0 | ≥ 0.3 km (when a river exists); ≥ 0.6 |
| `namedStreetPoiShare` | non-hidden tier ≤ 2 POIs within 12 m of a named street or old road, ÷ all such POIs | n/a | ≥ 0.30 |
| `relations`, `relationRealized` | edges; share of commute / afterschool / supply / heritage / leisure edges with a street, old road, spine or threshold | n/a | 10-24; ≥ 0.6 |
| `chains` | cross-district lock-and-key pairs | 0 | ≥ 2 when ≥ 2 eligible edges |
| `harborMouth`, `dormTownMax` | harbour seed → nearest river mouth; max over academies of distance to nearest residential seed | 131 / 593 | ≤ 230 / ≤ 480 |
| `drawBuckets` | distinct `${GROUP_OF[cat]}\|${shapeKey}\|${mat}` over live entities (mapping duplicated from `world.js`) | about 60 | ≤ 70 |

**Score.**
- `cohesion.score` is the mean of these normalised terms:
  - ring: 1 if closed, else 0.5
  - `min(1, stationUplift/1.35)`
  - `clamp((1.4 − borderDhRatio)/0.28)`
  - `clamp((21 − borderGridAngle)/7)`
  - JS band term: 1 inside [0.25, 0.55], falling off linearly to 0 at 0 and at 0.8
  - `gakuenCoverage`
  - `min(1, thresholds/8)`
- `m.scoreLegacy` is the old formula.
- `m.score = 0.85·scoreLegacy + 0.15·cohesion.score`.

**Implementation notes.**
- Use a `PointHash` for building pairs.
- Block pairs are O(n²) on about 270 blocks, which is fine.

---

## 10. Interface for the building-style track (the user's second complaint)

This track does **not** change how buildings look, except for heritage gable and tile roofs and the street awnings and banners. Per lot it exposes:

- **`makeBuilding(spec)`** receives `spec.ctxTags = {era, street, seam, seamW, other, faction, heritage}`:
  - `era`: 0 old village, 2 planned, 3 station redevelopment
  - `street`: gakuen | shotengai | market | promenade | ring | radial | old
- **`seams.js influence(ctx, x, z) → {a, b, w}`** is the cross-seam blend weight (0 to 0.5).
- **`influence.js domAt(ctx, x, z) → {faction, v}`**.

The style track should map era, faction and seam onto its style families. Examples:
- era 0 → kawara / machiya
- era 3 → glass / LED crown
- academy faction → its architectural motif bleeding along `domV`
- `seamW` → probability of borrowing the neighbour's vocabulary

Original, fantastical buildings then sit where history and influence explain them, instead of at random.

---

## 11. Budgets

| Item | Budget |
|---|---|
| history stage | ≤ 60 ms (prototype 7-33) |
| plan stage | ≤ 220 ms (ring prototype ≤ 116 + EDT 55 + radials/stations ≤ 40) |
| roads stage | ≤ 450 ms (now 350) |
| flow0 | ≤ 200 ms (now 139; same origin count) |
| buildings | ≤ 120 ms (now 40) |
| props | ≤ 90 ms (now 37) |
| analysis | ≤ 720 ms (now 689) |
| intent | ≤ 430 ms (now 367) |
| metrics | ≤ 60 ms |
| **Total, lumina, Node** | **≤ 4.3 s** (now 3.34-3.6 s; hard limit 6 s) |
| New entities | ≤ +2.8k → total ≤ 15,500. Breakdown: squares about 390, thresholds plus release plazas about 240, arches about 64, banners ≤ 420, lanterns and pines about 300, covered roof about 70, posters ≤ 140, sakura about 150, bike racks ≤ 80; rail pillars about −26 |
| Draw calls | ≤ 70 (no new geometries or materials; at most 2 new buckets, e.g. prop\|cone4\|std) |
| Memory | about +11 MB of typed arrays |
| Build | No external assets. No change to the single-file build (new files are plain ES modules reached through `generator.js`). |

---

## 12. Milestones

Each milestone ends with `node tools/headless.mjs lumina`, `node tools/sweep.mjs`, and screenshots in `review/after/`.

| Milestone | Scope | Ships with |
|---|---|---|
| M1 | A1-A7 (placement, old road, plan, roads, ring rail, squares, park) | `ringClosed`, radials, stations, `mainShare`, A/B exactness |
| M2 | B1-B5 (OD flow, named streets and `STREET_CHAR`, TOD height, axes) | `stationUplift`, `gakuenCoverage`, `gateStationWalk` |
| M3 | C1-C6 (seams, ground blend, thresholds, promenade, territory, old-road dressing) | border metrics, thresholds |
| M4 | D1-D5 (inspector, overlay, labels, signposts, chains, metrics panel) | DESIGN.md §9 '도시 골격과 관계' with the updated stage table and metric rows |

**Tool changes.**
- `tools/sweep.mjs`: 15 seeds, plus the new guards (§13).
- `tools/headless.mjs --plan`: draws the following on the topdown PNG:
  - ring (dark, 6 px)
  - rail track
  - radials (dark, 4 px)
  - named streets (accent, 4 px)
  - old road (sepia, 4 px)
  - squares (white discs)
  - stations (cyan, 8 px)
  - thresholds (red rings)
- `tools/shot.mjs`: supports `STEPS=overlay:relation`.

## 13. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| **Ring failure** (blocked by campuses, park or the bay) | Angular-window legs, a capped deviation penalty, and a drop-waypoint retry. If it is still open: an open arc plus the legacy rail through plan stations. The sweep allows at most 1 open ring in 15 seeds. |
| **Main seeds** | The streamline machinery stays. If lots fall below 760 or blocks change by more than 15%, lower `PLAN.roads.dsepMain` toward 130 or raise `maxMainLines` toward 45 until `mainShare` ≤ 0.27 and lots ≥ 760. |
| **Dartboard sameness** | The ring is pulled through irregular gate junctions and around the park and river. Radials are driven by destinations (4-7, unequal angles). The old road cuts diagonally. |
| **Mush across borders** | `corePurity` ≥ 0.9, `districtIdentityMin` ≥ 0.6, and a `borderProgramJS` lower bound of 0.25. |
| **Intent regressions from changed main flow** | All existing guards stay in the sweep. `scale 12` can be reduced to 8 if coverage or secrets regress. |
| **No river or no park** | No old road, promenade or 참배길. Every consumer checks `ctx.history` and `ctx.history.sacred`. |
| **Determinism** | Per-lot RNG plus fixed forks. Two runs must produce identical metrics JSON. |

## Acceptance (as specified by the track)
- A/B exactness: generateSync('lumina', null, {plan:false}).metrics has entities 12722, buildings 675 and lots 857, and all its other legacy metrics are byte-identical to the pre-change baseline.
- Determinism: two runs of `node tools/headless.mjs lumina` (plan on) print identical metrics JSON.
- Performance: on lumina in Node, timings.total ≤ 4300 ms, timings.history ≤ 60 ms and timings.plan ≤ 220 ms. No sweep seed exceeds 6000 ms.
- Budgets: on lumina with plan on, metrics.entities ≤ 15500, metrics.cohesion.drawBuckets ≤ 70, buildings ≥ 600, lots ≥ 760, and blocks within ±15% of 264.
- Skeleton: on lumina, metrics.cohesion.ringClosed === true, ringCoverageDeg is in [330, 450], ringLen is in [1300, 2000] m, radials is in [4, 7], and radialsTerminated === radials.
- Stations: lumina has between 5 and 8 ring stations plus 센트럴역. Every academy's gate-plaza-to-nearest-station walk (cohesion.gateStationWalk) is in [80, 260] m. The rail track follows the ring: every ring station lies within 3 m of ring.pts.
- TOD: metrics.cohesion.stationUplift ≥ 1.35 on lumina (baseline 0.83).
- Daily-life streets: cohesion.gakuenCoverage === 1 (4 of 4 academies have a named 통학로 of at least 90 m). namedStreets is in [5, 10], namedStreetKm ≥ 1.0, and namedStreetPoiShare ≥ 0.30.
- Road hierarchy: cohesion.mainShare is in [0.15, 0.27] on lumina (baseline 0.33).
- Seams: borderDhRatio ≤ 1.12 (baseline 1.37), borderGridAngle ≤ 14° (baseline 20.9°), borderProgramJS in [0.25, 0.55] (baseline 0.75), corePurity ≥ 0.9, and districtIdentityMin ≥ 0.6.
- Transitions: cohesion.thresholds ≥ 8 and releasePlazas ≥ 5. Every threshold POI has rule 'meso.threshold' and a non-empty why containing both district names.
- History: on lumina, oldRoadKm ≥ 0.3 and heritageFrontShare ≥ 0.6. There are at least 3 level-2 road lines whose end stop is 'joined' within 5 m of an old-road point (T-junctions). The park's world tree sits at ctx.history.sacred when a park exists.
- Relations: cohesion.relations is in [10, 24] and relationRealized ≥ 0.6. Every named street, radial, threshold and seam-zoned building has a rel that resolves to an existing ctx.plan.relations.edges id.
- Placement: on lumina, harborMouth ≤ 230 m and dormTownMax ≤ 480 m. Across the 15 sweep seeds, the median of the academy→nearest-residential distance is ≤ 320 m and the median of harbor→river-mouth is ≤ 180 m.
- Cause chains: at least 90% of live non-campus buildings have a non-empty cause array with at most 3 clauses. All station-front-square lots carry a 'station' clause, and all lots on named streets carry a 'street' clause.
- Relational names: no district label contains '북부 1' or '북부 2'-style compass suffixes unless a persona name collided. Lumina shows at least one of '기숙사촌', '역전 상점가', '옛나루 상점가', '청해 어항' or '재개발 중단구역'.
- Legacy guards still pass on lumina: poiCoverage == 1, poiGapMax ≤ 48, landmarkVisible ≥ 0.95, spireVisible ≥ 0.85, deadEndCoverage == 1, secrets ≥ 80, crumbCoverage ≥ 0.8, rooftopRoutes ≥ 4, and scoreLegacy ≥ 0.93.
- Sweep (`node tools/sweep.mjs`, 15 seeds × density 0.85/1/1.2): no exceptions; at most 1 seed with ringClosed false, and that seed logs the legacy-rail fallback; gakuenCoverage ≥ 0.75 on every seed; stations ≥ 4; mainShare ≤ 0.30; borderDhRatio ≤ 1.2; existing guards (coverage ≥ 0.95, landmark ≥ 0.85, deadEnd 1, secrets ≥ 40, buildings ≥ 400) still pass.
- Chains: cohesion.chains ≥ 2 on lumina. Each chain's key entity and lock gate lie in different districts, and the key is within 25 m of the realising street or old-road polyline.
- Screenshot (topdown): `node tools/headless.mjs lumina --png review/after/topdown.png --plan` shows a closed ring boulevard carrying the monorail and 4-7 radials. Each radial visibly ends at a gate plaza (on axis with its campus), a core square or a park gate. Named streets are drawn in accent colours from stations to gates and cores. A sepia old road runs from the river mouth by the harbor along the river. District colours fade across borders instead of meeting at hard Voronoi edges.
- Screenshots (browser): `node tools/shot.mjs <url> review/after` with STEPS=overlay:relation,close,view:trad_academy,view:commercial. map.png shows the monorail riding a tree-lined median boulevard and taller clusters around stations. overlay-relation.png shows purpose-coloured flows, seam hatching and threshold rings. A view along a gakuen street shows continuous accent awnings, lamp banners and an entrance arch, with the academy clock tower on axis at the end. The browser console has no errors.
- Inspector and explore smoke test (`node tools/test-explore.mjs` or manual): clicking a building on a named street lists '왜 여기에?' with at least 2 relational clauses, and '이 관계만 강조' greys everything except entities with that rel. Walking across a threshold in explore mode shows the '{street} · A → B' banner exactly once, with no repeated banners while walking along a meandering border.
