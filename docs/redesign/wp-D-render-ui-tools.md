# D-render-ui-tools: 렌더 · UI · 도구 — geometries, facade shader, overlays, inspector, explore banners, export, headless/shot/test tools

Owns: ['src/core/render-keys.js', 'src/core/export.js', 'src/render/world.js', 'src/render/ground.js', 'src/render/labels.js', 'src/main.js', 'src/app.html', 'src/game/explore.js', 'tools/headless.mjs', 'tools/shot.mjs', 'tools/test-explore.mjs', 'tools/check-render.mjs']
Reads: ['docs/specs/architecture.md', 'docs/specs/cohesion.md', 'src/core/config.js', 'src/core/buildings.js', 'src/core/generator.js', 'src/core/collision.js', 'src/core/grid.js', 'tools/build.mjs', 'review/before/map.png', 'index.html']

## Interface
PROVIDES

src/core/render-keys.js (no three import):
- GROUP_OF.
- shapeKey(e): cone with sides 4 or 6 → cone4 or cone6; otherwise e.shape.
- bucketKey(e) = `${GROUP_OF[e.cat] || 'prop'}|${shapeKey(e)}|${e.mat || 'std'}`.
- ROUND_SHAPES, OBB_SHAPES.
- footprintOf(e) returns {x, z, w, d, rot, round}.

world.js:
- makeGeometries() adds dome, onion, frus, cyl8, pyr, hip, mansard, vault and arch, per A§11.1.
- makeMaterials() adds bldR.
- buildWorldMeshes: bld and bldR buckets clone their geometry and add the aFac, aTrim and aBand instanced attributes. The defaults reproduce legacy pixels.
- applyColors(ctx, world, {mode: 'style' | 'use' | 'tier', pred}).
- highlightRule(ctx, world, ruleOrPred): takes a rule string or a predicate; a wrapper over applyColors.
- entityMatrix, hideEntity, showEntity and LAYER_GROUPS are unchanged.

ground.js:
- paintGround:
  - ROAD.OLD in colour #c8b597, with a 0.4 m #9c8a6e kerb along level-5 lines;
  - seam blend from ctx.districtColor for city land cells that are not road, campus or park.
- paintOverlay(ctx, kind) gains two kinds: 'relation' (C§9 D2) and 'arch' (A§11.5).
- makeCanvas.

main.js:
- URL params ?plan=0|1&arch=0|1&wow=x. The hash is still the seed.
- Generate-bar selects: 골격 (계획 / 레거시) and 건축 (판타지 / 레거시).
- Inspector:
  - the cause chain;
  - a relation block with '이 관계만 강조';
  - a 건축 section and a signature panel, with the buttons [같은 양식 강조], [이 위계만 강조] and [시선축 보기].
- Colour-mode toggle — 건물 색: 양식 / 용도 / 위계.
- Rule group arch: '건축 · 양식과 위계'.
- Labels: named streets, old roads, station-front squares, and minor landmarks (cls 'sig').
- poiTypeKo('sig') = '시그니처'.
- District list with relName/story and style/dialect.
- Metrics groups '유기성' and '건축'.
- districtBanner(d, {via, from}).

explore.js:
- A threshold banner when the player comes within 8 m of a new threshold.
- 25 m hysteresis for plain district changes.

export.js — schema 'academy-city/2':
- entities gain fac, trim, lit, band, bandMask, sig, ref2, rel and cause;
- buildings[] {id, prog, label, district, tier, style {s1, s2, t, slots, decay, mods}, footprint, ops, crown, win, signature, accent, cause, rel, ents};
- plan {ring, radials, stations, squares, streets, relations, thresholds, oldRoads};
- shape notes for the 9 new shapes.

tools:
- headless.mjs: --param k=v (repeatable), --plan overlay PNG, --style PNG, round shapes drawn as discs, the OLD road colour, the seam blend, 'cohesion:' and 'arch:' summaries, and --json via export v2.
- shot.mjs: STEPS tokens overlay:<kind>, colormode:<mode>, view:<type>[:k], close[:type], explore, secret, notes and panel. The URL may carry ?plan and &arch.
- test-explore.mjs: the new checks.
- check-render.mjs.

