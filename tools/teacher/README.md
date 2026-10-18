# Teacher A: quasi-static FEM bake (`tools/teacher`)

Teacher A of decision-v2 §3(a). It produces **natural, physically based target
displacements** for the bust blend shapes. The distiller
(`tools/bustfield/distill.py`) fits these displacements with the fixed-centre Kelvinlet
dictionary of `web/src/core/field.js`. This package never touches the field itself.

```
bust-bind/1 export ──► height-map proxy volume (volume.py)
                   ──► inverse rest shape under default gravity (inverse.py)
                   ──► 7 load cases from ≤ 8 physics dials (cases.py, fem.py)
                   ──► teacher samples P, U, w, kind  +  vibration modes (samples.py, modal.py)
```

## Run

```bash
PY=<venv>/bin/python          # numpy, scipy (newton/warp only for vbd_check.py)
cd <repo root>
$PY -m tools.teacher.bake --bind web/.cache/changli.bind.json --preset changli \
    --out web/.cache/teacher/changli            # about 5 min wall / 6 min CPU on 2 BLAS threads
$PY -m tools.teacher.bake ... --dials '{"growth": 0.5, "lift": 0.9}'   # override dials
$PY -m tools.teacher.bake ... --config my.json  # any subset of cases.DEFAULT_CONFIG
$PY -m tools.teacher.bake ... --targets bust_lift_up,bust_lift_down --no-modes
$PY -m pytest tools/teacher/tests              # about 15 s, synthetic export only
```

`--preset changli` selects the material groups of that model: body skin `UP_Skin`,
plus the tight top `UP`. The `UP` top stands in for the skin because the model has no
skin under its clothes. Without a preset, every masked triangle is used.

Coverage of the other test models:

- **Michelle:** smoke-tested with `bust_size_up_natural` and `bust_lift_up`. Residual
  ≤ 1.4e-11, inverse error 5.7e-8 S, volume −1.9 %, and clean symmetric mode pairs
  from 5.4 Hz; 183 s.
- **Seed-san:** only the volume builds; no bake has been run.

The exit code is 1 if any case fails to converge or inverts a tet, the inverse
rest shape misses the configured `solver.inverseTol`, or the computed modal
equilibrium is unstable. `meta.json` reports `inverse.converged` explicitly.
When the inverse iteration budget runs out, the returned rest shape and
equilibrium describe the same last solved state; the untested next iterate is
never used for subsequent cases.

Set `OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` to share CPUs. The inverse rest shape
depends only on the `gravity` and `nu` dials, plus the non-dial config. An optimizer can
therefore cache it and re-solve only the cases. For a search loop, a coarser volume
(`{"volume": {"cell": 0.04, "layers": 4}}`) has about 4× fewer tets; the speed-up has
not been measured.

## Physics dials (≤ 8, `cases.DIAL_NAMES`, example `dials.example.json`)

Units: lengths are in S (shoulder width), stress is in units of the tissue shear
modulus μ, and density in units of the tissue density.

| dial | default | meaning |
|---|---|---|
| `growth` | 0.35 | volume growth s of the breast tissue. Ratio (1+s)^c, with C2 falloff to the footprint edge |
| `anisotropy` | 0.6 | share β of the growth that goes along body-forward: λ_fwd = J^((1+2β)/3), λ_across = J^((1-β)/3) |
| `gravity` | 5.0 | effective gravity number g0 = ρ g S / μ of the authored state. g0 = 5 with S = 0.36 m gives μ ≈ 0.7 kPa |
| `lift` | 0.7 | fractional change of gravity for lift and stylized: g = g0 (1 + c·lift) |
| `ligament` | 0.06 | Cooper-ligament prestress. Rest length = (1 − c·p) × rest distance; tension-only |
| `skinTension` | 0.03 | constant tension τ (μ·S) on the front surface (membrane prestress) |
| `lateral` | 6.0 | lateral body force (μ/S) on the tissue, outward for c > 0 |
| `nu` | 0.45 | Poisson ratio of the tissue and the subcutaneous margin |

