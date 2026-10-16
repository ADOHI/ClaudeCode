# LUMINA 결합 구현 계획 — 도시 골격(유기성) × 판타지 건축

The two source specs are saved verbatim in the repo: docs/specs/cohesion.md (cited as "C§") and docs/specs/architecture.md (cited as "A§"). Where they differ from this plan, this plan wins. Each engineer reads this plan_md, its own work package, and the spec sections the package cites.

## 0. How the plan answers the user
The user gave two pieces of feedback:
1. Each chunk makes sense alone, but there is no organic link between chunks. The city looks like chunks scattered on a map, not something a person planned.
2. The buildings all look alike, which is boring. This is a fantasy world, so there should be many very original buildings.

**Cohesion track (C§).** It lays the city skeleton first:
- a ring boulevard, with the monorail running on its median;
- 4–7 radials, each ending at a destination (the spire → gate → quad → tower axis);
- stations, plus squares at stations, gates and district cores;
- one old road from the river-mouth fishing village, plus the 참배길 branch to the world tree;
- a typed relation graph: 통학, 방과후, 물류, 옛길, 산책, 국경, 대로.

Everything else reads that skeleton: programs, TOD heights, named-street character, seam bands, thresholds, props, names, signposts and lock-and-key chains. Every building carries a cause chain, for example "센트럴역 도보 60m · 루미에르 언덕길 변 · 상점가↔여학원 이음매".

**Architecture track (A§).** It provides:
- 12 style vocabularies, each designed silhouette-first;
- a component grammar: footprint → tiers and operators → crown → attachments;
- block genes with a borrowing ladder;
- a 4-tier hierarchy: Landmark › Signature › Accent › Common;
- 16 signature buildings (13 city, 3 campus), plus floating isles around the spire;
- relations between buildings: row arcades, skybridges, gateways, alley canopies and rival fortification.

**How the two tracks connect.** This is the main decision of the combined plan. Architecture is computed from the cohesion context, so building style itself becomes a cohesion signal.
- **Faction influence.** There is one road-geodesic field per academy, seeded at its gate. It flows down the gate radial and the named 통학로 (gakuen street). Each academy's style therefore bleeds along its school road and fades through its dorm town.
- **Street character → STREET_STYLE bias:**
  - shotengai → neon and lantern rows, plus row arcades;
  - market → lantern and tide;
  - promenade → terrace;
  - ring and radials → civic halo;
  - old road → the heritage modifier.
- **Era (from history and station distance) → MODS:**
  - era 0 = dark-tile gable roofs, lattice windows and lantern rows;
  - era 3, within 110 m walk of a station = glass curtain walls and light strips.
- **Node importance → hierarchy:**
  - station buildings on station-front squares become tier-A 'square' accents;
  - hinge accents mark spine junctions;
  - terminus accents close the ends of streets and axes;
  - signatures go where vista, flow, node, water and border scores peak.
- **Transition blending.** One seam field, lot.seamT, drives two things:
  - seam zoning of programs (학원가, 하숙촌, 어시장 골목…);
  - style borrowing, in the order palette → ornament → window → crown → body.

  MAIN, COAST and river edges never borrow. Rival borders never blend; instead they get merlons, banners and a front-line checkpoint.
- **Thresholds.** There is one marker system:
  - friendly pairs get a split-pier gateway, with the origin style on the left pier and the destination style on the right;
  - other crossings get the cohesion type marker;
  - release plazas sit just inside each threshold.

## 1. Decisions that resolve conflicts between the specs

**D1 — Params.**
- `DEFAULT_PARAMS = { density: 1, alleys: 1, plan: true, arch: 1, wow: 1 }`.
- A§ P6 (ley lines) is cut: no params.ley and no 'line' decal.
- params.archGrammar is not implemented.

**D2 — Parity.**
- {plan:false, arch:0} must be byte-identical to git commit e1661f2, the clean baseline in this repo:
  - the same entity SHA-1, using the A§13 field list;
  - every legacy metrics key deep-equal. On lumina that is 12722 entities, 675 buildings and 857 lots.
- New metric keys may be added.
- {plan:false, arch:1} and {plan:true, arch:0} must run without exceptions. They have no parity requirement.
- Arch-relative gates compare arch:1 against arch:0 with the SAME plan setting. These gates cover visibility, rooftop eligibility, secrets, gates and graffiti.

**D3 — One faction field.** influence.js (owned by C1) computes it in flow0 whenever plan or arch is on.
- It is a 4 m road geodesic on ctx.roadCost4. That cost is road-only, so water is passable only on BRIDGE cells.
- Sources:
  - road cells within 12 m of the gate, at distance 0;
  - road cells 4-adjacent to that academy's campus-zone boundary, at distance 40 m.
- F = exp(−g/L), with L = FACTIONS[type].L: trad 150, tech 140, free 180, arts 150.
- Off-road cells are filled by 3 passes of the 8-neighbour rule max(v, 0.85·neighbour).
- The academy's own campus cells are set to 1.

This replaces both C§8 C5 computeAcademyInfluence and A§5.2. The C§ version used an 8 m grid with back-gate and wall-hole sources; those sources are dropped because the campus is not built yet at flow0. FACTIONS (in config.js) replaces SPECIES, ACADEMY_LAMBDA and the L column of FACTION_EMIT.

**D4 — One threshold system.**
- **A** detects crossings (markThresholds, lots stage) and flags release and compress lots.
- **B** zones those lots as release plazas and compressed frontage.
- **C2** builds every marker in the props stage, after rail, via genArchUrban → genGateways:
  - It builds a split-pier gateway (A§7.5 piers, lintel and plate) when all of these hold: arch is on, the pair is not rival, style(from) ≠ style(to), and the crossing line has sidewalks.
  - Otherwise it builds the C§8 C3 type marker.
  - Rival crossings get only the academy-band flagpole marker, named '${B.short} 세력권'.
- Every marker has a tier-2 POI with rule 'meso.threshold', whose why contains both district names.
- In arch-only mode (plan off), C2 runs the A§7.5 level-1 transition detection itself.
- C§3 genThresholds in city.js is dropped.

**D5 — One seam field.**
- A sets lot.seamT = smoothstep(0, 64, seamMargin) and lot.other = district2, both sampled at the lot centre.
- B uses them for SEAMS zoning.
- C1 uses them for the soft-edge style blend: w[base(other)] += 0.5·(1 − seamT)^1.3. This replaces A§5.3's dB/48 term whenever seamT exists.
- Hard-edge detection stays C1's border march (A§5.1).

