# C2-signatures-urban: 시그니처 · 16 fantasy signatures, sky isles, arcades, skybridges, gateways/threshold markers, canopies, arch metrics & gate tool

Owns: ['src/core/signatures.js', 'src/core/archurban.js', 'src/core/archmetrics.js', 'tools/arch-check.mjs', 'tools/baseline/']
Reads: ['docs/specs/architecture.md', 'docs/specs/cohesion.md', 'src/core/archstyles.js', 'src/core/buildings.js', 'src/core/city.js', 'src/core/analysis.js', 'src/core/config.js', 'src/core/grid.js', 'src/core/rng.js', 'src/core/campus.js', 'src/core/intent.js', 'src/core/rail.js', 'src/core/generator.js', 'src/render/world.js']

## Interface
PROVIDES — FUNCTIONS
The lead wires these per plan_md §2. Each starts with a guard and returns when its inputs are missing.

signatures.js:
- SIGNATURES: 13 city recipes and 3 campus recipes, following the A§9.2 contract.
- chooseSignatureSites(ctx) — flow0, after C1's prepareArchitecture. Sets lot.signature, lot.sig, lot.sigMerged (crater lots), and the frames (lot.frameOf, lot.arch.floorsCap, lot.arch.noBillboard).
- buildSignatures(ctx) — buildings stage, after B's zoning. Creates the S-tier building records and parts, 'sig' POIs, minor landmarks, ctx.signatures, ctx.climbSites and ctx.sigSecrets. Scar lots get a rubble decal and lot.prog = 'scar'.
- buildCampusSignatures(ctx) — campus stage. Builds rose_cathedral, colossus_garage and organ_hall inside d.campus.special, and sets the special POI's building.
- Helpers: newSigBuilding(ctx, site, meta) and part(b, e).

archurban.js:
- genRowArcades(ctx) — end of the buildings stage. For each row in ctx.archRows with arcade, places an 'arch' entity every 3.2 m along the row front (solid:false), plus solid pier boxes at the joints. Rule arch.arcade.
- genArchUrban(ctx) — props stage, before genProps; runs when plan or arch is on. It calls:
  - genGateways: plan.thresholds markers and split-pier gateways (plan_md D4), or A§7.5 detection when ctx.plan is null;
  - arch only: genSkybridges (A§7.4);
  - arch only: genPlazaIsles (sky_isles);
  - arch only: genCanopies (A§7.6), which sets line.canopyDone, line.canopyStyle and line.laundry.
- canopyStyleOf(ctx, line).

archmetrics.js:
- archMetrics(ctx, opts = {}) returns the object for m.arch:
  - A§12 items 1–7. buckets is computed only if opts.bucketKey is given.
  - gateways and thresholdsMarked.
  - Interplay metrics:
    - styleFollowsStreet: the share of non-interior lots on a gakuen street, within 250 m walk of its gate, whose s1 or s2 equals the academy style;
    - heritageLook: the share of era-0 buildings with the heritage mod and a pitched or eaves crown;
    - todLook: the share of buildings on lots with walk.station < 110 that carry the modern mod;
    - seamBorrowRatio: borrowRate among lots with seamT < 0.6 ÷ borrowRate among lots with seamT ≥ 0.6.

tools/arch-check.mjs and tools/baseline/<seed>.json:
- Baseline format: {seed, metrics, timings, buckets, entities, sha1}, from commit e1661f2.
- sha1 is over live entities' shape, kind, cat, x, y, z, w, h, d, rot, rx, rz, color, solid and rule, rounded to 1e-3.

PROVIDES — DATA
- The plan_md §4.1 C2 ctx fields.
- lot.signature, sig, sigMerged, frameOf.
- lot.arch.floorsCap and noBillboard.
- b.tier 'S', b.signature, b.sig.
- Entities with sig and ref2. Skybridge decks have ref = A.id, ref2 = B.id, and are solid with deck set.
- POIs of type 'sig'.
- Threshold POIs: type micro, tier 2, rule meso.threshold, why containing both district names, with rel.
- Landmarks {minor:true, kind:'signature', sig}.
- line.canopyDone, canopyStyle, laundry.

CONSUMES — DATA
From C1:
- lot.F; lot.arch (w, s1, s2, t, tier, row); ctx.archRows; b.groundInset.
- Buildings built by makeBuilding (via lot.building).
- archstyles.js exports: STYLES, PIER, HYBRID_OK, IDENTITY_RANK, WIN, TIER_MAX, DECOR_MAX, LINT_PIN_HUES.
- buildings.js: decorate, faceInfo, lw, jitterColor, PROGRAMS.

