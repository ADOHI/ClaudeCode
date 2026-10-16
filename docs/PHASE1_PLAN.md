# Phase 1 작업 패키지 명세

[decision-v2](research/decision-v2.md) 4장 Phase 1을 7개 작업 패키지로 나눈 명세입니다. 클라우드 세션에서 각 패키지를 별도 git worktree의 에이전트가 구현했습니다.
로컬에서 이어서 할 때 남은 패키지는 이 명세를 그대로 작업 지시로 쓰면 됩니다. 원래 명세 속 클라우드 전용 경로(scratchpad, venv)는 로컬 경로로 바꿔 읽으세요: Python은 `tools/requirements.txt`로 만든 venv, 바인드 내보내기는 `web/.cache/`.

| 패키지 | 상태 | 소유 파일 |
|---|---|---|
| `field-py-distill` | 완료, 머지됨 (독립 리뷰 전) | tools/bustfield/** (new Python package + tests), web/scripts/eval-field.mjs (new), docs/params.schema.json (new) |
| `teacher-fem` | 완료, 머지됨 (독립 리뷰 전) | tools/teacher/** (new Python package + tests) |
| `runtime-dynamics` | 완료, 머지됨 (독립 리뷰 전) | web/src/core/runtime.js (rewrite allowed, keep exported names working or document changes), web/src/core/modal.js (new), web/src/core/vskin.js (new), web/src/core/field.js ONLY the brushes() function + exports to add a new op type, web/test/runtime.test.js (new) |
| `morpho` | 완료, 머지됨 (독립 리뷰 전) | web/src/core/morpho.js (new), tools/morpho/** (new Python mirror + tests), web/test/morpho.test.js (new), web/scripts/shoot.mjs (extend for contact sheets), web/scripts/contact-sheet.mjs (new, optional) |
| `garment-tier1` | 중단됨: 부분 코드가 wip/phase1/garment-tier1/ 에 있음 (테스트 없음, 미검증) | web/src/core/garment.js (new), web/test/garment.test.js (new), web/scripts/garment-check.mjs (new, optional) |
| `darap-stylize` | 중단됨: 부분 코드가 wip/phase1/darap-stylize/ 에 있음 (솔버 일부, 미검증) | tools/stylize/** (new Python package + tests) |
| `golden-spec` | 시작 전 | web/scripts/gen-golden.mjs (new), docs/golden.json (new, generated from DEFAULT_PARAMS + a synthetic frame, NOT from any model data), docs/METHOD.md (new), web/src/core/validate.js (extend: combination/in-between analysis), web/test/validate.test.js (new), web/package.json (scripts only) |

## field-py-distill

**상태**: 완료, 머지됨 (독립 리뷰 전)

**소유 파일**: tools/bustfield/** (new Python package + tests), web/scripts/eval-field.mjs (new), docs/params.schema.json (new)

**명세**

```text
1. Python port of the field: tools/bustfield/{vec,kelvinlet,field}.py reproducing web/src/core/{vec,kelvinlet,field}.js EXACTLY (window, falloff,
   tri-scale grab/scale incl. 'smooth' kernel, midline partition sideShare, lockLateral, sliderToWeights, jacobian by central differences with h=1e-3*S,
   buildBodyFrame/toBody/fromBody). Vectorize with numpy (evaluate many points at once).
   Parity test: web/scripts/eval-field.mjs evaluates the JS field for given params+frame at given points and prints JSON; a pytest calls it via
   subprocess (node) for ~300 random points in/around the window for every target (plus Jacobians) and requires max abs diff < 1e-9*S.
2. Distillation (tools/bustfield/distill.py + CLI): given teacher samples (bind positions P, displacements U, sample weights) for one target, fit
   a mirror-symmetric dictionary of fixed-centre Kelvinlet atoms per side: centres on a lattice inside the window around the apex (24-64 per side),
   3 radius levels, grab atoms (3 amplitude dofs each, d vector) + scale atoms (1 dof, k); nu fixed per atom family. Because the field is LINEAR in
   amplitudes (window and midline lock are applied after the brush sum), assemble the design matrix once and solve ridge least squares
   (scipy, normal equations or lsqr). After fitting, run the injectivity gate (Python fieldCheck equivalent: det(I + sum_k w_k J_k) over a grid,
   for all slider extreme combos as in validate.js extremeCombos) and, if min det <= 0.2, increase ridge / add a Jacobian penalty and refit.
   Output a params JSON (same shape as DEFAULT_PARAMS, only 'targets' replaced/extended) that web/src/core/field.js consumes unchanged.
   Samples come from three sources: skin vertices, interior points, and an outer SHELL 1-3 cm (in S units ~0.005-0.015 S) outside the skin with the
   teacher displacement extrapolated along the normal, so the space where clothes sit is controlled.
   Acceptance: (a) self-distillation: sample the CURRENT hand-tuned DEFAULT_PARAMS field on the Changli skin (material UP_Skin + clothes UP*) and
   distill it back: skin RMS error <= 3% of max displacement with <= 64 atoms/side, min det > 0.2; (b) a synthetic analytic target (e.g. smooth
   anisotropic inflation) also <= 3%; (c) round trip through field.js (load distilled params in JS via eval-field.mjs) matches Python within 1e-9*S.
3. Artist profile-curve inverse fit (tools/bustfield/profile_fit.py + CLI): input = target sagittal profile polyline(s) in the body frame through
   the apex (and optionally a frontal silhouette), output = amplitudes so that the deformed skin's sagittal profile matches the curve (LS on profile
   samples taken from the skin surface near the sagittal plane through each apex), with smoothness + det constraints. Demonstrate on Changli by
   fitting a profile 'rounder upper pole, +10% projection' and report the profile error.
4. docs/params.schema.json: JSON Schema for the params format.
```

**합격 기준**: parity < 1e-9*S; self-distill RMS <= 3% with <= 64 atoms/side and min det > 0.2; synthetic target <= 3%; profile fit error reported; pytest + npm test green

## teacher-fem

**상태**: 완료, 머지됨 (독립 리뷰 전)

**소유 파일**: tools/teacher/** (new Python package + tests)

**명세**

```text
Teacher A from decision-v2 section 3(a): quasi-static hyperelastic bake that produces NATURAL and physically-based target displacements.
1. Proxy volume per breast: from bust-bind/1 (Changli; material groups give body skin 'UP_Skin' vs clothes), build a tetrahedral proxy volume of the
   breast tissue between the front skin surface (inside the field window around each apex, see field.js window/anchor and autofit.js height map)
   and a chest-wall surface (offset/flattened back surface). Simplest robust route: a height-map in the body frame (like autofit.js rasterization)
   -> structured hexes between chest wall and skin -> split to tets. Keep ~5k-30k tets per side. Map skin vertices to the volume (barycentric) so
   volume displacements can be read back at skin vertices; also emit interior samples.
2. Solve: prefer newton SolverVBD (CPU) with tet Stable Neo-Hookean and per-tet materials (critic verified growth via scaling model.tet_poses by
   (1+s)^{-1/3} gave volume ratio 1.2935 for s=0.3); damp to quasi-static equilibrium and REPORT the residual you reach. Chest wall Dirichlet.
   If newton is unusable, write a small numpy/scipy quasi-static SNH Newton solver instead (projected Newton with eigenvalue clamping).
3. Load cases -> teacher targets (each output = displacement at skin vertices + interior + shell samples, bind space):
   - size_up_natural: isotropic growth of the tissue volume (s ~ +0.35 volume) + gravity along -up (effective gravity dial) -> lower pole fills
   - size_up_stylized: ANISOTROPIC anterior growth + reduced effective gravity + 'ligament' prestress / skin tension that rounds the upper pole
   - size_down: shrink (s ~ -0.25)
   - lift_up / lift_down: change of effective gravity direction/magnitude and/or ligament tension (tension-only springs from tissue to clavicle line)
   - spread_out / spread_in: lateral body force
   Expose <= 8 physics dials (growth s, anterior anisotropy, effective gravity, ligament prestress, Poisson nu, skin tension, lateral force) in a
   JSON config, since an optimizer (CMA-ES) will search over them later.
4. Inverse rest shape (sag-free initialization): the authored mesh is the equilibrium under the default gravity; find X_rest by fixed-point iteration
   X_rest <- X_rest + (X_target - x_eq(X_rest)) so that applying default gravity reproduces the authored shape (error <= 0.5% S). Load cases are
   then applied relative to that equilibrium (difference of equilibria), so weight 0 == authored shape exactly.
5. Modal analysis for the runtime: with chest wall fixed, compute 4-6 lowest vibration modes (generalized eigenproblem K phi = w^2 M phi on the
   linearized system around equilibrium; scipy.sparse.linalg.eigsh shift-invert), jointly for L and R; report frequencies; output mode shapes at
   samples + modal participation for linear acceleration (3-vector) so the runtime can drive them.
6. Output format: tools/teacher writes NPZ/JSON 'teacher samples' (P, U, weights, kind in {skin, interior, shell}, target name, dials) that the
   distiller (another agent, tools/bustfield/distill.py) consumes; document the format in tools/teacher/README.md.
Acceptance: per load case: all tets det(F) > 0, relative residual reported (aim <= 1e-6 or document what was reached), tissue volume change within
+-5% of the prescribed growth, inverse rest-shape reproduction <= 0.5% S, modes computed with frequencies; runtime of the whole bake reported.
Write teacher samples for Changli to /home/user/ClaudeCode/web/.cache/teacher/changli/ (git-ignored) and report paths.
```

**합격 기준**: det(F)>0 all tets; volume within +-5% of prescribed growth; inverse rest <= 0.5% S; residual reported; 4-6 modes with frequencies; samples written to web/.cache/teacher/changli

## runtime-dynamics

**상태**: 완료, 머지됨 (독립 리뷰 전)

**소유 파일**: web/src/core/runtime.js (rewrite allowed, keep exported names working or document changes), web/src/core/modal.js (new), web/src/core/vskin.js (new), web/src/core/field.js ONLY the brushes() function + exports to add a new op type, web/test/runtime.test.js (new)

**명세**

```text
Decision-v2 section 3(d) runtime layer, all as blend-shape weight drivers portable to a Unity MonoBehaviour:
1. FIX the bug in BustDynamics.update (critique section 2): dt is clamped and then used to differentiate real frame motion -> fake kicks.
   Separate the differentiation dt (real) from integration substeps; add teleport/cut detection + reset(); accept full chest motion (position +
   rotation/orientation axes), not only the up component.
2. Exact discretization of the damped oscillator per mode (zero/first-order hold of the forcing) instead of semi-implicit Euler; art parameters:
   overshoot % and settle time -> zeta = -ln(OS)/sqrt(pi^2+ln^2 OS) and omega. Frame-rate independence test: 30/60/120 fps trajectories within 1%;
   hitch injection test (one 250 ms frame instead of 16 ms) shows no spurious kick.
3. Modal integrator (modal.js): N modes, each with omega, zeta, participation vectors for chest linear acceleration (and optionally angular
   acceleration/centrifugal/Coriolis terms as in the plan: -Phi^T M (a + alpha x r + omega x (omega x r) + 2 omega x v - g)); outputs signed modal
   coordinates mapped to blend-shape weights (± pairs or signed). Until FEM modes exist, provide 'pseudo-modes' built from the existing targets
   (lift ~ vertical, spread ~ lateral, size/forward) so the viewer can run it now.
4. Velocity/Acceleration-skinning style layer (vskin.js): linearized stylization shapes expressed as FIELD targets so they bake like the others:
   add an op type {type:'linear', at:[...], A:[9 row-major], radius?} to field.js brushes() giving u = A r (r = q - at, side frame), so windowed by W
   and midline-locked like every target. Build the basis: 'squashy' (5 traceless symmetric shapes, exact), 'floppy' (3 shapes, first order) and
   'follow-through' (3 shapes); driver maps chest angular velocity/acceleration and modal relative velocity to these weights. Replace the hardcoded
   spread = -squashStretch*lift with this layer (keep a compatibility path).
5. Combine everything in one function used by the viewer: weights = f(user sliders, dynamics state, pose corrective) with clamping policy documented.
Acceptance: fps-independence <= 1%; hitch test passes; det>0 for the field at maximum dynamic amplitudes (use validate.js fieldCheck with your
added targets at their max weights); mass/shape orthogonality is optional until FEM modes arrive; all tests green.
```

**합격 기준**: dt bug fixed with hitch test; 30/60/120 fps within 1%; modal integrator with pseudo-modes; vskin linear op + basis baked as field targets with det>0 at max; tests green

## morpho

**상태**: 완료, 머지됨 (독립 리뷰 전)

**소유 파일**: web/src/core/morpho.js (new), tools/morpho/** (new Python mirror + tests), web/test/morpho.test.js (new), web/scripts/shoot.mjs (extend for contact sheets), web/scripts/contact-sheet.mjs (new, optional)

**명세**

```text
Decision-v2 section 3(c) step 2 + P1-2 + P1-10.
1. Morphometrics (JS core, engine-agnostic, input: bind positions + triangle index of the body skin (and optionally clothes), body frame, apex
   estimates, optional deltas+weights to evaluate a slider state): per side, in the sagittal plane through the apex: upper-pole : lower-pole ratio
   (Mallucci & Branford definition: split by the horizontal through the nipple/apex level; measure as you define and document precisely), apex tilt
   angle (above horizontal), upper-pole curvature sign/slope (concave / straight / convex), lower-pole convexity, IMF (inframammary fold) height,
   projection / base-width ratio; in the transverse section through the apex: lateral divergence angle. Robust to mesh resolution (test: metrics on
   a subdivided vs original synthetic mesh differ < 2%). Define natural band (Mallucci 45:55, ~20 deg) and the anime hypothesis band
   (~50:50, 25-30 deg, slightly convex upper pole, higher IMF) as data, and a scoring function distance-to-band.
2. Python mirror tools/morpho/morpho.py with a parity test against the JS (run node via subprocess on the same inputs).
3. Report the metrics for Changli at: base, size_up_natural=1, size_up_stylized=1, size_down=1, lift +-1 (use the current DEFAULT_PARAMS field;
   compute deltas with web/src/core/bake.js in a node script) as a markdown table in your summary.
4. Contact sheet: extend web/scripts/shoot.mjs (or add contact-sheet.mjs) to render fixed cameras (6 views: front, 3/4 L, side L, side R, 3/4 R, top-down)
   x 2 poses (rest, arms raised) for a list of slider states, then compose an A/B comparison HTML page (images side by side + metrics table) into an
   output dir. Never write renders of Changli into the repo; default output dir under ${SP}/shots/.
Integration notes must describe how the viewer HUD should show the metrics live (throttled).
```

**합격 기준**: metrics defined+documented; resolution test < 2%; JS/Python parity; Changli table reported; contact sheet + A/B page generated

## garment-tier1

**상태**: 중단됨: 부분 코드가 wip/phase1/garment-tier1/ 에 있음 (테스트 없음, 미검증)

**소유 파일**: web/src/core/garment.js (new), web/test/garment.test.js (new), web/scripts/garment-check.mjs (new, optional)

**명세**

```text
Decision-v2 section 3(b) Tier 1 (+ critique): fitted clothes over the bust (cleavage bridging, straps) need more than the shared space warp.
1. Body/garment split: for single-mesh models use material groups (Changli: body skin 'UP_Skin'; garments 'UP', 'UP_Dressin', 'UP_Belt', 'Cloth*');
   for multi-mesh models use mesh membership. Make this a small explicit config, not magic.
2. Cling map per garment vertex: distance to the body surface (bind space) and nearest body point; classify 'tight' (follows the field as now)
   vs 'bridging/unmatched' (e.g. fabric spanning the cleavage, straps lifted off the skin).
3. For bridging regions: bi-Laplacian (biharmonic) inpainting of the garment displacement from the matched boundary (Abdrashitov et al. 2023 robust
   transfer style, Q = -L + L M^-1 L with cotangent L and lumped mass M), solved with a simple sparse CG in JS (no deps).
4. Obstacle-constrained membrane relaxation after applying the body morph: a few projective iterations keeping each garment vertex >= thickness
   from the deformed body (push out along body normal) while preserving garment edge lengths/membrane strain, pinned where the garment is tight.
5. Gap/penetration check at w in {0.25, 0.5, 0.75, 1} for validate.js extremeCombos: min garment-body distance >= thickness (report), plus a
   qualitative + numeric check that the bridge region advances with the apex (bridge displacement vs apex displacement).
6. Output: per-garment-vertex corrected deltas for every target (same layout as bake.js output) so they can be baked as blend shapes.
Tests on a synthetic scene (two spheres = breasts on a plane + a sheet garment bridging them) and a run on Changli (report numbers).
```

**합격 기준**: synthetic tests pass; Changli: min gap >= thickness at all w/extremes or documented failures; bridge follows apex numerically; tests green

## darap-stylize

**상태**: 중단됨: 부분 코드가 wip/phase1/darap-stylize/ 에 있음 (솔버 일부, 미검증)

**소유 파일**: tools/stylize/** (new Python package + tests)

**명세**

```text
Decision-v2 Teacher B: normal-driven ARAP stylization (Geometry in Style, Dinh et al. CVPR 2025; you may read github.com/threedle/geometry-in-style via
raw.githubusercontent.com for reference (MIT), but write your own implementation and cite it).
1. On the welded skin surface of the bust ROI (from bust-bind/1 Changli 'UP_Skin', weld split vertices by position), implement CPU dARAP:
   local step = per-vertex Procrustes on spokes-and-rims edges + lambda * (vertex normal -> target normal) term; global step = prefactored
   sparse Laplacian (scipy.sparse.linalg.splu/cholmod-free) solve with DIRICHLET anchors on/outside the field window boundary (the official code
   only pins one vertex; anchoring the region is our job). Iterate to convergence.
2. Target normals that encode the STYLIZED look: e.g. normals of an idealized shape fitted at each apex (rounder, fuller upper pole, slightly
   higher apex, crisper IMF), blended into the current normals with a smooth ROI falloff. Lambda = 'style amount'.
3. Because ARAP resists area/volume growth, apply it on top of a size-up input (accept an optional input displacement, e.g. the current
   bust_size_up_stylized field or teacher output), and output the ADDITIONAL displacement as teacher samples (same NPZ format idea as the FEM
   teacher: P, U, weights, kind) for the distiller, both for skin and (by nearest-point transfer) clothes vertices if useful.
Acceptance: displacement outside the ROI <= 1e-4 S; lambda monotonic (larger lambda -> smaller mean deviation from target normals); identity when
target normals == current normals; report runtime on Changli; tests green. Write Changli outputs only to /home/user/ClaudeCode/web/.cache/teacher/changli/.
```

**합격 기준**: outside-ROI <= 1e-4 S; lambda monotonic; identity test; Changli run reported; tests green

## golden-spec

**상태**: 시작 전

**소유 파일**: web/scripts/gen-golden.mjs (new), docs/golden.json (new, generated from DEFAULT_PARAMS + a synthetic frame, NOT from any model data), docs/METHOD.md (new), web/src/core/validate.js (extend: combination/in-between analysis), web/test/validate.test.js (new), web/package.json (scripts only)

**명세**

```text
P1-1 (golden) + P1-9 (combination / in-between analysis) + the method spec.
1. web/scripts/gen-golden.mjs -> docs/golden.json: for DEFAULT_PARAMS and a fixed synthetic body frame (no model data), ~200 sample points in and
   around both windows: per target the displacement, the Jacobian, and the normal transform result for a few normals; plus sliderToWeights cases,
   window/falloff values, midline share/lock values. Include a version + generator hash. npm script 'golden'. A test re-generates and compares
   (deterministic, tolerance 1e-12).
2. validate.js: combination analysis: for pairs/triples of targets at their extremes and at in-between weights (0.25/0.5/0.75), report
   (a) min det at the combination midpoints, (b) normal error of linearly combined normal deltas vs exact F^-T of the combined field, as a map
   (per sample) + summary; (c) list of combinations that need corrective shapes (normal error > threshold or det near 0). Positions superpose
   exactly by construction — assert it in a test.
3. docs/METHOD.md: the precise specification of the method for porting to Python/Blender/C# Unity: frames (and the handedness note: Unity is left
   handed, flip the cross product), window, Kelvinlet formulas (tri-scale weights), midline partition and lock, masking, baking (positions +
   F^-T normals in mesh local space), validation gates, the bust-bind/1 and params formats, slider mapping, and the decision-v2 architecture
   summary (teachers -> distillation -> field). Reference docs/golden.json for parity tests. Keep it precise, not marketing.
```

**합격 기준**: golden deterministic + test; combination analysis implemented with tests; METHOD.md complete and consistent with code