Each case is a fixed recipe of coefficients c on these dials (`DEFAULT_CONFIG['cases']`).
A missing coefficient means 0. The default (weight-0) state has no growth, gravity g0,
slack ligaments, no tension and no lateral force.

| target | recipe |
|---|---|
| `bust_size_up_natural` | growth +1 (isotropic) |
| `bust_size_up_stylized` | growth +1, anisotropy 1, lift −0.5, ligament +1, skinTension +1 |
| `bust_size_down` | growth −1 (volume ratio 1/(1+s), the inverse of size_up) |
| `bust_lift_up` / `_down` | lift −1 / +1, ligament +1 / −1 |
| `bust_spread_out` / `_in` | lateral +1 / −1 |

## Model

**Proxy volume** (`volume.py`). The front envelope is rasterized into a height map
z(x, y) in the body frame (cell 0.025 S), like `autofit.js`. The envelope is the
skin-material and tight-clothing triangles inside the skin-weight mask. The domain is
the union of the two field windows.

- Enclosed holes in the clothing are membrane-filled.
- Silhouette columns steeper than `maxSlope` are trimmed.
- The chest wall is a Laplace ("membrane") fill of the envelope from outside the two
  tissue footprints, lowered by `wallOffset`. A footprint is the field window scaled by
  0.65 around the apex.
- Inside the midline band, only skin-topped cells count as chest wall. Cloth that
  bridges the cleavage is therefore not mistaken for body.
- Each column holds `layers` hexes. Each hex is split into 6 Kuhn tets, mirrored for
  x < 0 so the mesh is mirror-symmetric.
- A Kuhn tet of a vertical-edge hex has volume ±h²·dz/6, so positive thickness
  guarantees a valid mesh even at the inframammary overhang.

Materials per tet:

- `tissue` (μ = 1): footprint ellipses; carries the growth.
- `margin` (μ = 2): subcutaneous layer around the footprints.
- `filler` (μ = 0.3, ν = 0.4, ρ = 0.3): space under cloth that bridges the cleavage.

Chest wall (bottom layer) and the rim columns are Dirichlet.

**Energy** (`fem.py`, `snh.py`). The terms are:

- Stable Neo-Hookean (Smith et al. 2018), with multiplicative growth F = Ds (Fg Dm)⁻¹.
  Mass grows with the tissue.
- Dead loads: gravity g·ρ along bind-space −Y, mapped into the body frame, and the
  lateral body force.
- Tension-only ligament springs. They run from every tissue node to a clavicle-line
  anchor straight above it, at chest-wall depth, with strength ∝ the growth-weighted
  nodal volume.
- `skinTension` × the area of the front surface.

Gradients and Hessians of every term are checked against finite differences in the
tests.

**Solver.** Equilibrium is solved directly by Newton's method:

- Far from the solution, it uses the projected Hessian (per-element 9×9 eigenvalue
  clamping).
- Near it, it switches to the exact Hessian. A descent check falls back to the
  projected one.
- SuperLU solves each linear system. Backtracking with a det F > 0 feasibility check
  keeps every tet valid.
- Each case uses 3 load-continuation steps.

The reported residual is ‖∇E‖ on the free DOFs divided by the out-of-balance force that
the load change created at the start state. For the default equilibrium the divisor is
‖gravity load‖.

