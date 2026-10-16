# C1-style-grammar: 건축 양식장 · Style field, faction influence, component grammar (makeBuilding), campus styles

Owns: ['src/core/archstyles.js', 'src/core/influence.js', 'src/core/style.js', 'src/core/archgrammar.js', 'src/core/buildings.js', 'src/core/campus.js', 'src/core/collision.js', 'tools/check-arch-grammar.mjs']
Reads: ['docs/specs/architecture.md', 'docs/specs/cohesion.md', 'src/core/config.js', 'src/core/grid.js', 'src/core/rng.js', 'src/core/city.js', 'src/core/blocks.js', 'src/core/analysis.js', 'src/core/roads.js', 'src/core/intent.js', 'src/core/rail.js', 'src/render/world.js', 'src/core/generator.js']

## Interface
PROVIDES — MODULES AND FUNCTIONS

archstyles.js — S2, first. Data only; export names are frozen.
- STYLES {key: {key, name, walls[], trim, roofs[], win {patternName: weight}, floorH, bay, flags, lit, footprints {rect, L, round, oct}, ops {}, crowns {crownName: weight}, flatMin, attach {}, accent {hinge, terminus}, canopy, arcadeProb, routeDistrict}}.
  - Keys: halo, neon, lantern, cottage, terrace, lumiere, arche, redline, stella, tide, grove, plus the relic modifier (A§4).
- CROWNS {name: {walk: bool or 'ring', centre: bool}}.
- WIN {grid:8, lancet:1, ribbon:2, porthole:3, lattice:4, sparse:5, curtain:6, 'round-arch':7}.
- HYBRID_OK: a Set of sorted 'a|b' strings.
- IDENTITY_RANK.
- PIER {style: [≤ 4 parts {shape, dx, dy, dz, w, h, d, rx?, rz?, color, mat?, solid?}]}.
  - color is 'trim', 'wall', 'roof' or a '#hex'.
  - Parts are in a pier-local frame: x along the road tangent, z outward, y up.
- TIER_MAX {S:60, A:14, C:6, D:2}.
- DECOR_MAX {S:6, A:8, C:8, D:4}.
- LINT_PIN_HUES.
- FACTION_A = 0.9.
- CIVIC = {A:0.7, L:150, r0:62}.
- STYLE_OF {districtType: style, or [nearCentre, far], or [dry, wet]}.
- STREET_STYLE:
  - gakuen {factionBoost: 0.6}
  - shotengai {add: {neon: .35, lantern: .35}, arcadeBonus: .35}
  - market {add: {lantern: .4, tide: .4}}
  - promenade {add: {terrace: .6}}
  - ring {add: {halo: .25}, flatMinBonus: .15}
  - radial {add: {halo: .15}}
  - old {mods: ['heritage']}
- ERA_MODS {0: ['heritage'], 2: [], 3: ['modern']}.
- MODS:
  - heritage: {walls: ['#e8dcc4','#d9c7a3','#cdb48c'], trim: '#5a4632', roofs: ['#4d5866'], win: {lattice:1}, crowns: {gable:3, hip:2, eaves:1}, floorsMax: 3, attach: {lanternRow:2}}
  - modern: {win: {curtain:.6, ribbon:.4}, attach: {lightstrip:3}, crownsAdd: {'halo-ring':1}, lit: .35}
- STYLE_LIST [{key, name, swatch: [4 hex], roof, accent}].

influence.js:
- computeFactionField(ctx) sets ctx.factionInf and ctx.factionDom (plan_md D3).
- inflAt(ctx, type, x, z).
- domAt(ctx, x, z) returns {faction, v}.

style.js:
- prepareArchitecture(ctx) sets d.styleKey, d.style, d.dialect, lot.F, lot.arch, ctx.archRows and ctx.archStyleList. lot.arch is the plan_md §4.4 payload except accent, floorsCap and noBillboard.
- finalizeArchitecture(ctx) updates lot.arch.accent, accentFace and tier, and sets ctx.archBudget and ctx.archSummary. It logs arch.style, arch.dialect, arch.field, arch.block, arch.borrow and arch.tier.

archgrammar.js:
- buildArchitecture(ctx, b, spec, prog, rng) pushes the body, crown, attachment and accent entities, fills b.roofs, and fills the b bookkeeping fields.

