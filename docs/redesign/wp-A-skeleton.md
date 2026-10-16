# A-skeleton: 도시 골격 · Skeleton, relations, named streets, flow data (cohesion data layer)

Owns: ['src/core/config.js', 'src/core/terrain.js', 'src/core/districts.js', 'src/core/history.js', 'src/core/structure.js', 'src/core/streets.js', 'src/core/seams.js', 'src/core/roads.js', 'src/core/blocks.js', 'src/core/analysis.js', 'tools/check-plan.mjs']
Reads: ['docs/specs/cohesion.md', 'docs/specs/architecture.md', 'src/core/generator.js', 'src/core/grid.js', 'src/core/rng.js', 'src/core/city.js', 'src/core/rail.js', 'src/core/park.js', 'src/core/props.js', 'src/core/intent.js', 'src/core/metrics.js', 'tools/headless.mjs']

## Interface
PROVIDES — FUNCTIONS
The lead calls these exactly as in plan_md §2. Existing signatures do not change.

config.js — S1, do this first:
- ROAD.OLD = 11.
- ROAD_LEVELS[5] = { name: '옛길', width: 6, sidewalk: 1.5, type: ROAD.OLD }.
- Export these verbatim from C§4: PLAN, SHORT, ACADEMY_TYPES, RELATION_KINDS, RELATION_RULES, RELATION_STORY, STREET_CHAR, SCHOOL_ROAD_NAMES, PURPOSE_COLORS. ACADEMY_TYPES is the ACADEMIES list from C§4.
- export const FACTIONS = { trad_academy: { style: 'lumiere', L: 150, species: '#f7a8c8' }, tech_academy: { style: 'arche', L: 140, species: '#e8c547' }, free_academy: { style: 'redline', L: 180, species: null }, arts_academy: { style: 'stella', L: 150, species: '#b48fd8' } }.
- FACTIONS replaces SPECIES and ACADEMY_LAMBDA. Do NOT export those two.
- RULES gains the 31 ids listed in plan_md §4.5. Layer = the id prefix, except arch.* uses layer 'arch' and micro.canopy uses layer 'micro'.
- Update the meso.skyline and intent.flow descriptions.

terrain.js:
- genTerrain(ctx) adds ctx.riverMouths [{x,z}]. Always computed, no RNG.

districts.js:
- genDistricts(ctx), in plan mode: relation annealing terms, plus ctx.district2, ctx.seamMargin and ctx.districtColor.
- The district persona fields are written later, by genPlan.

history.js:
- genHistory(ctx) sets ctx.history (or null) and ctx.distOld2.
- distOldAt(ctx, x, z) returns metres, or Infinity when there is no history.

structure.js:
- genPlan(ctx) sets ctx.plan (or null). It also sets ctx.gates and d.gate, stamps the ZONE.PLAZA squares, writes the personas and fills part of plan.stats.
- computeGates(ctx).
- buildOD(ctx) sets plan.nodes, plan.od and ctx.hubs = plan.nodes.slice().
- accessFields(ctx) sets plan.walk {station, gate, core: Float32Array(256²)}, lot.walk, lot.fP, lot.era and plan.stats.gateStationWalk.
- Helpers: chaikin(pts, iters), resample(pts, step), douglasPeucker(pts, eps).

roads.js:
- buildTensorField, genRoads, rasterizeRoads, computeNodes and tensorAngle keep their signatures and gain a plan branch.
- ctx.roadLine is always written.

streets.js:
- planStreets(ctx) sets plan.streets and ctx.streetMask.
- stampStreetMask(ctx).
- markThresholds(ctx) sets plan.thresholds, lot.release and lot.compress, plus these plan.stats: mainShare, thresholds, relationRealized, oldRoadKm, tJunctions, namedStreets, namedStreetKm, gakuenCoverage.

blocks.js:
- extractBlocks, genAlleys, genLots, classifyFrontage and localToWorld keep their signatures and gain the new lot fields.

seams.js:
- annotateLots(ctx) sets lot.seamT, lot.other and lot.stationBuilding.
- districtColorField(ctx) sets ctx.districtColor.
- seamTAt(ctx, x, z).
- lerpColor(hexA, hexB, t) returns a hex string.