Why not newton's `SolverVBD`, as the brief preferred? VBD is a dynamic, float32 solver.
On this volume, damped to rest, it stalled at a relative residual of 1.8 (see "VBD
cross-check" below), far from the 1e-6 target. The modal step also needs the assembled
tangent stiffness K anyway. Both solvers use the same SNH energy and Lamé mapping
(checked in newton's kernel source). `vbd_check.py` reproduces the default equilibrium
with VBD and scores it with this package's residual.

**Inverse rest shape** (`inverse.py`). Fixed point X_rest ← X_rest + (X_auth −
x_eq(X_rest)), wrapped in Anderson acceleration (depth 5) with a plain-step fallback.
This is the two-stage sag-free initialization in its simplest form. Every load case is
the difference of equilibria U = x_case − x_eq(X_rest), so weight 0 reproduces the
authored mesh exactly.

**Modes** (`modal.py`). Solves K φ = ω² M φ:

- K is the exact tangent stiffness at the authored equilibrium, including the gravity
  prestress and the engaged ligaments.
- M is the lumped mass. Chest wall and rim are fixed.
- Both breasts are in one system. `scipy.sparse.linalg.eigsh` uses shift-invert at 0.
- Time unit T0 = sqrt(g0·S_m / g), from g0 = ρ g S / μ. A physical shoulder width S_m
  (`modes.metersPerS`, 0.36 m) therefore fixes the frequencies.

## Output format `bust-teacher/1`

`<out>/<target>.npz`, one per target, holds N samples:

| key | shape / type | meaning |
|---|---|---|
| `P` | (N,3) f8 | sample position, **bind space** (model units) |
| `U` | (N,3) f8 | teacher displacement, bind space. Add it to P at weight 1 |
| `P_body`, `U_body` | (N,3) f8 | the same in the body frame / S (x = left, y = up, z = forward) |
| `w` | (N,) f8 | lumped area (skin, shell) or volume (interior). **Each kind sums to 1**; the distiller picks the balance |
| `kind` | (N,) u1 | 0 skin, 1 interior, 2 shell (`kinds` = JSON mapping) |
| `vid`, `mesh` | (N,) i8 | vertex and mesh index in the bust-bind/1 export for skin samples, −1 otherwise |
| `side` | (N,) i1 | +1 body left (x > 0), −1 right |
| `parent` | (N,) i8 | for shell samples: index of the skin sample they extrapolate |
| `target`, `dials`, `format` | str | target name, dials JSON, `bust-teacher/1` |

Sample kinds:

- **skin**: vertices of the skin and envelope materials inside the volume footprint.
  This includes layers up to `maxAboveSurface` (0.05 S) above it. Values come from
  barycentric interpolation in the tets, with points above the surface clamped onto it.
- **interior**: every node of the proxy volume. Chest-wall and rim nodes carry U = 0,
  which tells the distiller where the field must vanish.
- **shell**: skin samples offset by `shellOffsets` = {0.03, 0.06} S along their normal.
  They carry the skin value (constant extrapolation) and pin the field where outer
  clothes sit.

`<out>/modes.npz` holds the same `P`, `kind`, `vid`, `mesh` and `w`, plus:

| key | shape | meaning |
|---|---|---|
| `freq_hz`, `omega` | (m,) | physical frequency (Hz, rad/s) for `metersPerS` |
| `omega_hat` | (m,) | nondimensional ω·T0 |
| `shape` | (m,N,3) | mode shape in bind units **per unit weight**. Max skin displacement = `shapeAmplitude` (0.05 S) |
| `shape_body` | (m,N,3) | the same in body / S |
| `gamma_body`, `gamma_bind` | (m,3) | participation in body axes (left, up, forward) / bind axes |
| `mass_fraction_body` | (m,3) | effective modal mass fraction per axis |
| `damping` | (m,) | suggested ζ (not baked, runtime choice) |
| `phi_mass_normalized_body` | (m,N,3) | M-orthonormal shapes (nondimensional), for checks |

Runtime driving, per mode k with blend-shape weight w_k:

```
ẅ_k + 2 ζ ω_k ẇ_k + ω_k² w_k = −gamma_k · a_S,      a_S = a_chest / S   (units 1/s², any engine units)
```

a_chest is the chest frame's linear acceleration minus the change of gravity relative to
the bind pose. The authored shape already contains the bind-pose gravity. Displacement =
Σ w_k · shape_k.

`<out>/meta.json` holds everything else: format, dials, the full config, frame, field
params, volume statistics, inverse-rest statistics, per-case statistics, mode summary
and timing. Per-case statistics are the residuals per continuation step, Newton
iterations, min det F (elastic and of the delivered map x_def → x_case), the tissue
volume ratio versus the prescribed one, and max |U|.

## Changli results

Run with the default dials and `--preset changli`. Outputs are in
`web/.cache/teacher/changli/` (git-ignored; private test model, never commit).

**Volume.** 7,497 nodes and 34,560 tets, 17,280 per side and mirror-symmetric.

- Materials: 20,376 tissue, 11,214 margin, 2,970 filler tets.
- 2,391 fixed nodes; 3,666 ligament nodes.
- Cell 0.025 S, 6 layers.
- Samples: 1,590 skin, 7,497 interior, 2,076 shell (11,163 in total).

**Inverse rest shape.** Max |x_eq(X_rest) − X_authored| = **4.0e-8 S** (acceptance:
0.5 % S = 5e-3 S).

- 12 fixed-point iterations, 10 of them Anderson steps, and 52 Newton iterations; 64 s.
- The rest shape lies up to 0.051 S above the authored shape (the gravity sag).
- The smallest rest/authored tet volume ratio is 0.40, in the cleavage filler.

**Load cases.** Residual = ‖∇E‖ / out-of-balance load. The volume columns are measured
versus prescribed tissue volume (equilibria), with growth weighted by its falloff.

| target | residual | min det F (elastic / delivered map) | tissue volume vs prescribed | max skin \|U\| (S) | Newton its | wall s |
|---|---|---|---|---|---|---|
| size_up_natural | 1.1e-12 | 0.299 / 0.490 | 1.2118 vs 1.2355 (−1.9 %) | 0.039 | 23 | 32 |
| size_up_stylized | 8.2e-12 | 0.592 / 0.569 | 1.2034 vs 1.2355 (−2.6 %) | 0.046 | 19 | 25 |
| size_down | 1.2e-12 | 0.618 / 0.703 | 0.8340 vs 0.8195 (+1.8 %) | 0.036 | 18 | 22 |
| lift_up | 1.4e-11 | 0.920 / 0.535 | 1.0052 vs 1 (+0.5 %) | 0.040 | 18 | 25 |
| lift_down | 1.4e-11 | 0.287 / 0.471 | 0.9956 vs 1 (−0.4 %) | 0.041 | 40 | 54 |
| spread_out | 1.1e-11 | 0.351 / 0.459 | 0.9955 vs 1 (−0.5 %) | 0.047 | 27 | 39 |
| spread_in | 1.2e-11 | 0.455 / 0.411 | 1.0041 vs 1 (+0.4 %) | 0.044 | 30 | 40 |

No tet has det F ≤ 0 in any case.

**Sagittal profile** through x = 0.275 S (left breast). "Fullness" is the mean bulge of
the profile over the chord from the apex to the footprint edge.

| target | apex moves (S) | upper-pole fullness | lower-pole fullness |
|---|---|---|---|
| size_up_natural | −0.010 up, +0.037 forward | +7.5e-3 S | +7.8e-3 S |
| size_up_stylized | +0.011 up, +0.044 forward | +6.6e-3 S | +3.3e-3 S |
| lift_up / lift_down | ±0.039 up | | |
| spread_out / spread_in | +0.047 / −0.044 lateral | | |

In the natural target the lower pole also drops by up to 0.025 S.

**Modes.** Six modes computed in 1.0 s with metersPerS = 0.36 and g0 = 5 (T0 = 0.43 s).
All ω² > 0 (the equilibrium is stable). "sym" is the left/right mirror correlation:
+1 means the mirror-image motion of both sides, −1 the opposite.

| Hz | motion | sym | effective mass fraction |
|---|---|---|---|
| 4.28 | lateral sway, both sides the same way | −0.94 | x 0.43 |
| 4.54 | vertical, mostly one side | +0.41 | y 0.37 |
| 4.73 | vertical, mostly one side | −0.41 | y 0.04 |
| 4.91 | lateral breathing | +0.95 | y 0.16 |
| 5.37 | vertical, in phase | +0.94 | |
| 5.73 | vertical, anti-phase | −0.94 | |

The two "one side" modes are a near-degenerate pair. The Changli mesh is not exactly
symmetric, so the pair splits into side-localized combinations.

**VBD cross-check** (`vbd_check.py`, output in `vbd_check.json`). It solves the default
equilibrium without ligaments, starting from the authored shape.

- **Newton:** relative residual 3.4e-12 in 13 iterations, 15 s.
- **newton 1.7 SolverVBD** (CPU, 10 iterations per step, dt = 0.01 T0, velocity × 0.95
  per step): stalls from step 250 to step 1000 (240 s) at max |x_vbd − x_newton| =
  3.7e-3 S, about 7 % of the 0.05 S sag. Its relative residual stays at 1.8, measured
  with this package's gradient.
- With dt = 0.05 it drifted to 0.35 S.

VBD therefore agrees with the shape to a few mm but is unusable for a 1e-6 residual
criterion. Part of the gap may be my VBD settings (no tuning beyond these two runs) or
VBD's float32 state.

**Runtime of the whole bake:** 320 s wall and 356 s CPU (`OMP_NUM_THREADS=2`, on a
4-CPU container shared with other jobs). The parts:

- volume: 2 s
- inverse rest shape: 68 s
- the 7 cases: 25–58 s each (3 continuation steps)
- modes: 1 s
- sampling and writing: a few s

## Limitations (read before trusting the shapes)

- **Height-map proxy.** The volume is an extrusion along body-forward:
  - Overhangs (the underside of the lower pole) lie inside it.
  - Silhouette regions steeper than slope 4 are cut. The field window there is
    represented only by the rim (U = 0).
  - Mesh vertices above the piecewise-linear front surface (at most 0.056 S at steep
    spots) are clamped onto it.
- **Clothing as skin.** Changli has no skin under its top, so the tight `UP` top is the
  front surface. The cleavage under the bridging cloth is a soft `filler`, not anatomy.
  Under spread_in and lift_down the filler takes the largest compression: min det F of
  the delivered map is about 0.4–0.5 there.
- **Boundary conditions.** The chest wall is Dirichlet: no sliding fascia and no moving
  pectoral boundary (critique-v2 §3.3). The rim of the window is fixed.
- **Simplified ligaments and skin.** The ligaments are a crude Cooper's model: vertical
  springs to a clavicle line. In this proxy, `skinTension` measurably *flattens* the
  mound (it lowers both upper- and lower-pole fullness in a dial sweep). It does not
  round the upper pole. The upper-pole fullness of `size_up_stylized` comes from the
  anterior growth, gravity relief and ligament prestress. Keep τ small or let the
  optimizer decide.
- **Loose calibration.** Default dial values give displacements of 0.04–0.05 S, about
  the scale of the hand-tuned `DEFAULT_PARAMS`. The natural/stylized difference is real
  but modest: lower- versus upper-pole fullness gains are about equal for natural, and
  about 2:1 in favour of the upper pole for stylized. Choosing dial values is the CMA-ES
  loop's job (decision-v2 §3(c)), not this package's.
- **Frequencies from the gravity number.** The frequencies follow from g0 and S_m, and
  f ≈ (1/2π)·sqrt(g/sag) is consistent with the 4–5 cm sag. They are not calibrated
  against motion data.

## Files

`bind.py` (bust-bind/1 reader), `heightmap.py`, `volume.py`, `snh.py`, `fem.py`,
`model.py`, `cases.py`, `inverse.py`, `modal.py`, `samples.py`, `bake.py` (CLI),
`vbd_check.py` (newton VBD comparison), `synthetic.py` (synthetic export for the tests),
`tests/`.