buildings.js:
- makeBuilding(ctx, spec, rng): new arch branch; the legacy branch stays byte-identical.
- export decorate(ctx, b, prog, rng, spec).
- footprintFromLot(lot, prog, rng, buildTo?).
- PROGRAMS, ZONING, jitterColor, skylineFactor, lw, faceInfo and obbFromLocal are unchanged.

campus.js:
- genCampuses(ctx) passes arch specs.
- When arch is on, for trad, free and arts it records d.campus.special = {rect: {u0,u1,v0,v1}, obb: {x,z,w,d,rot}, front, name, type, style, poi} and leaves the building to C2.

collision.js:
- The round set and the new OBB shapes.

PROVIDES — DATA
- Entity facade fields fac, trim, lit, band and bandMask on every grammar body (mat bld or bldR).
- The building record fields of plan_md §4.4.
- Roof flags walk, pitched, entry, round and terrace.
- groundInset recess: tier 0 is recessed 2.4 m on the front face, and the upper tiers start at y = fh as elevated bodies.

CONSUMES — DATA
From A:
- lot.seamT, other, street, spine, heritage, era, square, stationBuilding.
- ctx.plan.streets and ctx.plan.squares.
- ctx.roadCost4. If it is absent, rebuild the same cost locally from ctx.road.
- line.approach, ctx.nodes.
- FACTIONS and RIVALS from config.

From B:
- The spec fields arch, street, ctxTags, cause, rel, roofStyle, roofColor and lot.
- buildTo.

From C2:
- lot.signature, lot.frameOf and lot.sigMerged — these are excluded from accents.
- lot.arch.floorsCap and noBillboard, which C2 writes before finalizeArchitecture runs.

## Instructions
YOUR JOB
You make buildings look different for a reason.
- Style comes from context: the faction road field, street character, era, the seam band, and node importance.
- A component grammar inside makeBuilding renders it.
- With arch off (params.arch === 0), output must be byte-identical to legacy.

READ FIRST
- plan_md, all of it. D3, D5–D9, D13–D14 and §4 are yours to implement.
- architecture.md: A§0, A§4, A§5, A§6 (accents, budget, decorate caps), A§7.1–7.3, A§8 (all), the campus and collision bullets of A§10, and A§11.2 (only for what fac, trim and band mean).
- cohesion.md: C§4 (decorate cases), C§7 B3.3 and B3.6, C§10.

1. archstyles.js — FIRST (S2)
- Encode the A§4 table faithfully as data: palettes, trims, roof colours, window weights, floorH, bay, flags, footprints, ops, crowns with walkability, flatMin, attachments, accents, canopy, and pier recipes.
- arcadeProb: lantern .35, lumiere .25, halo .30.
- Add the combined tables listed in the contract.
- Small glow colours must be lint-safe (the A§4 allowed set).
- STYLE_LIST Korean names: 헤일로 신고전, 네온 적층, 등롱 바자르, 지붕 마을, 물길 테라스, 장미 고딕, 에테르 기계, 고철 펑크, 성좌 오페라, 청해 부두, 숲의 정자, 옛 루미나.

2. influence.js — computeFactionField (plan_md D3)
- One 4 m Dijkstra per academy, with srcDist.
- Off-road dilation.
- Campus cells set to 1.
- dom and v grids.
- All four academies together ≤ 40 ms.

3. style.js — prepareArchitecture
(a) assignDialects, generalised from A§4.1:
- The commercial district nearest the centre is neon; the others are lantern.
- The wettest residential district is terrace; the others are cottage. Keep the A§4.1 tie rule.
- Set d.styleKey, d.style and d.dialect.

(b) computeLotFeatures, per A§5.1 (about 25 ms):
- F.front comes from faceInfo(lot, lot.front).
- Interior lots use the block's nearest passage, or the lot centre.
- F.rivalDir = the unit vector toward the rival border hit.

(c) computeLotStyles: A§5.3 with the combined context.
- base(district) comes from STYLE_OF plus the dialect.
- The soft-edge term uses lot.seamT and lot.other when present (D5); otherwise the A§5.3 dB term. It never applies across F.hard edges or rival pairs.
- Faction term: 0.9·inf, skipping rival districts. Add STREET_STYLE.gakuen.factionBoost for lots on a gakuen street of that academy (plan.streets[lot.street].academy).
- Add STREET_STYLE.add by the lot's street kind or lot.spine.
- The civic halo term.
- mods = ERA_MODS[lot.era], plus STREET_STYLE.old.mods if lot.heritage, plus ['modern'] for lot.stationBuilding.
- Ruins → decay + ghost.
- Campus-zone lots and purity specs → t = 0.
- fort = F.rivalB ≤ 40.