analysis.js:
- ROAD_COST is exported, and gains OLD = 1.0.
- roadFlow(ctx) sets ctx.roadFlow and ctx.roadCost4 (always), and ctx.roadFlowP (when plan.od exists).
- computeFlow is unchanged.
- computeFlowOD(cost, n, S, nodes, pairs, opts) returns {total: Float32Array, P: {purpose: Float32Array}}.
- fullAnalysis(ctx) additionally sets ctx.flowP.
- rasterSolids only adds the new shapes.

PROVIDES — DATA
- Every ctx, lot, district and line field attributed to A in plan_md §4.1–4.3 and §4.7, with exactly those names and types.
- plan.thresholds[i] = {id, x, z, tx, tz, from, to, line, street, rel, rival, kind, release?}, where kind is 'street', 'radial', 'ring' or 'old'.
- plan.streets[i] = the C§5 fields, plus weight, academy (district id; gakuen only) and station (id).
- plan.squares[i].kind is stationFront, stationBack, gate or core. Each square has .district, plus .station? and .gate? (the academy district id, for gate plazas).

CONSUMES
- Nothing from other packages. Legacy city.js buildHubs stays B's, and the lead calls it only when ctx.plan is null.

## Instructions
YOUR JOB
You own the cohesion data layer:
- terrain and district placement;
- the old road;
- the structure plan: ring, radials, stations, squares, relations, personas;
- roads, including spines and the old road;
- named streets;
- lot tagging and thresholds;
- the tagged OD flow and the access fields.
You create no buildings or props. Squares are only stamped as ZONE.PLAZA; B dresses them and C2 builds the threshold markers.

READ FIRST
- plan_md, all of it.
- docs/specs/cohesion.md §1–§8, §9 D5 (definitions of the stats you pre-compute) and §11–§13.
- In architecture.md, only A§11.6 (the rule texts you must copy).

STEP 1 — S1 SYNC POINT
Do this before anything else, within about 20 minutes. Add everything listed for config.js in the interface contract.

Korean desc strings for the 15 cohesion rules:
- macro.plan: '환상대로·방사대로·역·광장·옛길을 먼저 깔고, 용도·높이·거리 성격이 모두 이 골격을 읽는다'
- macro.ring: '네 학원 정문 앞을 꿰는 순환 대로 — 중앙분리대 위로 모노레일'
- macro.radial: '스파이어에서 출발해 정문·구역 코어·공원 입구에서 끝나는 목적지 대로'
- macro.oldroad: '하구 어촌에서 강 단구를 따라 옛 나루까지 — 섬에서 가장 오래된 길과 참배길'
- macro.relation: '통학·방과후·물류·옛길·산책·국경·대로 관계가 배치의 이유가 된다'
- meso.station: '역 앞 광장·버스 터미널·역 빌딩 — 역에 가까울수록 높고 붐빈다'
- meso.street: '통학로·상점가·어시장 거리·벚꽃 산책길 — 길마다 건축선·차양·배너·아치'
- meso.seam: '두 구역 사이 띠에는 둘을 잇는 용도(학원가·하숙촌·어시장 골목)가 선다'
- meso.threshold: '구역 진입점: 압축된 길 → 관문 → 쉼터 광장'
- meso.heritage: '옛길 변은 좁고 깊은 필지, 기와 박공의 노포'
- meso.promenade: '하천 8m 띠는 산책로 — 카페와 벤치가 강을 향한다'
- meso.axis: '직선 가로 끝에 랜드마크, 시선축을 가리는 건물은 낮춘다'
- micro.banner: '가로등 배너 색이 지금 걷는 거리와 세력을 알려준다'
- micro.territory: '정문에서 도로를 따라 번지는 학원 세력: 수종·공고문·최전선'
- intent.chain: '열쇠는 관계가 있는 이웃 구역의 거리 위에 — 관계를 따라 걷게 한다'

For the arch rule names and descs, copy A§11.6, skipping arch.ley.

Then run `node tools/headless.mjs lumina` and confirm the metrics are unchanged (12722 entities). Never rename these exports later: B, C1 and D import them.

STEP 2 — terrain.js
Implement C§6 A1 riverMouths. It is pure and always computed.

STEP 3 — districts.js (C§6 A1)
When ctx.params.plan is set:
- Replace the residential term of score() with the four prototyped terms. Keep the rival and free↔ruins terms.
- Leave the annealing loop and its rng calls unchanged, so the legacy result stays identical.
- Track best2/bd2 in the Voronoi loop. Do this only in plan mode; leave the legacy loop untouched otherwise.
- Write ctx.district2 (Grid of Uint8, 255 on sea) and ctx.seamMargin = min(255, round(bd2 − bd1)).
- At the end, call seams.districtColorField(ctx).
- Log macro.relation with the satisfied reasons.
Expected extra cost is about 5% of the stage.

