# Bust morphometrics

Shape measurements of each breast mound, used to compare slider states, teachers and
characters and to score shapes against aesthetic bands (decision-v2 3(c)-2, P1-2, P1-10).

- `web/src/core/morpho.js`: reference implementation (engine-agnostic, no deps). The
  header defines every landmark and metric precisely.
- `tools/morpho/morpho.py`: Python mirror. `tests/test_parity.py` runs both on the same
  inputs (synthetic torsos, and Changli's prepared context when the private export is
  present). Max |JS - Python| is about 1e-11, with identical flags.
- `tools/morpho/report.mjs`: markdown table over named slider states for a `bust-bind/1`
  export (DEFAULT_PARAMS with the viewer's auto-fit anchor, baked with `bake.js`).
- `web/scripts/contact-sheet.mjs`: fixed-camera renders (6 views x rest / arms-up) for a list
  of states, plus an A/B page with a metrics table and the sagittal profiles.
- `tools/morpho/synth-torso.mjs`, `synth_torso.py`: analytic torso used by the tests.

```bash
node tools/morpho/report.mjs web/.cache/changli.bind.json [--selection outer|skin|all] [--states base,lift_up]
cd web && node scripts/contact-sheet.mjs --model /models/<file> --base http://localhost:5173/ --out /tmp/<dir>
cd tools/morpho && python -m pytest -q          # needs numpy (+ node for parity)
```

## Metrics (S units, body frame; per side, then the mean of the sides that measured cleanly)

| key | meaning |
|---|---|
| `upperPoleFrac` | UP / (UP + LP), split by the horizontal through the nipple proxy (Mallucci & Branford). 0.45 = 45:55 |
| `tiltDeg` | cap-axis angle above horizontal (midpoints of constant-depth chords). Proxy for nipple direction |
| `upperSlopeDeg` | angle below horizontal of the upper pole chord between the 15% and 70% depth crossings |
| `upperConvexity`, `lowerConvexity` | sagitta / chord of a quadratic fit over the same arc. Above `straightTol` (0.01) = convex, below -0.01 = concave |
| `imfY` | fold height (knee of the lower profile), relative to the chest joint |
| `projection`, `baseHeight` | apex depth over the chest-wall plane through the fold; top-to-bottom border distance |
| `baseWidth`, `projectionRatio`, `divergenceDeg` | transverse section. Missing when a garment bridges the cleavage (`transverseShallow`) or no lateral border is found |
| `turnDeg` | angle between upper and lower pole chords |

Bands (`BANDS` in morpho.js) are data. `natural` is Mallucci & Branford 2012. `anime` is the
decision-v2 hypothesis (about 50:50, 25-30 deg, slightly convex upper pole, higher IMF).
`scoreBands` returns a weighted RMS of (gap / scale). The IMF term (`imfRise`) is scored only
against a reference state, because absolute IMF heights are rig dependent.

## Robustness (what the tests show)

- The same piecewise-linear surface with 4x the triangles (midpoint subdivision) gives
  identical numbers, within 1e-11. This holds on synthetic meshes and on Changli, Michelle and
  Seed-san.
- Smooth synthetic surface, grid h = 0.02 S vs 4x finer: all metrics differ by less than 2%.
  Angles and sagitta ratios cross zero, so they are compared on a 20 deg and a 0.2 scale.
- Coarser meshes (h = 0.04 S, about Changli's edge length near the bust) are honestly worse on
  curvature-type metrics. Typical shapes stay within about 1 deg of tilt. Features covered by
  only 2-3 facets can be off by up to about 7 deg of tilt or 0.03 of convexity. Compare states
  on the same mesh.

## Caveats

- `tiltDeg` is a cap-axis proxy. Meshes have no nipple, so mapping Mallucci's 20 deg onto
  it is an assumption.
- Skin cut out under garments makes the skin-only envelope fall through to the back of the
  torso. This is flagged `hole` and not scored, so measure `outer` (skin + torso clothes)
  instead.
- A chest with no fold or no distinct mound (Seed-san flat, Michelle's broad convex top) is
  flagged `flat` / `imfOpen` and not averaged or scored.