**D6 — Station buildings.**
- A marks lot.stationBuilding = squareId on the largest non-interior lot whose lot.square is a stationFront square.
- B zones it with the EKIMAE override: office with podium if area > 400, else mall; at least round(7·hf) floors; named '${station.name} 빌딩'.
- C1 makes it tier A, with accent 'square', mods ['modern'] and crownLock 'flat'.
- B excludes it from landmark sites.
- C2 excludes it from signatures, along with squares, release lots, landmark lots, and heritage lots (except water_mill and teapot_cafe). C2 also keeps tall signatures at least 40 m from station-front square centres.

**D7 — Floors, pass 2 (B).** Apply these in order:
1. band blend;
2. arch block clamp: C-tier ±2 around the block median (A§5.4.8);
3. street wall: ±1 (C§7 B3.5);
4. cross-border height relaxation: ≤ 2.5×;
5. axis view caps;
6. frame caps (lot.arch.floorsCap);
7. heritage cap: ≤ 3.

**D8 — Colour.** When arch is on, walls and roofs come from the style kit, so B passes no `color` for ordinary lots. The C§8 C1 seam colour lerp applies only when arch is off. The tier-0 use band (A§8.7) keeps program colour readable.

**D9 — Heritage under arch.** B passes roofStyle 'gable' and roofColor jitter('#4d5866'). C1 applies MODS.heritage (lattice windows, dark-tile gable, hip or eaves crowns, lanternRow) and caps floors at 3.

**D10 — Signposts.** Up to 4 plates:
1. the spire;
2. the nearest station by walk (plan mode), or the nearest landmark (legacy);
3. the named street, or the district across the nearest threshold (plan mode), or the 2nd landmark (legacy);
4. the nearest minor (signature) landmark within 220 m (arch on), in colour #b05cd8.

Plates 1–3 exclude minor and deleted landmarks.

**D11 — Secrets, ladders and vantages are created only in the intent stage.** genIntent resets ctx.secrets. Signatures and isles therefore hand them over in ctx.climbSites and ctx.sigSecrets, and B's intent places them.

**D12 — Canopy vs laundry.**
- C2 decorates alleys (neon and lantern strings, arche light pipes) and sets line.canopyDone.
- For cottage, terrace and relic alleys, C2 sets line.laundry = true instead.
- B's laundry loop runs when !line.canopyDone && (line.laundry ?? the legacy residential/ruins rule).

**D13 — Share data, not helper imports.**
- lotFeatures is NOT extracted into city.js. C1 computes lot.F; B keeps its own lot.flow.
- genPlazaIsles lives in archurban.js.
- The ctx.archLotStyle raster is dropped; D reads lot.arch.
- D reads style names and swatches from ctx.archStyleList, not from archstyles.js.

**D14 — Window pattern ids.** C1 writes them; D shades them.

| id | pattern |
|---|---|
| 0 | legacy grid (fixed 3.2/2.6, byte-identical) |
| 1 | lancet |
| 2 | ribbon |
| 3 | porthole |
| 4 | lattice |
| 5 | sparse / boarded |
| 6 | curtain |
| 7 | round-arch |
| 8 | grid with parametric floor height and bay |

'grid' in the A§4 table means id 8.

**D15 — Budgets are combined (§6).** C§'s "no new geometries or materials" is lifted: A§11.1 adds 9 shapes and the 'bldR' material.

**D16 — Merged acceptance numbers.**
- rooftopRoutes ≥ 6 on lumina, ≥ 4 on each sweep seed.
- thresholds ≥ 8, of which ≥ 4 are split-pier gateways.
- drawBuckets ≤ 110.
- entities ≤ 24,000.
- The dialect check is generalised, because plan-mode annealing moves districts: the commercial district nearest the centre is neon, the other is lantern, and the two residential districts differ.