STEP 4 — history.js (C§6 A2)
- Implement all 11 steps.
- Use dijkstra, tracePath and edt from grid.js.
- Use the fork ctx.rng.fork('history') for the noise.
- Set history = null when there is no mouth or no origin.

STEP 5 — structure.js genPlan (C§6 A3, items 1–12)
(a) computeGates is a verbatim copy of the ray-march in genRoads. Do not delete it from roads.js; the legacy path still uses it there.
(b) Implement planCost4, and traceRing with the angular window, devCap and the drop-waypoint retry. Both of those fixes are required.
(c) Trunk metadata for roads: a gate trunk carries approach = the gate district id.
(d) Stations: pickStations, the gate-coverage pass, and the central spur station.
(e) stampSquares writes ZONE.PLAZA on land CITY cells only. Each square record is {id, kind, x, z, r, district, station?, gate?, name, rels:[]}.
(f) buildRelations, assignPersonas, and the station and square names.
(g) Fill these plan.stats: ringClosed, ringCoverageDeg, ringLen, radials, radialsTerminated, stations, central, relations, harborMouth, dormTownMax, acadResDist.

If anything essential fails (for example, no gates), set ctx.plan = null and log it. Every consumer then takes its legacy branch.
Budget: plan stage ≤ 220 ms.

STEP 6 — roads.js (C§6 A4)
Tensor field:
- Add the spine term and the old-road term.

genRoads, in plan order:
- Old roads as level-5 lines.
- addSpine for the ring, trunks and branches, with family-hash insertion.
- Perpendicular level-1 seeds every 120 m.
- District-seed seeds only where distSpine > 90.
- No spokes and no ±150 seeds.
- runLevel(1, …, PLAN.roads.dsepMain, PLAN.roads.maxMainLines).
- Approach avenues only for gates whose trunk failed. Use d.gate from genPlan instead of recomputing.
- Coast road unchanged.
- Level-2 T-junctions into oldHash.
- connectEnds unchanged.

rasterizeRoads:
- PRI {1:6, 4:5, 5:4, 2:3, 3:2}. This has the same relative order as legacy, so the raster stays identical.
- canBridge when level ∈ {1, 4, 5}.
- Fill ctx.roadLine on EVERY call.
- Median cells → SIDEWALK.
- Riverside promenade → PARK_PATH (plan only).
- Call stampStreetMask when plan.streets exists.

computeNodes:
- Level 5 maps to node level 2.

Line metadata: spine, median, old, name, rel, approach, branch, dest. Width and sidewalk are overridden via meta (ring 18/4).

The legacy branch (ctx.plan null) must stay byte-identical. Keep the original code path intact and branch at the top.

STEP 7 — streets.js planStreets and stampStreetMask (C§7 B2)
- Records also get weight, academy (gakuen only) and station.
- Push street ids onto the relation edge's realizedBy. Create derived edges when they are missing.

STEP 8 — blocks.js (C§7 B3.1–B3.2)
- rowChar: grain from streetMask or OLD.
- Heritage depth: set b.heritage.
- classifyFrontage gains:
  - frontLine = the most common roadLine id among the front side's first road cells;
  - frontType, street, spine, heritage, square.
- RANK gains OLD = 3 and PARK_PATH = 3. These are inert in legacy, because those cells do not exist at the lots stage when plan is off.
- Keep the brng call order identical in the legacy path. The grain change only alters the range passed to brng.range.

STEP 9 — seams.js annotateLots(ctx)
- lot.seamT = smoothstep(0, PLAN.seam.band, seamMargin at the lot centre).
- lot.other = district2 at the lot centre.
- lot.stationBuilding (D6): for each stationFront square, the largest non-interior lot with lot.square === sq.id.
- districtColorField per C§8 C2: 256², sea cells take the nearest land colour, box blur radius 4, two passes.
- Helpers seamTAt and lerpColor.

STEP 10 — streets.js markThresholds
- Implement C§8 C3 detection and lot flags.
- Add the rival flag (the pair is in RIVALS) and kind.
- Finish plan.stats:
  - mainShare: level-1 km ÷ levels 1–5 km, measured after alleys;
  - thresholds, oldRoadKm;
  - tJunctions: level-2 lines ending 'joined' within 5 m of an old-road point;
  - namedStreets, namedStreetKm, gakuenCoverage;
  - relationRealized, using the C§9 D5 definition.

