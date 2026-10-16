# B-fabric: 도시 조직 · Zoning, squares, street dressing, territory, gameplay, rail/park, cohesion metrics

Owns: ['src/core/zoning.js', 'src/core/city.js', 'src/core/props.js', 'src/core/intent.js', 'src/core/rail.js', 'src/core/park.js', 'src/core/metrics.js', 'src/core/cohesionmetrics.js', 'tools/sweep.mjs', 'tools/check-fabric.mjs']
Reads: ['docs/specs/cohesion.md', 'docs/specs/architecture.md', 'src/core/config.js', 'src/core/buildings.js', 'src/core/blocks.js', 'src/core/analysis.js', 'src/core/grid.js', 'src/core/campus.js', 'src/core/generator.js', 'src/core/structure.js', 'src/core/streets.js', 'src/core/style.js', 'src/core/signatures.js', 'src/core/archurban.js']

## Interface
PROVIDES — FUNCTIONS

zoning.js (new):
- NEW_PROGRAMS: the 8 programs and threshold_plaza from C§4, verbatim. Merge them into buildings.PROGRAMS at module load, with Object.assign, only for keys not already present.
- TOD, PURPOSE_MULT, EKIMAE, HERITAGE (C§7 B4).
- STREET_ZONING (C§7 B3.4), plus a promenade entry for frontType PARK_PATH: [['cafe',3],['apartment', l => l.area>300?1.5:0]].
- SEAMS (C§8 C1) and seamKey(typeA, typeB).
- heightFactor(ctx, lot).
- buildToFor(ctx, lot) returns [min, max] or undefined.
- PURPOSE_KO.

city.js:
- Unchanged: buildHubs, markSpecialBlocks, genCenter, genContainerYard, genHarborFeatures, genCityBuildings.
- chooseLandmarkSites(ctx): adds plan axes and sets lot.axis.
- genCityBuildingsPlan(ctx): plan and/or arch zoning, in three passes.
- genSquares(ctx).
- vistaScore: now exported, otherwise unchanged.
- addTree(ctx, x, z, rng, district, rule, sakura, scale, canopy?): a canopy hex overrides the canopy colour; the default path is unchanged.
- addCar: unchanged.
- addPine(ctx, x, z, rng, district, rule, scale).

props.js:
- genProps(ctx) and buildOccupancy(ctx).
- addVending: unchanged.
- addBusStop(ctx, x, z, rot, rng, did, why, name?) returns entity ids. It is extracted from the existing code with the legacy call order and RNG use kept identical.

intent.js:
- genIntent(ctx) gains: relational signposts, the front line, placeRelationChains, arch rooftop substitution / skybridge edges / natural entries, consumption of climbSites and sigSecrets, and the ROAD.OLD exclusions.
- PACING: unchanged.

rail.js and park.js:
- genRail(ctx) and genPark(ctx).

metrics.js and cohesionmetrics.js:
- computeMetrics(ctx) gains m.cohesion when ctx.plan is set, m.scoreLegacy, and the minor/deleted landmark filter.
- computeCohesionMetrics(ctx) returns an object: the C§9 D5 fabric metrics, a copy of plan.stats, and the score.

PROVIDES — DATA
- lot.prog, source, seamKey, floors, building, axis, cause.
- b.cause, rel, ctxTags, street — passed through the makeBuilding spec.
- ctx.roofGraph {roofs, routes, bridgeEdges, naturalEntries}.
- ctx.chains.
- ctx.sigRailDemoted.
- Landmarks hit by rail get deleted = true.
- POIs with cause and rel.

CONSUMES — DATA ONLY
Never import helpers from A, C1 or C2.

From A:
- ctx.plan: squares, stations, streets, radials, ring, thresholds, relations, walk, nodes, stats.
- ctx.history, ctx.streetMask, ctx.roadLine, ctx.roadCost4, ctx.roadFlowP.
- lot.frontLine, frontType, street, spine, heritage, square, seamT, other, stationBuilding, release, compress, walk, fP, era.
- District persona fields.
- The config exports (after S1).

From C1:
- ctx.factionInf and ctx.factionDom grids.
- lot.arch: tier, floorsCap, noBillboard.
- makeBuilding's handling of spec.arch, street, ctxTags, cause, rel and roofStyle.
- footprintFromLot's 4th argument.
- decorate()'s handling of prog.lantern, chimney, awningColor and spec.street.

From C2:
- lot.signature, lot.sigMerged, lot.sig.prog, lot.frameOf.
- ctx.climbSites, ctx.sigSecrets, ctx.skybridges.
- line.canopyDone and line.laundry.
- roof.entry flags.
- Minor landmarks.