(d) assignBlockGenes, per A§5.4 items 1–7:
- block style and the majority filter;
- block gene with the flatMin quota and the route-district walkable guard;
- the shared u_B thresholds;
- single-layer mutation with p = .35;
- the borrowing ladder, using HYBRID_OK for crown and body;
- rows with palettePair and arcade. Arcade rows set lot.arch.groundInset = 2.4, plus row and rowIdx.

Write lot.arch (the plan_md §4.4 payload) with a Korean why string, for example '루미에르 영향 0.42 (정문에서 도로거리 160m) · 경계 차용: 왕관'. Build ctx.archStyleList from STYLE_LIST.

   finalizeArchitecture — runs after C2's chooseSignatureSites:
   chooseAccents (A§6):
   - terminus where F.axis ≥ 90;
   - hinge per node with mainCount ≥ 1;
   - rowhead;
   - accent 'square' for lot.stationBuilding, with tier A and crownLock 'flat'.
   - Exclude signature, frameOf, sigMerged, landmark and interior lots.
   - Quota per district: round(0.12·nBuildingsEst_d·wow), minimum 2.
   - Apply the A§6 spacing rules.
   applyBudget (A§6):
   - cap 9500; demote C → D in ascending F.flow.
   Tier D also applies to interior lots, area < 60 m², shed and gaado.
   Write the logs.

4. archgrammar.js — buildArchitecture (A§8)
resolveKit:
- Slots resolve to style A or B.
- The relic decay is applied last.
- MODS overrides are applied last of all:
  - heritage forces lattice windows and a gable, hip or eaves crown; when spec.roofStyle === 'gable' it uses spec.roofColor; floors ≤ 3;
  - modern forces curtain or ribbon windows, plus a lightstrip.

Footprints:
- rect; L; round = cyl + bldR; oct = cyl8 + bldR.
- formal → rect or L only.
- Massing hints weight the choice ×3.

planTiers and operators:
- taper, setback.
- cantilever — stays inside the lot envelope, taken from ctx.lots[spec.lot] minus 0.3 m.
- stackJitter.
- pilotis — arche only; no ramp crowns on elevated bodies.
- eaves, terrace, addon, podium.
- float — tiers S and A only.

Crowns, per A§8.5:
- Set r.walk and r.pitched.
- Honour crownLock.
- Centre crowns suppress the roof props.

Attachments:
- Chosen by face rank, in priority order under the tier budget.
- TIER_MAX counts bodies + crown + attachments + accent.

Accents, fort and recess:
- Accents follow A§7.1 and the A§4 accent column.
- Fort merlons and banner (A§7.2) face F.rivalDir.
- groundInset recess (A§7.3): the tier-0 body is recessed 2.4 m on the front face, and the rest of the building starts at y = fh.

Entity fields:
- Every body gets fac [WIN id, fh, bay, flags], trim and lit.
- Tier-0 bodies of shop programs also get band = PROGRAMS[prog].color and bandMask (bit k set when b.sides[k] ≥ 3).
- Crown, attachment and accent entities carry rule arch.grammar, arch.corner, arch.terminus, arch.rival or arch.arcade, plus a why.
- Bodies keep spec.rule.
- 'arch' shapes are never solid.
- Fill b.footprint, ops, crown, win, grammar, tier and arch.

5. buildings.js
makeBuilding:
- arch = ctx.params.arch !== 0 && spec.arch.
- The arch branch calls buildArchitecture(ctx, b, spec, prog, rng.fork('arch')).
- The legacy branch is untouched.
- Always copy spec.cause, rel, ctxTags and street onto b. This is undefined-safe and changes no entity.

decorate (now exported). It is unchanged when !b.arch, except for these data-driven cases, which never trigger for legacy programs or specs:
- prog.lantern: a red glow sphere, 0.6 m, beside the door at y 2.2.
- prog.chimney: a cylinder 1.2 × chimney at the back corner.
- prog.awningColor: overrides the awning colour.
- spec.street with STREET_CHAR awning 'continuous': an awning in the street accent plus a band sign, even if the program has none, when the front face is longer than 3 m.
- gakuen posters: 1–2 glow boxes 0.05 × 0.8 × 0.6, rule micro.poster.