From A:
- ctx.plan: thresholds, squares, stations.
- lot.stationBuilding, square, release, heritage.
- ctx.roadLine, ctx.roadFlow.

From B:
- Landmark lots (lot.landmark).
- city.addTree.
- ctx.roofGraph, for the rooftop metrics.
- ctx.rail: stations, obb, lines.

From D:
- Nothing. bucketKey arrives via opts.

## Instructions
YOUR JOB
You build the fantasy set pieces and the relations between buildings, and you own the arch quality gate. Everything you place has a structural reason recorded in its why.

READ FIRST
- plan_md, all of it — D4, D6, D11, D12, D13 and §4 matter most.
- architecture.md: A§6 (applyFrames), A§7.3–A§7.6, A§9 (all), A§12, A§13, A§14.
- cohesion.md: C§8 C3 (the marker table and the POI/why rules).

1. tools/arch-check.mjs — FIRST
- --baseline: extract commit e1661f2 with `git -C /home/user/academy-city archive e1661f2 src | tar -x -C <scratchpad>/legacy`, then write tools/baseline/{lumina,kivotos,academy-7}.json.
- Normal runs use the devpipe (plan_md §5):
  - {plan:false, arch:0} for parity;
  - arch:1 against arch:0 with the same plan setting, for the arch gates.
- --unit builds every recipe on synthetic sites.
- Print a JSON table and exit non-zero on failure.

2. signatures.js
chooseSignatureSites follows A§9.3, with these combined rules.

Candidates exclude:
- lot.landmark, lot.stationBuilding, lot.square, lot.release and lot.compress;
- interior lots, unless the recipe needs one (whale_market);
- heritage lots, except for water_mill and teapot_cafe.

Site rules:
- Tall recipes stay ≥ 40 m from station-front square centres.
- Anchors per A§9.3.1. Station-front squares also count as 'no tall' zones.
- Vista-yield and the height cap. For estimated floors, use district floors × skylineFactor, or a local estimate similar to plan heightFactor.
- Greedy pass with quotas and wow; coverage fill; records.

Then applyFrames (A§6):
- write lot.frameOf;
- lot.arch.floorsCap = max(1, sigFloors − 2);
- lot.arch.noBillboard.

gravity_scar crater merge: set lot.sigMerged = the seed lot id on merged lots.
Log arch.signature. Budget ≤ 60 ms.

   buildSignatures — for each lot.signature, build the recipe at that lot (site per A§9.1) using part().
   - Bodies use mat 'bld' or 'bldR', with fac and trim taken from STYLES and WIN, so the facade shader works.
   - You may call decorate(ctx, b, PROGRAMS[prog], rng, {…}) for door and sign, under the S cap.
   - One building record per signature (newSigBuilding), with lot = lot.id. Set lot.building.
   - A POI of type 'sig', tier 1, with a why citing the site scores and the style influence (see the A§9.3 example).
   - A minor landmark when the top is ≥ 18 m.
   - Climbable recipes push to ctx.climbSites (ladder:true, face, top).
   - memory, tag, treasure and view hooks push to ctx.sigSecrets.
   - Never call addSecret or addVantage yourself (D11).
   - Part budget ≤ 60.
   - Walkable floaters must be XZ-disjoint, with one deck per 1 m cell. Decorative floaters are solid:false.
   - Obey hMax.

   Implement all 13 city recipes: A§9.2 rows 2–13. Row 1 (the isles) lives in archurban.
   - First: lantern_tower, gacha_tower, teapot_cafe, book_tower, container_babel, witch_hat.
   - Then: whale_market, inverted_cottage, water_mill, gravity_scar, junk_fortress, gyro_observatory.

   buildCampusSignatures:
   - rose_cathedral (trad), colossus_garage (free) and organ_hall (arts), each inside d.campus.special.obb (C1 records it), oriented to its front.
   - Set the existing special POI's building.
   - organ_hall keeps the 'dominant silhouette', within 60 parts.

3. archurban.js
genRowArcades (A§7.3):
- Skip rows whose buildings were removed.