## Instructions
YOUR JOB
You turn A's skeleton into lived-in city fabric and gameplay. You are also the main caller of C1's makeBuilding. Guard all new behaviour so that {plan:false, arch:0} stays byte-identical; in that case the lead calls your legacy genCityBuildings.

READ FIRST
- plan_md, all of it — especially §1 D4–D12 and §4.
- docs/specs/cohesion.md: §4 (programs and NAMES), §6 A5–A7, §7 B3.3–B5, §8 C1, C3 (release plaza; the markers are C2's), C4, C5 consumers, C6, §9 D3–D5, and §12–§13.
- architecture.md: A§5.4 item 8, A§6 (frame effects), A§7.6–7.7, and A§10 (the rail, intent and metrics bullets).

1. zoning.js — start here
It is pure data plus two helpers. After A's S1 lands, import STREET_CHAR, PLAN and FACTIONS from config.
- heightFactor follows C§7 B4:
  - use the WS table; academy outer bands use 0.6;
  - inputs: lot.walk.station, plan.distSpine at the lot centre, ctx.distRiver, and plan.distPark4 sampled bilinearly;
  - cap at 1 for heritage lots.
- buildToFor picks the first that applies:
  1. STREET_CHAR[street kind];
  2. STREET_CHAR[lot.spine];
  3. STREET_CHAR.old, if lot.heritage;
  4. [0, 0.4], if lot.compress;
  5. otherwise undefined.

2. city.js — genCityBuildingsPlan(ctx)
One function covers plan on, arch on, or both.

Pre-pass:
- Skip lots with lot.signature or lot.sigMerged !== undefined; C2 builds them.
- Seed uniqueCount with `${d.id}:${lot.sig.prog}` for each signature lot.

Features:
- The legacy feat, plus dtype, fP (zeros if absent), walk, street kind, and flow (the legacy front sampling of ctx.roadFlow).
- hf = heightFactor when ctx.plan is set. Otherwise hf = 1 for ruins and harbor, else skylineFactor.

Pass 1a / 1b follows C§8 C1 exactly (cores, bands, seam and leak). Override priority:
1. release lot;
2. gate square → convenience, named '학원 앞 편의점';
3. stationBuilding → the EKIMAE override (D6);
4. heritage;
5. base table: ZONING × TOD × PURPOSE_MULT. On named streets mix it 0.3/0.7 with STREET_ZONING. Lots with frontType PARK_PATH use the promenade table.
Compressed lots: shophouse ×2 and +1 floor.
When ctx.plan is null (arch-only), use ZONING only, skip seams, streets and era, and set lot.era = 2.

Pass 2, in the plan_md D7 order:
1. Band floor blend.
2. Arch block clamp, for lot.arch?.tier === 'C': ±2 around the block median of C-tier floors.
3. Street wall (C§7 B3.5).
4. Height relaxation: PointHash 16, pairs within 25 m, ≤ 2.5×, 3 iterations. Exempt landmark, anchor and stationBuilding lots.
5. Axis view caps (C§7 B5): ≤ 3 lots per axis, cause '조망 보호 …'.
6. Frame caps: min(f, lot.arch.floorsCap).
7. Heritage cap: ≤ 3 floors.
Take lot.era from A, falling back to the C§8 C1 rule.

Pass 3, build:
- footprint = footprintFromLot(lot, P, rng, buildToFor(ctx, lot)).
- makeBuilding spec = the legacy fields, plus:
  - arch: lot.arch (undefined when absent);
  - street: lot.street >= 0 ? {kind, name, accent} : undefined;
  - ctxTags {era, street, seam: lot.seamKey, seamW: 0.5·(1−seamT), other, faction, heritage}, where faction is read from ctx.factionDom;
  - cause: ≤ 3 clauses in the C§8 C1 priority, always at least 1 (fall back to a {k:'district'} clause);
  - rel: the first clause's rel;
  - on era-0 house and old_shop lots: roofStyle 'gable' and roofColor = jitterColor('#4d5866', rng, 0.08);
  - color = the seam/leak lerp, ONLY when params.arch === 0.
- Station building: name '${station.name} 빌딩', floors ≥ round(7·hf).
- POIs as in legacy, plus cause and rel.
- Keep the legacy why string format and append the street/seam clause.

buildSpecialLot — add a 'threshold_plaza' case (the C§8 C3 release plaza):
- decal #d9cfbd;
- 4 benches in a ring of radius 3.5 m;
- a map board and 1 tree;
- a tier-2 POI '${B.short} 쉼터', rule meso.threshold, with cause and rel from the threshold.

buildLandmarkLot:
- The ferris mall gets arch: lot.arch ? {...lot.arch, tier:'A', crownLock:'flat'} : undefined.
- Landmark lots on an axis add the cause {k:'axis', t: …}.

chooseLandmarkSites:
- Leave the legacy branch untouched when !ctx.plan.
- The plan branch adds C§7 B5 axis scoring, where axes are the end segments of radial branches and named streets inside the district.
- Exclude lots with stationBuilding, square, release or compress.

genSquares(ctx):
- C§6 A6, fork 'squares', rule meso.station.
- Station back squares get only the decal here; rail adds the 2 gaado stalls.
- Uses addBusStop from props.js.

NAMES: add the C§4 entries. Invent entries for 문구점, 입시학원, 빵집, 하숙집 and 라이브하우스 in the same tone.

3. props.js (genProps)
- Extract addBusStop without changing the order or RNG use.
- On level-5 lines, replace lamps with stone lanterns every 18 m (C§8 C6).
- Banners after each lamp (C§7 B3.7):
  - the street accent from ctx.streetMask;
  - otherwise the faction accent DISTRICT_TYPES[type].accent, where ctx.factionDom.v ≥ 0.3;
  - at most 420 in total; rule micro.banner or micro.territory; carry rel.
- Street arches at the ends of gakuen, shotengai and market streets. Skip an arch if a post cell is occupied or it is within 12 m of a plan threshold.
- Covered shotengai roof over the first 80 m.
- Sakura every 10 m on gakuen and promenade streets.
- School-zone paint decals.
- Faction tree species via addTree canopy = FACTIONS[f].species:
  - f is the gakuen street's academy; otherwise dom where v ≥ 0.35;
  - for the free academy, place a bikerack box every 2nd slot instead (at most 40).
- Pines via addPine, every 16 m.
- Willows within 30 m of the river.
- Origin boats and a POI '청해 어촌 나루터'.
- The river sakura loop accepts PARK_PATH.
- Promenade benches every 24 m, facing the water (meso.promenade).
- Graffiti:
  - when ctx.factionInf?.free_academy exists, p = 0.75·inf at the building (1.0 for free-academy campus buildings), with why '레드라인 세력권 ${pct}%';
  - otherwise the exact legacy formula.
- Discipline posters: dom trad with v ≥ 0.3, p = 0.6·inf, at most 80, rule micro.territory.
- Laundry loop: run only when !line.canopyDone && (line.laundry ?? the legacy residential/ruins test).
- buildOccupancy: legacy shapes unchanged; add pyr, hip, mansard, vault and arch to the rotated-OBB set.

4. intent.js
ROAD.OLD:
- Add it to the carriageway exclusion lists (lines ~539 and ~636).

placeSignposts, per plan_md D10:
- Plate 2 in plan mode: '${station.name} ${m}m', with m = plan.walk.station at the post.
- Plate 3: '→ ${street.name}' if the node is on a named street's mask; otherwise '→ ${district across nearest threshold}'.
- The minor-landmark plate (#b05cd8) when arch is on.
- Pole height 3.9 m when there are 4 plates.
- Landmark targets filter !minor && !deleted.

placeBorders:
- Plan mode: the C§8 C5 front line. Run a 4 m Dijkstra on ctx.roadCost4 between the two gate plazas, and place the checkpoint where inflA − inflB (from ctx.factionInf) changes sign; use the path midpoint if the field is absent.
- Then add at most 2 legacy raster crossings, restricted to spine or named-street cells.
- Leave the legacy branch unchanged.

placeRelationChains (C§9 D4), after placeHiddenSecrets:
- Generalise placeGateAt(ctx, rng, lot, gx, gz, dir, gk, why, width, td, opts = {keyDistrict, range, nearHash, rule, rel}).
- gates2 total ≤ 7.
- Write ctx.chains.

placeRooftopRoutes, when params.arch !== 0:
- Roof substitution (A§10).
- ctx.skybridges become pre-connected 'bridge' edges.
- Natural entries: roof.entry means no ladder.
- Record ctx.roofGraph {roofs, routes, bridgeEdges, naturalEntries}.
- With arch off, keep the legacy behaviour.

placeClimbables:
- Loop over ctx.climbSites: a ladder on the face when ladder is true, a vantage at top, and a 'view' secret when top > 15.

Also:
- Add every ctx.sigSecrets entry through addSecret, with the reveal as given.
- whale_market lots are not courtyards, so placeGates skips them naturally.

5. rail.js (C§6 A5 + A§10)
Ring rail when plan.ring.closed && stations ≥ 3:
- track on ring.pts, spur on the spur trunk;
- plan stations, with platform, canopy and ramps on the n side;
- s.foot = the front square centre;
- 2 gaado stalls per back square, via makeBuilding with prog gaado and rule meso.station.
Otherwise: the legacy loop, with the plan station list when ctx.plan is set.

Clearance:
- Gaado conversion passes arch: b.arch ? {...b.arch, tier:'D', crownLock:'flat'} : undefined.
- A hit signature (b.signature) is rebuilt as gaado; its minor landmark gets deleted = true; increment ctx.sigRailDemoted; log arch.signature.

Legacy behaviour is identical when !ctx.plan and there is no b.arch or b.signature.

6. park.js (C§6 A7)
- Sacred hill, lake angle, entry node 0 plus its fixed edge, vermilion torii, and the hill's why.

7. metrics.js and cohesionmetrics.js
metrics.js:
- landmarkVisible skips l.minor and l.deleted.
- roadKm gets key 5 only when it is > 0.
- Rule counts for the new macro rules: macro.ring = 1 or 0; macro.radial = radials; macro.oldroad = old-road lines; macro.relation = edges; meso.street = streets.
- When ctx.plan is set: m.cohesion = computeCohesionMetrics(ctx); m.scoreLegacy = the legacy formula; m.score = 0.85·scoreLegacy + 0.15·cohesion.score.
- Otherwise m.score is unchanged.
- Leave a marked comment '// LEAD: archMetrics + drawBuckets' where the lead will add 3 lines.

cohesionmetrics.js — use the C§9 D5 definitions over live non-campus buildings with lot ≥ 0:
- stationUplift, borderDhRatio, borderGridAngle, borderProgramJS, corePurity;
- districtIdentityMin, excluding signature and landmark lots;
- releasePlazas, heritageFrontShare, namedStreetPoiShare, chains;
- causeCoverage, causeMaxClauses;
- a copy of plan.stats, and the score.

8. tools/sweep.mjs
- The 15 C§2 seeds × the density cycle.
- Print one line per seed: time, buildings, secrets, coverage, landmark, rooftop, ringClosed, stations, gakuen, mainShare, borderDh, signatures (m.arch?.signatures), entities.
- Apply the guards from the acceptance list and exit non-zero on failure.

PARITY RULES
- Never change genCityBuildings, genCenter, genContainerYard, genHarborFeatures or markSpecialBlocks.
- Every changed function branches at the top on ctx.plan, params.arch or data presence.
- Keep the RNG call order of legacy paths.

BUDGETS
- Buildings-stage zoning ≤ 120 ms.
- props, B's part ≤ 110 ms.
- intent ≤ 460 ms.
- metrics ≤ 160 ms in total.
- B adds ≤ 2,800 live entities; count them by rule in check-fabric.

FINAL REPORT
- Fields read and written.
- Entity counts by rule.
- Timings.
- check-fabric and sweep output.
- Any contract gaps you had to guard.

## Self-test
Run `node tools/check-fabric.mjs`. It uses the devpipe from plan_md §5.

1) Parity. devGenerate('lumina', {plan:false, arch:0}) must deep-equal the legacy reference on every legacy metrics key, with 12722 live entities. The reference is tools/baseline/lumina.json if present; otherwise git archive e1661f2 into your scratchpad.

2) If A's plan is available, run devGenerate('lumina', {arch:0}) and check:
- stationUplift ≥ 1.35.
- borderDhRatio ≤ 1.12; borderGridAngle ≤ 14; borderProgramJS in [0.25, 0.55].
- corePurity ≥ 0.9; districtIdentityMin ≥ 0.6.
- releasePlazas ≥ 5; heritageFrontShare ≥ 0.6.
- ≥ 90% of buildings have 1–3 cause clauses.
- All stationFront-square lots carry a 'station' clause; all named-street lots carry a 'street' clause.
- namedStreetPoiShare ≥ 0.30.
- chains ≥ 2, with key and lock in different districts and the key ≤ 25 m from the polyline.
- One front-line checkpoint per rival pair.
- The world tree stands at history.sacred.
- banners ≤ 420; posters ≤ 80.
- B-added live entities ≤ 2,800.
- Legacy guards: poiCoverage 1, poiGapMax ≤ 48, landmarkVisible ≥ 0.95, spireVisible ≥ 0.85, deadEndCoverage 1, secrets ≥ 80, crumbCoverage ≥ 0.8, scoreLegacy ≥ 0.93.
- entities ≤ 15,500.
If the plan is unavailable, print 'plan unavailable' and run only check (1) plus the arch:0 legacy-path smoke test.

3) If C1 and C2 are available, run devGenerate('lumina') and check:
- No lot has two buildings.
- Signature lots are not zoned.
- Frame caps and the C-tier block clamp hold.
- rooftopRoutes ≥ 6; roofGraph.bridgeEdges ≥ 1; naturalEntries ≥ 1.
- Every ctx.climbSites entry produced a vantage.
- Every sigSecret became a secret.

4) `node tools/sweep.mjs` runs without exceptions.