CONSUMES — DATA ONLY
- Everything in plan_md §4:
  - ctx.plan, ctx.history, ctx.districtColor, ctx.seamMargin, ctx.flowP;
  - ctx.factionInf, ctx.factionDom, ctx.archStyleList, ctx.archSummary;
  - ctx.signatures, ctx.gateways, ctx.skybridges;
  - lot.arch, F, sig, signature;
  - the b.* arch and cause fields;
  - entity facade fields, POI types, and landmarks.minor.
- Config exports (after S1): ROAD.OLD, PURPOSE_COLORS, RELATION_KINDS, SHORT.
- buildings.PROGRAMS.
- Never import archstyles, style or signatures. Read ctx.archStyleList instead.

## Instructions
YOUR JOB
You make every new idea visible and explainable. You also keep the legacy look pixel-identical when plan=0 and arch=0.

READ FIRST
- plan_md, all of it — D14 (window ids), D17 (the build rule) and §4.5 matter most.
- architecture.md: A§11 (all), the headless bullets of A§13, and the browser budget in A§14.
- cohesion.md: C§6 A4 (OLD plumbing), C§8 C2–C3 (ground blend, explore banners), C§9 D1–D2, and the C§12 tool changes.

1. render-keys.js
- Write it, then switch world.js to import GROUP_OF and shapeKey from it. Behaviour stays identical.

2. world.js
Geometries, per A§11.1:
- unit base at y = 0;
- vault axis along local x;
- arch = an extruded Shape with the opening across local x.

Facade shader, per A§11.2:
- Clone the geometry per bucket for mat bld and bldR, and add aFac, aTrim and aBand.
- Defaults are (0, 3.2, 2.6, 0), (0, 0, 0, 0) and (0, 0, 0, 0). These select pattern 0, the exact legacy maths.
- Patterns 1–7 follow A§11.2.
- Pattern 8 is a parametric grid: the legacy grid mask, using gy/fh and along/bay.
- Implement the flags, the use band and the emissive lit term.
- mats.bldR uses defines {ROUND: ''} and customProgramCacheKey 'bld-round'.

Colours and highlight:
- applyColors, plus the predicate highlight.
- The C§9 D1 relation predicate is: e => (e.rel ?? (e.ref >= 0 ? ctx.buildings[e.ref].rel : undefined)) === id.
- Set colours from hex strings via THREE.Color.
- Log the bucket count with console.debug only.

3. ground.js
- OLD road colour and kerb.
- Seam blend: sample ctx.districtColor bilinearly for city land cells that are not road, campus or park; use the legacy dcol otherwise.
- paintOverlay 'relation':
  - seam hatch where smoothstep(0, 64, ctx.seamMargin) < 0.6;
  - purpose flow from ctx.flow and ctx.flowP, using PURPOSE_COLORS;
  - spines from ctx.roadLine and line.spine;
  - the old road;
  - named streets in their accent;
  - squares in white;
  - thresholds as red arc rings.
- paintOverlay 'arch':
  - lot OBBs in the s1 swatch colour from ctx.archStyleList, at 45% alpha;
  - an s2 hatch on borrowed lots;
  - faction tendrils on road cells where max ctx.factionInf ≥ 0.25, coloured by the DISTRICT_TYPES accent;
  - gateway marks;
  - 170 m rings around ctx.signatures.
- No 'line' decal (P6 is cut).

4. src/app.html (and labels.js only if needed)
Controls:
- Overlay buttons data-overlay='relation' (관계) and data-overlay='arch' (건축 양식), with legends lg-relation and lg-arch.
- The colour-mode segmented toggle.
- The generate-bar selects.

CSS:
- .lbl.street: an italic pill with an accent border.
- .lbl.sig.
- Inspector styles for: the cause list, style chips, swatches, the t bar, the tier badge, gene layers ('변이'), borrowing rows, faction bars, grammar chips, and signature score bars.

Keep the existing light/dark tokens and layout. Everything must still fit at 1440×900 and at phone width.

5. main.js
- Params from the URL and the selects → generate(seed, cb, params) and re-generate.
- Inspector (C§9 D1 + A§11.4):
  - building = ctx.buildings[e.ref]; lot = ctx.lots[b.lot];
  - the relation block comes from ctx.plan.relations.edges;
  - [시선축 보기] draws a pink THREE.Line from the lot front, along lot.F.axisDir, for lot.F.axis metres.