genGateways, per plan_md D4. For each plan threshold:
- Split-pier gateway (A§7.5 steps 4–5):
  - piers at ±(line.width/2 + 1.2) on SIDEWALK cells, nudged at most 2 m; if that fails, fall back to the type marker;
  - left pier = PIER[style(from)]; right pier = PIER[style(to)];
  - a two-tone lintel;
  - a nameplate in the owner's colour: '${A.name} · ${B.name}'.
- Otherwise, the C§8 C3 type marker for B's type:
  - commercial: neon arch '어서오세요 · ${B.name}';
  - residential: torii + map board;
  - academy: flagpoles;
  - harbor: anchor;
  - ruins: billboard + cones;
  - park: hedge gate;
  - center: pylons.
- Rival thresholds get the academy flagpole marker only, with POI '${B.short} 세력권'.
- Every marker:
  - ≤ 10 entities;
  - why '여기서부터 ${B.name} · ${seamName || rel.name}' (the gateway why follows A§7.5);
  - a tier-2 POI '${B.short} 입구', rule meso.threshold, with rel.
- style(x) = the most common lot.arch.s1 in the district, falling back to STYLE_OF.
- Arch-only mode: A§7.5 detection on level-1 lines, at most 10.

genSkybridges (A§7.4):
- Avoid rail track and stations, using ctx.rail.

genPlazaIsles (A§9.2 row 1):
- Keep clear of the rail spur, the central station and the bigscreens.
- The last island's vantage goes via ctx.climbSites {ladder:false}; its 'view' secret goes via ctx.sigSecrets.
- The under-glow oct #9dff6a is lint-safe.

genCanopies (A§7.6):
- canopyStyleOf = the majority lot.arch.s1 of lots within 3 m of the alley.
- neon and lantern strings, and arche light pipes, set line.canopyDone.
- cottage, terrace and relic set line.laundry = true.

Fork labels: 'arch-urban', 'isles', 'arcade'. genArchUrban ≤ 60 ms.

4. archmetrics.js
- A§12. Use 900 main-flow samples as metrics.js does, with lineOfSight from analysis.js.
- The interplay metrics in your contract.
- Tendrils: lines with approach === d.id.
- Rooftop numbers, read from ctx.roofGraph.
- Gateways and threshold markers.
- glowLint, floaterReach, deckMerges, acMax, archEnts.
- Budget ≤ 100 ms.

PARITY
- Every entry point returns immediately when its inputs are absent or params.arch === 0.
- Exception: when arch is 0 and plan is on, genArchUrban still builds the threshold markers.
- You never touch legacy files.

BUDGETS
- ≤ +1,700 live entities in total.
- ≤ 60 parts per signature.

FINAL REPORT
- Signature list on lumina, kivotos and academy-7: name@district, score, parts.
- Gateway and marker list.
- Arcade, skybridge and canopy counts.
- Timings.
- arch-check output.

## Self-test
Run `node tools/arch-check.mjs --unit`:
- Every recipe builds on a synthetic 30 × 24 m site without throwing; the campus recipes build on a synthetic special rect.
- ≤ 60 parts each.
- Decorative floaters are non-solid.
- sky_isles: consecutive gap ≤ 3.0 m, rise ≤ 1.6 m, XZ-disjoint.
- gravity_scar: debris pieces touch (gap ≤ 0.3 m), rise ≤ 3.2 m.
- No 'arch' shape is solid.
- glowLint 0.

Run `node tools/arch-check.mjs lumina kivotos academy-7` (devpipe):
- Parity: {plan:false, arch:0} against tools/baseline.
- At arch:1 — with plan on if A is available, and also with plan:false:
  - signatures ≥ 12 on lumina (3 campus + ≥ 9 city) and ≥ 10 elsewhere;
  - recipes unique (water_mill ≤ 2); spacing ≥ 90 m;
  - sigCoverage 1.0 on lumina; sigHeightViolations 0;
  - sigNear ≥ 0.80, sigReach ≥ 0.50, accentGap ≥ 0.85, archWow ≥ 0.878;
  - glowLint 0; deckMerges 0;
  - gateways ≥ 4, and thresholds ≥ 8 when plan is on; none on rival pairs; every pier on SIDEWALK;
  - skybridges ≥ 4; arcades ≥ 10 rows;
  - every sig POI is tier 1 with a why;
  - entities ≤ 24,000.
- Once B's intent integration is present, also run the remaining A§13 gates that depend only on data: visibility vs arch:0, rooftop, and intent invariants.