**D17 — Build outputs.** index.html and dist/* are produced by tools/build.mjs from src/app.html. Only D (inside its checks) and the lead run the build. Nobody hand-edits index.html.

**D18 — Tendril metric.** It uses road lines with line.approach === d.id. A sets approach on gate trunks; legacy approach avenues already have it.

**D19 — Metrics.**
- m.score = 0.85·scoreLegacy + 0.15·cohesion.score, but only when ctx.plan is set.
- Arch metrics go in m.arch and do not change m.score.
- Level-5 road km appears in roadKm only when it is > 0.

**D20 — Station building name.** It is '${station.name} 빌딩', which avoids '…역 역 빌딩'.

## 2. Target pipeline
The lead writes this into src/core/generator.js at integration.

```js
const AR = (c) => c.params.arch !== 0;
export const DEFAULT_PARAMS = { density: 1, alleys: 1, plan: true, arch: 1, wow: 1 };
// createContext adds plan:null, history:null. Packages initialise their own ctx arrays lazily (ctx.x ||= []).
// removeBuilding also marks entities with e.ref2 === b.id as deleted.
export const STAGES = [
 ['terrain','섬 지형 · 하천', c => genTerrain(c)],                                     // A
 ['districts','구역 배치 최적화', c => genDistricts(c)],                                // A
 ['history','연대기 · 옛길', c => { if (c.params.plan) genHistory(c); }],                // A
 ['plan','도시 골격 계획', c => { if (c.params.plan) genPlan(c); }],                     // A
 ['roads','텐서장 가로망', c => { genRoads(c); rasterizeRoads(c); computeNodes(c); if (c.plan) planStreets(c); }],  // A
 ['blocks','블록 · 관통 골목', c => { extractBlocks(c); genAlleys(c); markSpecialBlocks(c); }],             // A, B
 ['lots','둘레형 필지 분할', c => { genLots(c); if (c.plan) { annotateLots(c); markThresholds(c); } }],       // A
 ['flow0','생활 동선 · 양식장', c => {
    if (c.plan) buildOD(c); else buildHubs(c);            // A | B (legacy)
    roadFlow(c);                                           // A: OD flow when plan; ctx.roadCost4 always
    if (c.plan) accessFields(c);                           // A
    chooseLandmarkSites(c);                                // B
    if (c.plan || AR(c)) computeFactionField(c);           // C1
    if (AR(c)) { prepareArchitecture(c); chooseSignatureSites(c); finalizeArchitecture(c); } }],  // C1, C2, C1
 ['buildings','용도 배정 · 건물', c => {
    genCenter(c);                                          // B (unchanged)
    if (c.plan || AR(c)) genCityBuildingsPlan(c); else genCityBuildings(c);   // B
    if (AR(c)) buildSignatures(c);                         // C2
    if (c.plan) genSquares(c);                             // B
    genContainerYard(c); genHarborFeatures(c);             // B (unchanged)
    if (AR(c)) genRowArcades(c); }],                       // C2
 ['campus','학원 캠퍼스 문법', c => { genCampuses(c); if (AR(c)) buildCampusSignatures(c); }],     // C1, C2
 ['park','공원 문법', c => genPark(c)],                                                          // B
 ['rail','모노레일 환상선', c => genRail(c)],                                                    // B
 ['props','마이크로 규칙', c => { if (c.plan || AR(c)) genArchUrban(c); genProps(c); }],          // C2, B
 ['analysis','흐름 · 아이소비스트 분석', c => fullAnalysis(c)],                                   // A
 ['intent','의도 레이어 배치', c => genIntent(c)],                                               // B
 ['metrics','레벨 품질 지표', c => computeMetrics(c)],                                           // B; the lead adds archMetrics and drawBuckets
];
```

Imports the lead adds:
- history.js: genHistory
- structure.js: genPlan, buildOD, accessFields
- streets.js: planStreets, markThresholds
- seams.js: annotateLots
- city.js: genCityBuildingsPlan, genSquares (plus the existing imports)
- influence.js: computeFactionField
- style.js: prepareArchitecture, finalizeArchitecture
- signatures.js: chooseSignatureSites, buildSignatures, buildCampusSignatures
- archurban.js: genRowArcades, genArchUrban

## 3. File ownership
No file has two owners. An asterisk (*) marks a new file.

| Package | Owns (create or modify) |
|---|---|
| A skeleton | src/core/config.js, terrain.js, districts.js, history.js*, structure.js*, streets.js*, seams.js*, roads.js, blocks.js, analysis.js, tools/check-plan.mjs* |
| B fabric | src/core/zoning.js*, city.js, props.js, intent.js, rail.js, park.js, metrics.js, cohesionmetrics.js*, tools/sweep.mjs, tools/check-fabric.mjs* |
| C1 style + grammar | src/core/archstyles.js*, influence.js*, style.js*, archgrammar.js*, buildings.js, campus.js, collision.js, tools/check-arch-grammar.mjs* |
| C2 signatures + urban | src/core/signatures.js*, archurban.js*, archmetrics.js*, tools/arch-check.mjs*, tools/baseline/ |
| D render, UI, tools | src/core/render-keys.js*, src/core/export.js, src/render/world.js, src/render/ground.js, src/render/labels.js, src/main.js, src/app.html, src/game/explore.js, tools/headless.mjs, tools/shot.mjs, tools/test-explore.mjs, tools/check-render.mjs* |
| Lead (after all packages) | src/core/generator.js, the final 3-line addition to metrics.js, docs/DESIGN.md, README.md, index.html and dist/* (build outputs), review/after/* |

Nobody changes grid.js, rng.js, tools/build.mjs, tools/seed-search.mjs, docs/RESEARCH.md or docs/specs/*.

## 4. Shared data contract
This is the only coupling between packages. Read the data; do not import other packages' helpers.

### 4.1 ctx fields

**A:**
- riverMouths `[{x,z}]` — always.
- district2: `Grid(1024,1024,1,-512,-512,Uint8Array)`, and seamMargin: `Uint8Array(1024²)` — plan only.
- districtColor `{n:256, cell:4, ox:-512, oz:-512, rgb:Uint8ClampedArray(256·256·3)}` — plan only.
- history (or null), and distOld2: `Float32Array(512²)`.
- plan: either a complete object or null. Its shape is C§5 plus:
  - plan.stats (§4.7);
  - plan.thresholds[i].rival and .kind;
  - plan.streets[i].weight and .academy.
- gates — in plan mode these come from structure.computeGates.
- roadLine: `Int16Array(1024²)`, −1 = none. ALWAYS written.
- streetMask: `Uint8Array(1024²)`, street id + 1 — plan only.
- roadFlow: Grid at 4 m — always.
- roadFlowP: `{commute, school, shop, leisure, market}`, each a Grid at 4 m — plan only.
- roadCost4: `Float32Array(256²)`, 0 = impassable, the exact cost roadFlow uses. ALWAYS written.
- flowP — plan only, after fullAnalysis.
- hubs — a copy of plan.nodes in plan mode; later stages append to it.

**B:**
- roofGraph `{roofs, routes, bridgeEdges, naturalEntries}`, where roofs is the eligible count after substitution.
- chains `[{rel, gate, key, from, to}]`.
- sigRailDemoted (int).

**C1:**
- factionInf `{[academyType]: Grid(256,256,4,-512,-512,Float32Array)}`.
- factionDom `{types:[academyType…], dom, v}`:
  - dom: Grid of Uint8, an index into types, 255 = none;
  - v: Grid of Float32, equal to max − 0.5·second.
- archRows `[{id, block, front, lots:[lotId], style, arcade, palettePair:[hex,hex], len}]`.
- archStyleList `[{key, name, swatch:[4 hex], roof, accent}]`.
- archBudget `{cap:9500, projected, demoted}`.
- archSummary `{tiers, styles, crowns}`.

**C2:**
- signatures `[{id, recipe, name, lot, b, x, z, top, district, score, rank}]`.
- climbSites `[{b, face, x, z, top, name, district, ladder:bool}]`.
- sigSecrets `[{type, x, y, z, district, name, why, reveal}]`.
- skybridges `[{a, b, y, x, z, len, ent}]`, where a and b are building ids.
- gateways `[{thr, x, z, from, to, kind, ents:[id]}]`.

### 4.2 lot fields

**A, lots stage (plan only):**
- frontLine — road line id.
- frontType — ROAD type.
- street — −1 or a street id.
- spine — 'ring', 'radial' or undefined.
- heritage — bool.
- square — a plan square id or undefined.
- seamT — 0..1.
- other — district id.
- stationBuilding — square id or undefined.
- release, compress — threshold ids.

**A, flow0 (plan only):**
- walk `{station, gate, core}` — metres; Infinity if unreachable.
- fP `{commute, school, shop, leisure, market}` — 0..1.
- era — 0, 2 or 3:
  - 0 if heritage, or within 120 m of history.origin;
  - 3 if walk.station < 110 and the district type is commercial, center, residential or ruins;
  - 2 otherwise.

**B, buildings stage:**
- prog.
- source — one of 'district', 'street', 'ekimae', 'heritage', 'gate', 'release', 'compress', 'promenade', 'seam', 'leak', 'landmark'.
- seamKey, floors, building, cause.
- axis — landmark lots only.

**C1, flow0 (arch on):**
- F — `{area, corner, frontRank, interior, r, sea, river, flow, axis, V, axisDir:[x,z], N, X, W, waterDir, parkEdge, passage, dB, nd, hard, rivalB, rivalDir, inf:{type:value}, front:{cx,cz,nx,nz}}`.
- arch — the spec.arch payload (§4.4).

**C2, flow0 (arch on):**
- signature — recipe id.
- sig — `{score, parts, rank, hMax, face, axis, prog, name}`.
- sigMerged — seed lot id, for gravity_scar crater lots.
- frameOf — the signature's lot id.
- On frame lots, C2 also writes lot.arch.floorsCap and lot.arch.noBillboard.

### 4.3 Districts and road lines
- **Districts:**
  - A (plan only): d.baseName, d.relName, d.short, d.persona, d.story. d.name is set to relName.
  - C1: d.styleKey, d.style (Korean vocabulary name), d.dialect (Korean).
- **Road lines:**
  - A: line.spine, line.median, line.old, line.name, line.rel, line.approach (district id on gate trunks; legacy avenues already set it), line.branch, line.dest.
  - C2: line.canopyDone, line.canopyStyle, line.laundry.

### 4.4 makeBuilding and the building record
C1 implements these; B, C2, campus and rail call them.

**Signatures stay as they are:**
- `makeBuilding(ctx, spec, rng)`.
- `footprintFromLot(lot, prog, rng, buildTo?)` — buildTo is an optional 4th argument, a [min, max] front setback.
- `decorate(ctx, b, prog, rng, spec)` is now exported.

**New spec fields from callers:**
- arch — lot.arch, or a campus/rail object. Ignored when params.arch === 0.
- street `{kind, name, accent}`.
- ctxTags `{era, street, seam, seamW, other, faction, heritage}`.
- cause `[{k, t, rel?}]` and rel.
- roofStyle and roofColor (existing fields).
- lot (existing) — C1 derives the building envelope from ctx.lots[spec.lot].

**spec.arch payload** (C1 defines it in style.js):
- w `{style: weight}`, s1, s2, t.
- slots `{palette, ornament, window, crown, body}`, each 'A' or 'B'.
- gene `{env:{wallPair, win, trim}, mass:{footprint, op}, crown:{family, roofColor}, mutated}`.
- tier — 'S', 'A', 'C' or 'D'.
- decay, ghost.
- accent — null, 'hinge', 'terminus', 'rowhead' or 'square'; plus accentFace.
- fort, rivalDir.
- mods — e.g. 'heritage', 'modern'.
- crownLock — 'flat', 'gable' or undefined.
- formal, purity, row, rowIdx, groundInset, floorsCap, noBillboard, why.

**Building record additions:**
- cause, rel, ctxTags, street, tier.
- arch — the resolved copy: s1, s2, t, slots, mods, accent, decay, borrowed[].
- footprint — 'rect', 'L', 'round', 'oct' or 'multi'.
- ops[], crown, win (pattern name), grammar[] (trace chips).
- groundInset, noBillboard, signature, sig.
- roofs[] gain walk (bool), pitched, entry, round and terrace.

### 4.5 Entities
- **New shapes.** Each has its base at y = 0, a footprint of [−.5, .5]², and is scaled by w, h, d:
  - dome, onion, frus, cyl8, pyr, hip, mansard;
  - vault — axis along local x;
  - arch — the opening spans local x; thickness is along local z.
- **New material:** 'bldR' (round facade).
- **Facade fields on mat bld/bldR entities:**
  - fac `[win, fh, bay, flags]`, where flags are 1 plinth | 2 cornice | 4 string course | 8 lit;
  - trim '#hex';
  - lit 0..1;
  - band '#hex';
  - bandMask 0..15.
- **Other new fields:** sig, ref2, rel, cause.
- **Footprint classes** (used by collision, rasterSolids, buildOccupancy and headless):
  - round = cyl, sphere, cone, torus, oct, dome, onion, frus, cyl8;
  - OBB = box, gable, ramp, pyr, hip, mansard, vault, arch.
  - 'arch' entities are always solid:false.
  - Legacy code paths keep their exact treatment of legacy shapes. Today rasterSolids and buildOccupancy treat round shapes as rot-0 OBBs; keep that and only ADD the new shapes.
- **New rule ids** (A adds them to config.RULES):
  - cohesion: macro.plan, macro.ring, macro.radial, macro.oldroad, macro.relation, meso.station, meso.street, meso.seam, meso.threshold, meso.heritage, meso.promenade, meso.axis, micro.banner, micro.territory, intent.chain;
  - layer 'arch': arch.style, arch.dialect, arch.field, arch.block, arch.borrow, arch.grammar, arch.tier, arch.corner, arch.terminus, arch.rival, arch.frame, arch.arcade, arch.signature, arch.gateway, arch.skybridge;
  - layer 'micro': micro.canopy.

### 4.6 POIs, landmarks and secrets
- **POIs:**
  - type 'sig', tier 1 (C2);
  - threshold POIs: type 'micro', tier 2, rule 'meso.threshold' (C2);
  - square POIs (B).

  POIs and entities may carry cause and rel.
- **Landmarks:** signature landmarks are `{minor:true, kind:'signature', sig}` (C2). Rail demotion sets deleted:true (B).
- **Secrets:** only intent (B) calls addSecret. Signature hooks arrive via ctx.climbSites and ctx.sigSecrets (D11).

### 4.7 plan.stats
A fills these by the end of flow0:
- ringClosed, ringCoverageDeg, ringLen;
- radials, radialsTerminated;
- stations (ring stations), central (bool);
- gateStationWalk `{academyType: m}`;
- gakuenCoverage, namedStreets, namedStreetKm;
- mainShare, thresholds;
- relations, relationRealized;
- oldRoadKm, tJunctions;
- harborMouth, dormTownMax;
- acadResDist `{academyType: m}`.

## 5. Parallel development rules

**S1 — config.js (A, first ~20 minutes).**
- A lands ALL the config.js additions: the §4.5 rule ids, the C§4 tables, FACTIONS, and ROAD.OLD / ROAD_LEVELS[5]. Then A confirms legacy parity.
- Other packages must not import the new config exports until `grep -q 'export const FACTIONS' src/core/config.js` succeeds. Poll for it. Never add the exports yourself.
- Reading ROAD.OLD before S1 is safe; it is just undefined.

**S2 — archstyles.js (C1, first ~20 minutes).**
- C1 lands src/core/archstyles.js, pure data: STYLES, CROWNS, WIN, HYBRID_OK, IDENTITY_RANK, PIER, TIER_MAX, DECOR_MAX, LINT_PIN_HUES, FACTION_A, CIVIC, STYLE_OF, STREET_STYLE, ERA_MODS, MODS, STYLE_LIST.
- C2 imports it. The export names are frozen.

**Ownership.** Never edit a file you do not own. If you need something from another package that is not in the contract, implement a guarded fallback inside your own files and list the request in your final report. The lead resolves it.

**Keep files usable.**
- Keep every owned file syntactically valid at all times: run `node --check <file>` after edits.
- Keep the legacy path working. Other agents import your files while you work.
- Guard new behaviour with data presence (ctx.plan, lot.arch, ctx.factionInf…) or with params.

**Pipeline before integration.** The lead wires generator.js only after all packages land. Until then, every check script runs the target pipeline itself through tolerant dynamic imports (the devpipe below). Once the lead has wired generator.js, devpipe defers to generateSync.

**Builds.** Only D (inside check-render) and the lead run tools/build.mjs.

**Baselines.** The JSON files under tools/baseline/ belong to C2. Other packages may read them, or build their own legacy reference in their scratchpad:

```
git -C /home/user/academy-city archive e1661f2 src | tar -x -C <scratch>/legacy
```

**RNG.** Use only new fork labels, and never consume parent streams in legacy paths.

| Package | Fork labels |
|---|---|
| A | 'history', 'plan', 'streets', 'thresholds' |
| B | 'squares', 'chains', 'banners', 'oldroad', 'zoning2' |
| C1 | 'arch:b'+blockId, lot.rng.fork('arch'), 'arch-style' |
| C2 | 'arch-sig', 'arch-urban', 'isles', 'arcade' |

**devpipe.** Copy this into your tools/check-*.mjs:

```js
import { createContext, STAGES, generateSync } from '../src/core/generator.js';
const NAMES = ['terrain','districts','history','structure','roads','streets','blocks','seams','city','analysis','influence','style','signatures','archurban','campus','park','rail','props','intent','metrics'];
const M = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await import(`../src/core/${n}.js`).catch((e) => { console.warn(`[devpipe] ${n}.js unavailable: ${e.message}`); return {}; })])));
const call = (n, f, c) => (M[n][f] ? M[n][f](c) : undefined);
export function devGenerate(seed, params = {}) {
  const P = { plan: true, arch: 1, wow: 1, ...params };
  if (STAGES.some((s) => s[0] === 'plan')) return generateSync(seed, null, P);   // lead has wired generator.js
  const c = createContext(seed, P); c.plan = null; c.history = null;
  const AR = P.arch !== 0, T = (k, fn) => { const t = performance.now(); fn(); c.timings[k] = performance.now() - t; };
  const t0 = performance.now();
  T('terrain', () => call('terrain','genTerrain',c));
  T('districts', () => call('districts','genDistricts',c));
  T('history', () => { if (P.plan) call('history','genHistory',c); });
  T('plan', () => { if (P.plan) call('structure','genPlan',c); });
  T('roads', () => { call('roads','genRoads',c); call('roads','rasterizeRoads',c); call('roads','computeNodes',c); if (c.plan) call('streets','planStreets',c); });
  T('blocks', () => { call('blocks','extractBlocks',c); call('blocks','genAlleys',c); call('city','markSpecialBlocks',c); });
  T('lots', () => { call('blocks','genLots',c); if (c.plan) { call('seams','annotateLots',c); call('streets','markThresholds',c); } });
  T('flow0', () => { if (c.plan && M.structure.buildOD) call('structure','buildOD',c); else call('city','buildHubs',c);
    call('analysis','roadFlow',c); if (c.plan) call('structure','accessFields',c); call('city','chooseLandmarkSites',c);
    if (c.plan || AR) call('influence','computeFactionField',c);
    if (AR) { call('style','prepareArchitecture',c); call('signatures','chooseSignatureSites',c); call('style','finalizeArchitecture',c); } });
  T('buildings', () => { call('city','genCenter',c);
    if ((c.plan || AR) && M.city.genCityBuildingsPlan) call('city','genCityBuildingsPlan',c); else call('city','genCityBuildings',c);
    if (AR) call('signatures','buildSignatures',c); if (c.plan) call('city','genSquares',c);
    call('city','genContainerYard',c); call('city','genHarborFeatures',c); if (AR) call('archurban','genRowArcades',c); });
  T('campus', () => { call('campus','genCampuses',c); if (AR) call('signatures','buildCampusSignatures',c); });
  T('park', () => call('park','genPark',c));
  T('rail', () => call('rail','genRail',c));
  T('props', () => { if (c.plan || AR) call('archurban','genArchUrban',c); call('props','genProps',c); });
  T('analysis', () => call('analysis','fullAnalysis',c));
  T('intent', () => call('intent','genIntent',c));
  T('metrics', () => call('metrics','computeMetrics',c));
  c.timings.total = performance.now() - t0;
  return c;
}
```

With {plan:false, arch:0}, devGenerate calls exactly the legacy functions in legacy order, so it doubles as the parity harness.

## 6. Combined budgets
All figures are for lumina, in Node, in this container.

**Time.**
- Total ≤ 5400 ms AND ≤ 1.6 × the {plan:false, arch:0} total measured in the same process.
- Every sweep seed ≤ 6000 ms.

| Stage | Cap (ms) | Split |
|---|---|---|
| history | 60 | |
| plan | 220 | |
| roads | 450 | includes planStreets |
| lots | 140 | |
| flow0 | 480 | A ≤ 220, C1 ≤ 120, C2 ≤ 60, B landmark axes ≤ 40 |
| buildings | 400 | B zoning ≤ 120, grammar ≤ 200, signatures + arcades ≤ 80 |
| campus | 320 | |
| props | 180 | C2 urban ≤ 60 |
| analysis | 850 | |
| intent | 460 | |
| metrics | 160 | cohesion ≤ 60, arch ≤ 100 |

**Entities (live).**
- Default params ≤ 24,000; {arch:0} ≤ 15,500; {plan:false} ≤ 22,000.
- building + roof + facade ≤ 9,500 (archBudget.cap).
- New entities per package:
  - **B ≤ +2,800:** squares ~390, release plazas ~120, arches ~64, banners ≤ 420, lanterns and pines ~300, covered roof ~70, posters ≤ 220, sakura ~150, bike racks ≤ 80.
  - **C2 ≤ +1,700:** signatures ≤ 60 each, isles ~40, arcades ~500, markers ≤ 24×10, canopies ~250, skybridges ~40.
  - **C1:** building/roof/facade stays within 9,500. That is about +4.2k over the legacy 4,237, minus ~317 AC units.

**Draw calls.**
- Draw buckets (bucketKey over live entities) ≤ 110.
- ≤ 5 cloned bld/bldR geometries.
- Shader branches are uniform per instance.

**Build.**
- No external assets.
- New files are plain ES modules reached through generator.js.
- dist/academy-city.html stays a single file; its only external URLs are three.js via the CDN importmap and Google Fonts.

## 7. Order of work inside each package
Land data early, because other packages depend on it.

- **A:**
  1. S1 config.
  2. terrain, districts.
  3. history.
  4. structure.genPlan.
  5. roads.
  6. streets, blocks, seams.
  7. analysis OD flow and accessFields.
  8. stats.
  9. check-plan.

  Land genPlan and roads as early as possible: B, C1 and C2 can test plan-mode behaviour only after that.
- **C1:**
  1. S2 archstyles.
  2. influence.js.
  3. style.js (features, styles, genes).
  4. buildings.js arch branch and archgrammar — rect/flat first, then crowns, operators and attachments.
  5. campus, collision.
  6. finalize (accents, budget).
  7. check.
- **C2:**
  1. arch-check baseline and the --unit harness.
  2. signature site selection and frames.
  3. Recipes — the 6 most visible first: lantern_tower, gacha_tower, teapot_cafe, book_tower, container_babel, witch_hat. Then the rest.
  4. The 3 campus recipes.
  5. archurban: gateways and markers, arcades, skybridges, isles, canopies.
  6. archmetrics.
- **B:**
  1. zoning.js data.
  2. genCityBuildingsPlan skeleton, working with plan null.
  3. squares, release plazas, landmark axes.
  4. props dressing.
  5. intent: signposts, front line, chains, rooftop routes, climbSites.
  6. rail, park.
  7. cohesion metrics, sweep.
- **D:**
  1. render-keys, geometries, shader — legacy-identical first.
  2. URL params and selects.
  3. overlays, ground.
  4. inspector, panels, labels.
  5. explore banners.
  6. export, headless, shot, test-explore.
  7. check-render.

## 8. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| The ring or radials fail on some seed | Set ring.closed = false and run the legacy rail through the plan stations. The sweep allows at most 1 open ring in 15 seeds. |
| mainShare or lot count drifts | The lead tunes PLAN.roads.dsepMain (150 → 130) and maxMainLines (30 → 45) at integration. |
| Rooftop routes collapse under pitched crowns | C1's route-district walkable-crown guard (A§5.4.3), B's roof substitution, and skybridges. The lead may raise flatMin for neon, lantern and arche. |
| Borders turn to visual mush | Gates: corePurity ≥ 0.9, districtIdentityMin ≥ 0.6, blockCoherence ≥ 0.85, hardBorrow = 0. |
| Time budget is exceeded | The biggest new costs are flow0 (faction Dijkstras, signature site scan) and analysis. Use typed arrays only and allocate no objects per cell. The lead can lower PLAN.od.genericW or the signature candidate count (top 30 → 20). |
| Contracts mismatch at integration | Each final report lists every ctx/lot/building field the package reads or writes. The lead diffs them against §4 before wiring. |


## Integration steps
0. **Before dispatch.** Nothing is required. The legacy baseline is git commit e1661f2, and every package can rebuild it. Confirm that `git -C /home/user/academy-city log --oneline -1` shows e1661f2 and that the working tree is clean apart from docs/specs/. The source specs are saved in docs/specs/cohesion.md and docs/specs/architecture.md. Give every engineer plan_md, its work package, and those two files.

1. **Collect the five final reports.** Diff every reported ctx/lot/building/entity field against plan_md §4. Fix each mismatch in its owning file: send it back to the owner if they are still active, otherwise fix it yourself.

2. **Wire src/core/generator.js.**
   - Paste in the plan_md §2 imports, DEFAULT_PARAMS and STAGES.
   - createContext adds `plan:null` and `history:null`.
   - removeBuilding also marks entities with `e.ref2 === b.id` as deleted.

3. **Finish src/core/metrics.js** at the `// LEAD` marker:
   - `import { archMetrics } from './archmetrics.js'` and `{ bucketKey } from './render-keys.js'`;
   - `m.drawBuckets` = the number of distinct bucketKey values over live entities;
   - `if (ctx.params.arch !== 0) m.arch = archMetrics(ctx, { bucketKey })`;
   - `if (m.cohesion) m.cohesion.drawBuckets = m.drawBuckets`.

4. **Smoke-test and check parity.**
   - Run `node --check` on every file in src/core.
   - Run `node tools/headless.mjs lumina`.
   - Run `node tools/headless.mjs lumina --param plan=false --param arch=0` and `node tools/arch-check.mjs lumina kivotos academy-7`. These must reproduce the e1661f2 metrics and entity SHA-1 exactly.

5. **Run the package checks and tune.** Run `node tools/check-plan.mjs`, `check-fabric.mjs`, `check-arch-grammar.mjs` (including `--unit`), `arch-check.mjs` (including `--unit`) and `sweep.mjs`. Tune only data knobs:

   | Symptom | Knob |
   |---|---|
   | mainShare, lots or blocks off target | PLAN.roads.dsepMain (150 → 130) or maxMainLines (30 → 45) |
   | poiCoverage or secrets regress | PLAN.od.scale (12 → 8) |
   | rooftopRoutes < 6 | STYLES[neon / lantern / arche].flatMin |
   | sigNear or accentGap miss | wow and the signature district quotas |
   | entity budget exceeded | archBudget.cap, or the banner / marker caps |

6. **Performance pass.**
   - Lumina total ≤ 5400 ms, and ≤ 1.6× the plan:false/arch:0 run measured in the same process.
   - Each stage stays within its plan_md §6 cap.
   - Profile with `node --cpu-prof tools/headless.mjs lumina` if needed.

7. **Browser checks.** Run `node tools/check-render.mjs --browser`; it rebuilds index.html and dist/* via tools/build.mjs. Serve the repo with `python3 -m http.server 8123`, then run `node tools/test-explore.mjs http://127.0.0.1:8123/index.html review/after`.

8. **Screenshots into review/after/.**
   - `node tools/headless.mjs lumina --png review/after/topdown.png --plan`
   - `node tools/headless.mjs lumina --png review/after/topdown-style.png --style`
   - `STEPS=overlay:relation,overlay:arch,colormode:tier,close,view:trad_academy,view:commercial,view:ruins,view:harbor,view:residential,view:center,explore node tools/shot.mjs http://127.0.0.1:8123/index.html review/after`

   Review them against review/before/*.png and the user's two complaints:
   - The skeleton should read as one planned city: ring and monorail, radials ending at gates, station clusters, named streets, the old road, and borders that fade.
   - Each district should have a distinct, fantastical roofscape, with at least 8 recognisable signature silhouettes and the isles around the spire.

9. **Documentation.**
   - In docs/DESIGN.md, update the 14 → 16 stage table and add two chapters with their rule and metric rows: '도시 골격과 관계' (cohesion) and '건축 문법: 양식장 · 구성 문법 · 위계 · 시그니처' (architecture).
   - In README, document the new tools: `--param`, `--plan`, `--style`, `arch-check`, `check-*`, and the URL params `?plan=` / `?arch=`.
   - Keep docs/specs/ as design history.

10. **Final build.**
    - Run `node tools/build.mjs`.
    - Confirm dist/academy-city.html is a single file whose only external URLs are the three.js CDN importmap and Google Fonts.
    - Re-run the full acceptance list.
    - Publish or share the built page as the workflow requires, including before/after screenshots in the summary to the user.

## Acceptance
- Parity: with params {plan:false, arch:0}, lumina, kivotos and academy-7 reproduce git commit e1661f2 exactly. The live-entity SHA-1 (A§13 field list) matches, and every legacy metrics key is deep-equal (lumina: 12722 entities, 675 buildings, 857 lots). Verified by `node tools/arch-check.mjs lumina kivotos academy-7`.
- Determinism: two runs of `node tools/headless.mjs lumina` with the default params (plan:true, arch:1) print identical metrics JSON.
- Other param combinations run clean on lumina, kivotos and academy-7 with no exceptions: {plan:false, arch:1} with ≤ 22,000 live entities, and {plan:true, arch:0} with ≤ 15,500.
- Performance (Node, lumina, default params): timings.total ≤ 5400 ms and ≤ 1.6 × the {plan:false, arch:0} total measured in the same process. Stage caps: history ≤ 60, plan ≤ 220, roads ≤ 450, lots ≤ 140, flow0 ≤ 480, buildings ≤ 400, campus ≤ 320, props ≤ 180, analysis ≤ 850, intent ≤ 460, metrics ≤ 160 ms. No sweep seed exceeds 6000 ms.
- Budgets (lumina, default params): live entities ≤ 24,000; building+roof+facade ≤ 9,500; metrics.drawBuckets ≤ 110; buildings ≥ 600; lots ≥ 760; blocks within ±15% of 264; no building has more than 2 AC units. Tier part maxima hold: S ≤ 60, A ≤ 14, C ≤ 6, D ≤ 2.
- Skeleton (lumina, default params): cohesion.ringClosed = true, ringCoverageDeg in [330, 450], ringLen in [1300, 2000] m, radials in [4, 7], and radialsTerminated = radials.
- Stations and rail: 5–8 ring stations plus 센트럴역. Every cohesion.gateStationWalk value is in [80, 260] m. When the ring is closed, the monorail rides it: every ring station lies within 3 m of plan.ring.pts.
- TOD and named streets: cohesion.stationUplift ≥ 1.35 (baseline 0.83). gakuenCoverage = 1, namedStreets in [5, 10], namedStreetKm ≥ 1.0, namedStreetPoiShare ≥ 0.30. mainShare is in [0.15, 0.27] (baseline 0.33).
- Seams (lumina, default params): borderDhRatio ≤ 1.12, borderGridAngle ≤ 14°, borderProgramJS in [0.25, 0.55], corePurity ≥ 0.9, districtIdentityMin ≥ 0.6.
- Transitions: cohesion.thresholds ≥ 8 and releasePlazas ≥ 5. Every threshold has exactly one marker, with a tier-2 POI of rule 'meso.threshold' whose why contains both district names. At least 4 markers are split-pier gateways whose left and right piers come from PIER[style(from)] and PIER[style(to)], with every pier on a SIDEWALK cell. No gateway sits on a rival pair.
- History: oldRoadKm ≥ 0.3 and heritageFrontShare ≥ 0.6. At least 3 level-2 roads T-junction into the old road. The world tree stands at ctx.history.sacred. heritageLook ≥ 0.8: era-0 buildings show dark-tile pitched or eaves crowns with lattice windows.
- Relations: cohesion.relations in [10, 24] and relationRealized ≥ 0.6. Every named street, radial, threshold, seam-zoned building and relation-tagged entity has a rel that resolves to an id in ctx.plan.relations.edges.
- Placement: on lumina, harborMouth ≤ 230 m and dormTownMax ≤ 480 m. Across the 15 sweep seeds, the median academy→nearest-residential distance is ≤ 320 m and the median harbor→river-mouth distance is ≤ 180 m.
- Cause chains and names: ≥ 90% of live non-campus buildings have 1–3 cause clauses. Every station-front-square lot has a 'station' clause and every named-street lot has a 'street' clause. District labels use relational persona names: lumina shows at least one of 기숙사촌, 역전 상점가, 옛나루 상점가, 청해 어항 or 재개발 중단구역, and no '북부 1/2'-style suffix appears unless two personas collide.
- Gameplay (cohesion): cohesion.chains ≥ 2, each with key and lock in different districts and the key ≤ 25 m from the realising polyline. Each rival pair has one front-line checkpoint, at the influence sign change. Signposts at spine junctions show plates for the spire, the nearest station and the street or threshold, plus a minor-landmark plate when arch is on.
- Legacy level-design guards (lumina, default params): poiCoverage = 1, poiGapMax ≤ 48, landmarkVisible ≥ 0.95, spireVisible ≥ 0.85, deadEndCoverage = 1, secrets ≥ 80, crumbCoverage ≥ 0.8, rooftopRoutes ≥ 6, scoreLegacy ≥ 0.93.
- Architectural variety: archEntropy ≥ 3.5 bits (baseline 0.95); silhouetteKinds ≥ 14; every district with ≥ 40 buildings has ≥ 3 crown kinds; nonFlatCrownShare in [0.25, 0.50].
- Architectural coherence: styleSalt ≤ 0.05; blockCoherence ≥ 0.85; borrowRate in [0.04, 0.20]; hardBorrow = 0 (no borrowing across MAIN or COAST roads or the river); archDistinct ≥ 12 ΔE between adjacent districts.
- Style follows the skeleton: the faction tendril ratio is ≥ 2.0 for every academy, measured on lines with approach === d.id. styleFollowsStreet ≥ 0.6 on gakuen streets. todLook ≥ 0.6 near stations. seamBorrowRatio ≥ 2.5, so borrowing concentrates in seam bands.
- Dialects: the commercial district nearest the centre resolves to neon and the other to lantern. The two residential districts resolve to different dialects (cottage vs terrace). Both are shown in the district panel.
- Signatures: lumina has ≥ 12 (3 campus + ≥ 9 city); kivotos and academy-7 have ≥ 10. Recipes are unique, except water_mill ≤ 2. Spacing ≥ 90 m. sigCoverage = 1.0 on lumina, sigRailDemoted ≤ 1, sigHeightViolations = 0. None sits on a station-building, square, release or landmark lot. Each has a tier-1 'sig' POI whose why cites its site scores and style influence. Signatures ≥ 18 m tall are minor landmarks, and a signpost plate points to one within 220 m.
- Encounter and visibility: sigNear ≥ 0.80, sigReach ≥ 0.50, accentGap ≥ 0.85, archWow ≥ 0.878. landmarkVisible and spireVisible are each ≥ their {arch:0, same plan} value − 0.02.
- Rooftop gameplay under pitched crowns: rooftopEligible ≥ 0.9 × the {arch:0, same plan} count. At least 4 skybridges, with ≥ 1 used as a route edge. At least 1 redline natural entry. Compared with {arch:0, same plan}: secrets ≥ −5, key/gate pairs ≥ −1, and graffiti count within ±35%.
- Building-to-building relations: accents in [50, 130], with hinge, terminus, rowhead and square each > 0. No frame lot is taller than its signature's floors − 2, and no frame lot has a rooftop billboard. At least 10 row arcades are walkable at ground level. Each rival border that has a lot within 40 m has at least 1 fortified lot.
- Safety lints: glowLint = 0. sky_isles: consecutive gap ≤ 3.0 m, rise ≤ 1.6 m, XZ-disjoint. gravity_scar: debris pieces touch (gap ≤ 0.3 m) with rise ≤ 3.2 m. deckMerges = 0. No 'arch' entity is solid. No ramp crown sits on an elevated (pilotis or float) body.
- Sweep: `node tools/sweep.mjs` (15 seeds × density 0.85/1/1.2) runs with no exceptions. At most 1 seed has ringClosed false, and that seed logs the legacy-rail fallback. Per seed: gakuenCoverage ≥ 0.75, stations ≥ 4, mainShare ≤ 0.30, borderDhRatio ≤ 1.2, poiCoverage ≥ 0.95, landmarkVisible ≥ 0.85, deadEndCoverage = 1, secrets ≥ 40, buildings ≥ 400, signatures ≥ 8, rooftopRoutes ≥ 4, total ≤ 6000 ms.
- Package self-tests pass: `node tools/check-plan.mjs`, `node tools/check-fabric.mjs`, `node tools/check-arch-grammar.mjs` (plus --unit), `node tools/arch-check.mjs` (plus --unit), and `node tools/check-render.mjs` (plus --browser).
- Topdown screenshot: `node tools/headless.mjs lumina --png review/after/topdown.png --plan` shows a closed ring boulevard carrying the monorail. It shows 4–7 radials, each ending at a gate plaza on its campus axis, a core square or a park gate. Named streets run in accent colours from stations to gates and cores, a sepia old road runs from the river mouth along the river, and district colours fade across borders. The --style variant shows faction colours flowing along school roads.
- Browser screenshots: run `node tools/shot.mjs` with STEPS overlay:relation,overlay:arch,colormode:tier,close,view:trad_academy,view:commercial,view:ruins,view:harbor,view:residential,view:center and save to review/after/. They show: the monorail on a tree-lined median boulevard; taller clusters at stations; distinct roofscapes per district (spires, pagoda eaves, onion domes, vaults and sawtooth roofs, container stacks, mushroom caps); ≥ 8 identifiable signature silhouettes; floating isles around the spire; purpose-coloured flows, seam hatching and threshold rings in the relation overlay; and faction tendrils in the arch overlay. A gakuen street view shows continuous accent awnings, banners and an entrance arch, with the clock tower on axis. There is no z-fighting, no floating debris outside signatures, and zero console errors.
- Legacy look: with index.html?plan=0&arch=0#lumina, the central viewport crop (x 320–1090, y 70–880) of map.png differs from review/before/map.png in ≤ 0.5% of pixels.
- Inspector: clicking an ordinary building on a named street shows '왜 여기에?' with ≥ 2 relational clauses. It shows the relation block, whose '이 관계만 강조' button greys everything except entities with that rel. It shows the 건축 section: style chip and swatches, s2 share bar, tier badge, gene layers with '변이', the borrowing reason (including hard or soft edge), faction influence with geodesic distance, and grammar chips. A signature additionally shows site-score bars, rank and vista-yield status, and [시선축 보기] draws its axis.
- Explore: `node tools/test-explore.mjs` passes all legacy checks (ladder, roof landing, key→gate, secret pickup, mantle). It also passes: walking under a pilotis body; walking through a row arcade; the campus main-roof ladder reaching the fence vantage; and the '{street} · A → B' threshold banner firing exactly once per crossing, with no repeats while walking 60 m along a meandering border.
- Export and tools: `node tools/headless.mjs lumina --json out.json` writes schema 'academy-city/2'. It includes buildings[] (style, tier, footprint, crown, win, signature, cause, rel), entity fields fac/trim/band/bandMask/rel/cause, and a plan object (ring, radials, stations, squares, streets, relations, thresholds, oldRoads). headless prints 'cohesion:' and 'arch:' summaries: tier counts, crown histogram and signature list.
- Build: `node tools/build.mjs` succeeds. dist/academy-city.html is a single file whose only external URLs are the three.js CDN importmap and Google Fonts. No external assets are used.
- Ownership hygiene: no file was edited by more than one package. index.html and dist/* were regenerated by tools/build.mjs, not hand-edited. docs/DESIGN.md documents the new stages, rules and metrics.