STEP 11 — OD flow, analysis.js and accessFields
structure.js buildOD:
- Use the C§7 B1 node and leg tables.

analysis.js:
- computeFlowOD: group pairs by origin and run one Dijkstra per distinct origin. Accumulate the total and each purpose separately. Then apply the existing blur and log-normalisation.
- roadFlow plan branch.
- Store ctx.roadCost4 in BOTH branches. It is the exact cost array roadFlow builds, with ROAD_COST[OLD] = 1.0.
- fullAnalysis plan branch: the first plan.nodes.length hubs map one-to-one to the plan nodes. Set ctx.flowP. Log intent.flow as '관계 OD n쌍 + 거점 m개'.
- rasterSolids: keep the legacy per-shape treatment. Add dome, onion, frus and cyl8 with rot 0, and pyr, hip, mansard, vault and arch with e.rot. arch is never solid.

accessFields (C§7 B1):
- Run three multi-source Dijkstras on roadCost4 (maxDist 1200), from the snapped square cells.
- lot.walk is sampled at the lot's front point.
- lot.fP comes from roadFlowP at 4, 8 and 12 m.
- lot.era follows the plan_md §4.2 rule.
- Set plan.walk and plan.stats.gateStationWalk.

STEP 12 — tools/check-plan.mjs
See self_test. Tune the PLAN knobs in your own config (dsepMain, maxMainLines, od.scale) only if a check-plan gate fails. Record the final values in your report.

PARITY RULES
- {plan:false, arch:0} must reproduce commit e1661f2 exactly.
- Every new behaviour sits behind ctx.params.plan (in districts.js) or ctx.plan / ctx.history (everywhere else).
- The new always-on fields (riverMouths, roadLine, roadCost4) must not change any existing value or any RNG call.

PERFORMANCE
- history ≤ 60 ms; plan ≤ 220; roads ≤ 450; lots ≤ 140.
- flow0, A's part (buildOD + roadFlow + accessFields) ≤ 220.
- analysis ≤ 850.
- Use typed arrays only. Reuse Dijkstra buffers where possible.

FINAL REPORT
- Every ctx, lot, line and district field you write: name, type, and when.
- The final PLAN knob values.
- Stage timings on lumina.
- The check-plan output.

## Self-test
Run `node tools/check-plan.mjs`. It uses the devpipe from plan_md §5. The legacy reference is tools/baseline/<seed>.json if that exists; otherwise extract commit e1661f2 into your scratchpad with git archive and run its generateSync.

1) Parity. devGenerate('lumina', {plan:false, arch:0}) must deep-equal the reference on every legacy metrics key, with 12722 live entities. Repeat for kivotos and academy-7.

2) Plan on, lumina, with arch:0 so it runs even while C1 and C2 are mid-work:
- ringClosed is true; coverage 330–450°; ringLen 1300–2000 m.
- radials 4–7, all terminated.
- 5–8 ring stations, plus the central station.
- every gateStationWalk value in [80, 260].
- gakuenCoverage = 1; namedStreets 5–10; namedStreetKm ≥ 1.0.
- mainShare 0.15–0.27.
- thresholds ≥ 8 and ≤ 24.
- relations 10–24; relationRealized ≥ 0.6.
- oldRoadKm ≥ 0.3; tJunctions ≥ 3.
- harborMouth ≤ 230; dormTownMax ≤ 480.
- lots ≥ 760; blocks within ±15% of 264.
- Every non-interior lot has seamT, other, walk, fP and era.
- Every street, radial line and threshold rel resolves to plan.relations.edges.
- lot.stationBuilding is set for every stationFront square that has a qualifying lot.
- history, plan, roads and lots stage timings are within budget.

3) --sweep: the 15 C§2 seeds × density 0.85/1/1.2.
- No exceptions.
- At most 1 open ring.
- stations ≥ 4; gakuenCoverage ≥ 0.75; mainShare ≤ 0.30.
- Median academy→nearest-residential distance ≤ 320 m.
- Median harbor→river-mouth distance ≤ 180 m.

4) Determinism. Two lumina runs give an identical JSON.stringify(plan.stats) and an identical roadLine checksum.

5) --png <file>. Write your own debug top-down image to the scratchpad and inspect it: ring, radials, streets in accent colours, old road in sepia, squares, stations, thresholds.