- Labels (C§9 D2 + A§11.5).
- District list.
- Metrics panel groups, shown only when m.cohesion or m.arch exists:
  - 유기성: 환상선 폐합, 역세권 상승비, 경계 높이차비, 경계 격자각, 경계 용도 JS, 통학로 수, 문턱 수;
  - 건축: 엔트로피, 실루엣 종류, 시그니처, 시그니처 조우율, 차용률, 관문, 구름다리.
- districtBanner(d, opts): when opts is given, show '{via} · {A.short} → {B.name}' and d.story.
- Every new UI path must tolerate missing data (legacy params).

6. explore.js
Replace the instant district banner with:
(a) if ctx.plan?.thresholds exists: within 8 m of a threshold ≠ the last one, call app.districtBanner(B, {via: the street name or line name, from: A});
(b) otherwise: a district change must persist for 25 m of travelled distance before the banner fires. Track a candidate id and the accumulated distance.

7. export.js
- Schema v2, per the contract.

8. headless.mjs
- --param parsing: numbers, and true/false.
- The summaries.
- --plan drawing:
  - ring, dark, 6 px;
  - rail track;
  - radials, dark, 4 px;
  - named streets in accent, 4 px;
  - old road in sepia, 4 px;
  - squares as white discs;
  - stations in cyan, 8 px;
  - thresholds as red rings.
- --style: lots filled with their style swatch.
- Round discs via footprintOf.
- OLD colour [200, 181, 151].
- Seam blend.

9. shot.mjs and test-explore.mjs
- shot.mjs: the STEPS tokens.
- test-explore.mjs new checks:
  - walk under a pilotis body: find an arche building with an elevated body, and pass beneath it at ground level;
  - walk through a row arcade: cross the recessed ground floor of an 'arch' entity row;
  - the campus main-roof ladder still reaches the fence vantage;
  - the threshold banner fires exactly once when walking across a threshold, and not while walking 60 m along a border.
- When the data is missing, each new check reports 'skip (feature absent)' instead of crashing. The final acceptance still requires them to pass.

10. tools/check-render.mjs
- See self_test.
- You are the only package that runs tools/build.mjs, inside check-render.

PARITY
- With ?plan=0&arch=0 the 3-D view must be pixel-identical in intent: ≤ 0.5% of pixels differ in the central crop vs review/before/map.png.
- Legacy bld entities go through pattern 0.

BUDGETS
- Draw buckets ≤ 110.
- ≤ 5 cloned bld/bldR geometries.
- No new external URLs — only the three.js CDN and Google Fonts.
- dist stays a single file.

FINAL REPORT
- Screenshots taken.
- Bucket counts.
- Console errors (there must be none).
- Check output.
- Data fields you found missing.

## Self-test
Run `node tools/check-render.mjs`.

Node checks:
- render-keys bucketKey and shapeKey match world.js usage.
- footprintOf classes match plan_md §4.5.
- exportWorld(devGenerate('lumina')) validates as schema 'academy-city/2':
  - buildings[];
  - plan{…} when plan is on;
  - fac, trim, band and bandMask on grammar bodies when present.
- headless --plan, --style and --json run and write their PNG/JSON into the scratchpad.

Browser checks (--browser):
- Run `node tools/build.mjs`.
- Serve the repo with `python3 -m http.server 8123 --directory /home/user/academy-city`.
- Use Playwright with the swiftshader flags from shot.mjs.
  1. index.html?plan=0&arch=0#lumina → map.png. Compare the central crop (x 320–1090, y 70–880) against review/before/map.png: at most 0.5% of pixels may differ by more than 24/255 in any channel.
  2. Default params:
     - no console errors and no shader warnings;
     - bucket count ≤ 110 (window.__app.world.meshes.length);
     - the 'relation' and 'arch' overlays render;
     - colour modes switch;
     - clicking a building opens the inspector with '왜 여기에?' (when plan data exists) and the 건축 section (when arch data exists).
  3. `node tools/test-explore.mjs` passes the legacy checks. The new checks may report skip until C1/C2 data exists.
