# bustfield (Python bake tools for the bind-space field)

Python port of `web/src/core/{vec,kelvinlet,field,validate}.js` plus the bake-time tools that
produce field parameters. The field stays the delivery layer (decision-v2 §2–3); these tools
make its params from teachers instead of by hand. Output is always a params JSON in the
`DEFAULT_PARAMS` shape (schema: `docs/params.schema.json`) that `field.js` consumes unchanged.

| module | what |
|---|---|
| `field.py`, `kelvinlet.py`, `vec.py` | exact numpy port (vectorized over points). `BustField(frame, params)` = `createBustField` |
| `validate.py` | `field_check` / `extreme_combos` = validate.js `fieldCheck` / `extremeCombos` (injectivity gate) |
| `distill.py` | teacher samples → fixed-centre Kelvinlet dictionary → ridge LS + det-constrained QP |
| `profile_fit.py` | artist sagittal profile curve → dictionary amplitudes (Gauss–Newton LS + smoothness + det) |
| `schema.py` | dependency-free validator for `docs/params.schema.json` |
| `bind.py` | `bust-bind/1` reader (material groups → vertex sets) |
| `jsbridge.py` | runs `web/scripts/eval-field.mjs` (node) for parity / round-trip checks |

## Run

```bash
PY=/path/to/venv/bin/python        # numpy, scipy, pytest (tools/requirements.txt)
cd tools
$PY -m pytest bustfield            # parity tests need node; Changli tests skip without web/.cache/changli.bind.json

# self-distil the hand-tuned field on the skin + clothes layers (all 7 targets)
$PY -m bustfield.distill --bind ../web/.cache/changli.bind.json --out out.params.json --report out.report.json --verify-js
# a different teacher for one target, on top of existing params
$PY -m bustfield.distill --bind ... --params out.params.json --teacher samples:fem.npz --targets bust_size_up_natural --out ...
#   samples .npz: P (N,3) bind positions, U_<target> (N,3) displacements, optional w (N,), kind (0 skin, 1 interior, 2 shell)
# profile curve -> blend shape ("rounder upper pole, +10% projection" by default, or --curve curve.json
# {ys, zs} apex-relative S units; optional --frontal frontal.json {ys, xs}: front-view contour, x outward)
$PY -m bustfield.profile_fit --bind ... --params out.params.json --target bust_size_up_stylized --out prof.params.json --report prof.report.json
$PY -m bustfield.schema out.params.json
```

## Method notes

- **Linearity.** Window, midline share and lateral lock are applied after the brush sum, so
  `delta = A(p) @ c` exactly. `BustField.assemble` builds `A` through the same code path as
  `delta` (tested to 1e-14), so a distilled fit means the same thing in `field.js`.
- **Dictionary.** Default lattice (apex-relative side frame, S units): 3 radius levels
  (0.22 / 0.15 / 0.10), 27 centres, 48 atoms (= ops) per side: grab + scale at the 21 centres
  of the two coarse levels, grab only at the 6 fine ones (27 grab with 3 dofs + 21 scale with
  1 dof = 102 amplitudes), nu fixed per family (grab 0.45, scale 0.2). Atoms are mirrored to
  both sides by the field itself. `--budget N` prunes (backward elimination) below 48.
- **Samples.** Skin + clothes vertices inside the window; interior points 0.03/0.06/0.1 S
  under the skin (teacher evaluated there, or an FEM teacher's own nodes); a shell
  0.005/0.01/0.015 S outside with the skin displacement extrapolated (constant) along the normal.
- **Gate.** `det(I + sum_k w_k J_k) > 0.2` at every `extremeCombos` corner on the fieldCheck
  grid (res 14, what the viewer reports), also imposed on res 20. Violations are fixed by
  linearized det constraints `det(F0) + <cof(F0), dF> >= 0.26` (dual NNLS QP, re-linearized
  each iteration); if that does not converge, ridge and a Jacobian smoothness penalty are
  raised and the fit is repeated. The gate is a property of the whole param set: distilling
  a subset of targets cannot fix combos that only use the others (the CLI says so).

## Verified numbers (Changli export, S = 2.567, 2998 skin + clothes vertices in the window)

| check | result |
|---|---|
| Python vs field.js, 300 pts × 7 targets, 6 param variants × 2 frames + Changli | max delta diff ~1e-17 S, Jacobian ~1e-14 (bound 1e-9 S) |
| self-distillation of the hand-tuned `DEFAULT_PARAMS` targets, 48 atoms/side | skin RMS 0.49–0.69 % of max displacement (held-out triangle centroids 0.70 %); gate min det 0.238 (res 14), 0.230 (res 20); teacher itself: 0.189 / 0.162 |
| same, lattice shifted by (0.03, 0.045, 0.025) S / other radii | 0.83 % / 0.88 %, gate 0.266 / 0.303 |
| same on Michelle (304 skin verts) / Seed-san (layered wear meshes) | 1.34 % / 0.93 %, gate 0.261 / 0.237 (teachers 0.127 / 0.093) |
| synthetic anisotropic inflation teacher (not windowed) | skin RMS 1.32 %; gate 0.238 |
| round trip of distilled params through field.js | 1.5e-17 S |
| profile fit "rounder upper pole, +10 % projection" (stylized) | profile RMS 0.0200 S → 0.0006 S (0.3 % of the 0.222 S apex projection), max 0.0022 S; gate 0.238 |
| frontal silhouette (synthetic torso, +0.012 S lateral bulge, with a sagittal target) | contour RMS 0.0064 → 0.0017 S, profile 0.0125 → 0.0009 S |

Profile curves are measured on the mesh (plane sections of the visible layers, front envelope for
the sagittal profile, occluding contour of horizontal sections for the frontal silhouette) and
re-measured on the deformed mesh for the reported error.