Arch caps (A§6):
- facade ≤ 4; AC ≤ 2 per building in total; roof props ≤ 3 (5 for tier A).
- noBillboard.
- groundInset: put the door on the recessed face, no awning, sign at fh + 0.3.
- Roof style comes from the kit.
- S-tier decorate ≤ 6 (C2 calls decorate for signatures).

footprintFromLot(lot, prog, rng, buildTo):
- If k === front && buildTo, use buildTo as the range. The number of rng calls stays the same.

6. campus.js (A§10)
- FACTION_STYLE comes from FACTIONS.
- When arch is on, every makeBuilding call gets arch {s1: style, s2: style, t: 0, purity: 1, formal: true, tier, crownLock, decay, ghost, mods: []}.
- Main building: tier A, crownLock 'flat', roof 'school'.
- Wings, club, cafeteria, dorm and gym follow the style.
- Old school: decay + ghost.
- Tech special: the formal tier-A recipe — a cyl8 curtain body, 3 halo rings and the existing dish.
- Trad, free and arts specials: do not build them. Record d.campus.special and keep its POI, paths and hubs; C2 fills in the POI's building later.
- Skip it.dome and chapelspire when arch is on.
- With arch off, byte-identical.

7. collision.js
- Add dome, onion, frus and cyl8 to the round set.
- Treat pyr, hip, mansard and vault as OBBs.
- Skip non-solid entities, as today.

8. tools/check-arch-grammar.mjs — see self_test.

PARITY
- With arch off, these are identical: makeBuilding, decorate, footprintFromLot without buildTo, and campus.
- In arch paths use only fork-based RNG: lot.rng.fork('arch'), ctx.rng.fork('arch:b'+blockId), ctx.rng.fork('arch-style').

BUDGETS
- flow0, C1's part (faction + prepare + finalize) ≤ 120 ms.
- Grammar overhead in the buildings stage ≤ 200 ms.
- building + roof + facade ≤ 9,500 live entities.
- Tier part maxima hold.
- ≤ 2 AC units per building.

FINAL REPORT
- Fields written and read.
- Style and crown histograms on lumina.
- Timings.
- Check output.
- Any contract gap you guarded.

## Self-test
Run `node tools/check-arch-grammar.mjs --unit`.
- In a minimal ctx (createContext, empty arrays, a few synthetic lots), build every style × footprint × crown × tier with makeBuilding. Also cover the heritage and modern mods, groundInset, pilotis and fort.
- Assert:
  - nothing throws;
  - part counts ≤ TIER_MAX;
  - every bld/bldR body has fac, trim and lit;
  - no 'arch' entity is solid;
  - no ramp crown sits on a body with y > 0.6;
  - roofs are flagged correctly.
- Legacy parity: for 300 random legacy specs (spec.arch undefined), the entity list equals the one produced by the e1661f2 buildings.js. Extract that file with git archive into the scratchpad and import it.

Run `node tools/check-arch-grammar.mjs lumina`. It uses the devpipe; plan is on if A is available, otherwise plan:false.
- Parity at arch:0 against the reference.
- At arch:1, compute these yourself or import archmetrics.js if it exists:
  - archEntropy ≥ 3.5; silhouetteKinds ≥ 14; crownKindsMin ≥ 3; nonFlatCrownShare 0.25–0.50.
  - styleSalt ≤ 0.05; blockCoherence ≥ 0.85; borrowRate 0.04–0.20; hardBorrow 0; archDistinct ≥ 12.
  - tendril ≥ 2.0 for each academy.
  - the dialect rule (D16).
  - accents 50–130, with hinge, terminus and rowhead each > 0.
  - AC ≤ 2 per building.
  - building + roof + facade ≤ 9,500.
- With plan on: styleFollowsStreet ≥ 0.6, heritageLook ≥ 0.8, todLook ≥ 0.6 and seamBorrowRatio ≥ 2.5. The definitions are in C2's contract.
- flow0, C1's part ≤ 120 ms.
- Write a --style PNG of lot styles to the scratchpad and eyeball it.
