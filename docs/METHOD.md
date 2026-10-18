# Bust field method and porting contract

This specifies the current implementation in `web/src/core/{field,kelvinlet,bake,validate}.js`.
The delivery field is a bind-space displacement evaluated at the original position,
then baked as mesh-local position and normal deltas. Parameters, brush centres,
windows and masks remain fixed while target amplitudes change. The default targets
are an editable baseline, not a claim of physically measured tissue behaviour.

## Numeric conventions and frames

Use double precision for field evaluation and reference comparisons. Baked vertex
buffers are Float32. Vectors are xyz; 3x3 matrices are **row-major**; affine 4x4
matrices are **column-major** (three.js/glTF layout). A position is transformed by
the affine matrix; a displacement uses only its linear part.

Given bind-space hips H, chest C, neck N, left/right upper-arm joints A_L/A_R:

```
S = |A_L - A_R|                         shoulder width, positive
left = normalize(A_L - A_R)
upRaw = N - H
up = normalize(upRaw - left * dot(upRaw, left))
forward = cross(left, up)               right-handed input convention
mid = (A_L + A_R) / 2
origin = C - left * dot(C - mid, left)
```

Input joints must define nonzero S and a nonparallel up direction. Body coordinates
are `[dot(p-origin,left), dot(p-origin,up), dot(p-origin,forward)]` in absolute bind
units, **not** divided by S. Their inverse is `origin + x*left + y*up + z*forward`.
`hipsY` and `neckY` are the corresponding body-space y values. Normalized parameter
lengths, unlike these coordinates, are multiplied by S exactly once.

For Unity's left-handed coordinate convention, use `forward = cross(up,left)`
when building the frame from converted joints. Convert every position, vector,
normal, matrix and triangle winding consistently; do not flip a cross product on
an already converted explicit frame. Supplied `frame` axes determine field
evaluation directly.

Each side has sign s=+1 (left), -1 (right), outward axis `s*left`, base
`fromBody([s*anchor.x*S, anchor.y*S, anchor.z*S])`, and apex
`base + forward*depth*S`. For q measured from the base:
`q=[dot(p-base,s*left), dot(p-base,up), dot(p-base,forward)]`.
An op's `at` is measured from the **apex**, so its internal base-relative centre
is `[at.x*S, at.y*S, (at.z+depth)*S]`. Op displacement d and radius are multiplied
by S; dilation k and linear matrix A are dimensionless.

## Compact window, partition and lateral constraint

Define `falloff(t,h)` as 1 for t<=h, 0 for t>=1, otherwise
`1 - (6*u^5 - 15*u^4 + 10*u^3)`, with `u=(t-h)/(1-h)` and 0<=h<1.
At each side, with all window radii multiplied by S:

```
Ry = q.y >= 0 ? yUp*S : yDown*S
txy = hypot(q.x/(window.x*S), q.y/Ry)
tz = q.z >= 0 ? q.z/(zFront*S) : -q.z/(zBack*S)
W(q) = falloff(txy, hardness) * falloff(tz, hardnessZ)
```

The window is C2 across its plateau and support boundary. It is exactly zero
outside the elliptical xy support or front/back slab. Op radius is independent
of this window. Kelvinlet kernels themselves have tails; the window cuts them off.

For body lateral coordinate x, b=midline*S and x_s=s*x, the side share is 1 if
x_s>=b, 0 if x_s<=-b, else `falloff((b-x_s)/(2*b),0)`. For positive b the two
shares sum to 1; the window weights need not sum to 1. A zero midline width gives
a step (the code chooses 1 for both sides exactly at x=0); use a positive width
when the partition-of-unity contract is needed.

Sum side displacement vectors after multiplying each by `W*share`. Then attenuate
their **total** lateral component: for m=midlineLock*S>0 and |x|<m use
`psi=t*(2-t)`, t=|x|/m; replace `dot(u,left)` by `psi*dot(u,left)`.
Outside this band, or with m<=0, leave u unchanged. This sets lateral motion to
zero on the midline. It is a constraint, not an unconditional no-crossing proof.
`field.weight(p)` returns the maximum side `W*share`; it is an early-out/ROI
weight and is not an extra multiplier on `field.delta`.

## Brush formulas

Brushes use side coordinates r=q-centre. The default kernel is `kelvinlet`;
`smooth` is an explicitly nonphysical baseline. Each op is mirrored to the other
side by its side frame. Optional `parity:-1` negates it on the right, enabling
antisymmetric dynamics. An omitted parity means +1.

The following is the tri-scale regularized Kelvinlet as implemented, including
normalization. Let a=1/(4*pi), b=a/(4*(1-nu)), e_i=eps*[1,2,4],
w_i=[1,-5/4,1/4], R_i=sqrt(dot(r,r)+e_i^2).

For grab with desired centre displacement d:

```
s1 = sum_i w_i * ((a-b)/R_i + a*e_i^2/(2*R_i^3))
s2 = sum_i w_i * b/R_i^3
Z  = sum_i w_i * (3*a-2*b)/(2*e_i)
u_grab(r) = (s1*d + s2*r*dot(r,d)) / Z
```

Thus u_grab(0)=d. For dilation, with c=2*b-a:

```
if abs(c) < 1e-9: u_scale = [0,0,0]
else:
  s = sum_i w_i*c*(1/R_i^3 + 3*e_i^2/(2*R_i^5))
  Z = sum_i w_i*c*5/(2*e_i^3)
  u_scale(r) = (k*s/Z)*r
```

It approaches k*r at the centre. eps must be positive for grab/scale and
0<=nu<=0.5; scale vanishes at nu=0.5 by the explicit branch. The exact implemented
tri-scale weights and normalization are part of the parity contract.

The smooth baseline is `d*falloff(|r|/(3*eps),0)` for grab and
`k*r*falloff(|r|/(3*eps),0)` for scale. A `linear` op is A*r with row-major A;
if radius>0, multiply by `falloff(|r|/radius,0)`, otherwise it is unbounded until
the common side window is applied. All brush types are summed before windowing.

For target k, u_k(p) is the side sum followed by lateral attenuation above.
The Jacobian is **central finite differences**, not a closed-form kernel
derivative: h=1e-3*S and
`J_k[i,j]=(u_k(p+h*e_j)[i]-u_k(p-h*e_j)[i])/(2*h)`.
Differentiate the complete field, including windows, shares and lateral lock.
For weights w, position is `p+sum_k w_k*u_k(p)` and gradient is
`F=I+sum_k w_k*J_k`. Always evaluate at the original bind position, not at an
already deformed point. Position superposition is exact apart from rounding.

## Masks and mesh-local baking

The skin mask is `clamp(1-sum(weights on excluded bones),0,1)` and is stored per
vertex. The viewer selects excluded arm/head bones from its rig configuration.
The field itself has no skin palette or material dependence. Seamed/coincident
vertices have identical displacements only when they also use identical masks
and field parameters. Field sharing alone does not guarantee garment clearance.

For a mesh-local vertex p_l, normal n_l, local-to-bind affine M and its linear
part L, with fixed vertex mask m:

```
p_b = M * p_l
deltaPositionLocal = inverse(L) * (m*u_k(p_b))
n_b = normalize(inverse(transpose(L)) * n_l)
F_k = I + m*J_k(p_b)
n_b' = normalize(inverse(transpose(F_k)) * n_b)
n_l' = normalize(transpose(L) * n_b') * length(n_l)
deltaNormalLocal = n_l' - n_l
```

This supports rotation and nonuniform scale in M. M must be invertible. At m=0
or outside the field ROI, deltas stay zero. If F is singular, the current baker
leaves that target's normal delta at zero: validation must reject such a state.
The normal rule treats m as constant locally. It does **not** include
`u outer gradient(m)` from a spatially varying mask; use geometric normal checks
near mask transitions. No tangent deltas are currently baked.

Outputs are Float32 xyz arrays. Blender shape-key positions are `base+dPos` in
mesh-local space. Unity's `Mesh.AddBlendShapeFrame(name,100,dPos,dNrm,null)` uses
the same local arrays; the driver converts normalized weights to 0..100. The
planned Unity import integration re-bakes normals from this field contract;
this repository's JS baker is not a complete Blender/FBX/Unity import pipeline.

Normal blending is nonlinear. Engines generally normalize
`n_0+sum_k w_k*(n_k-n_0)`, while the exact combined field gives
`normalize((I+sum_k w_k*J_k)^(-T)*n_0)`. These agree at a single target's baked
endpoint, but need not agree between endpoints or with combined targets.

## Slider mapping

Clamp size/lift/spread to [-1,1] and style to [0,1]. Defaults are zero except
style=0.5. Set up=max(size,0):

| Target | Weight |
| --- | --- |
| bust_size_up_natural | up*(1-style) |
| bust_size_up_stylized | up*style |
| bust_size_down | max(-size,0) |
| bust_lift_up / bust_lift_down | max(lift,0) / max(-lift,0) |
| bust_spread_out / bust_spread_in | max(spread,0) / max(-spread,0) |

These are one-sided [0,1] weights. Dynamics uses additional field targets and a
documented driver clamping policy in `runtime.js`; apply its actual signed
amplitude bounds when validating dynamic states.

## Validation and corrective recommendations

`fieldCheck` samples cell centres in each side's bounding box, skipping points
where `field.weight` is zero. Its default res=14. It tests size ±1, style 0/1
for positive size, lift -1/0/1 and spread -1/0/1 (27 UI states). It reports
the minimum det(F), its point/state, and per-target weighted mean/max sampled
local volume change det(I+J_k)-1. The `injective` flag means only that all sampled
determinants were positive. Positive sampled determinants are **not** proof of
global injectivity, unsampled local orientation, or discrete nonintersection.
Use min det>0.2 as the distillation margin; add adaptive/denser samples if close.

`meshCheck` compares displacement at quantized coincident vertices (1e-5*S),
and tests triangle normal orientation against its bind orientation over the
specified UI states. Its flip count is a diagnostic; a rotation beyond 90 degrees
can fail it without true inversion. It does not detect all self-intersections.
`normalCheck` compares analytic deltas with the minimal rotation between
area-weighted welded normals (weld grid 1e-6*S), reporting median/p95/max angle.
This tests shading-normal transport, not equality with geometric normals.
Garment gap and discrete intersection checks remain separate necessary gates.

`targetCombinations` enumerates target pairs and triples and every Cartesian
assignment from [0.25,0.5,0.75,1]. Seven standard targets give 2,576 states. These
include combinations the UI cannot produce; explicit `combinations` weight maps
can restrict the domain, or include signed dynamics weights. `sizes:[1,2,3]`
also checks individual-target in-betweens. Zero-weight/base states can be supplied
explicitly. `combinationCheck` caches J_k at each point, then reports per state:

- minimum det(F), sample index and every sample's determinant;
- normal error in degrees of linearly blended endpoint normal deltas versus
  exact combined F^-T, per sample plus mean/p95/max;
- recommended corrective states when max angle>3 degrees, min det<=0.2, or any
  normal transform is singular. A singular sample gets 180 degrees, never NaN.

Defaults use res=6 cell-centre points and all three coordinate-axis normals,
retaining the worst angle per point. This is a diagnostic normal set, not a bound
for every possible normal. Supply real bind-space `points` and one `normals`
vector per point for a mesh-specific map. `includeMaps:false` saves output memory
without changing summaries. Empty samples/combination sets and nonfinite inputs
are rejected. The supplied `targets` list must name available field targets.
The report identifies candidates; it does not generate corrective shape assets.
Use an in-between normal frame or joint corrective normal delta, or recompute
normals for the combined state. A determinant failure may instead require lower
amplitudes or refitting the field; a normal-only correction cannot repair it.

## Data formats

`docs/params.schema.json` describes base field parameters. `anchor`, `depth`,
`window` and `targets` are required. `targets` maps names to arrays of ops:

```
grab:   {type:"grab", at:[x,y,z], d:[x,y,z], radius, nu?}
scale:  {type:"scale", at:[x,y,z], k?, radius, nu?}
linear: {type:"linear", at:[x,y,z], A:[9 row-major numbers], radius?, parity?}
```

`nu` defaults to 0.45, omitted k to 0, omitted radius to 0 in runtime resolution
(grab/scale still require positive radius), parity to +1. `midline` defaults to
0.1 and `midlineLock` to 0.15. Only exact `kernel:"smooth"` selects the baseline;
other runtime values select Kelvinlets, while the schema restricts valid names.
Metadata keys prefixed `$`/`_` are ignored by field evaluation. Mask options
configure bake-time exclusions. A consumer should validate before evaluation.

The viewer's `exportBind()` produces `format:"bust-bind/1"` JSON with `frame`,
`params`, `bones` (semantic key to bone name), `bonePositions` (bind-space xyz),
and `meshes[]`. Each mesh contains:

| Member | Encoding and space |
| --- | --- |
| name, vertexCount | string and vertex count |
| positions | base64 little-endian Float32, 3*vertexCount, **already bind-space** |
| normals | base64 little-endian Float32 unit bind-space xyz, or null |
| index | base64 little-endian Uint32 triangle entries, or null for sequential triples |
| mask | base64 little-endian Float32 per vertex, or null for all 1 |
| bindMatrix | 16-number column-major local-to-bind matrix |
| groups | `{start,count,material}` index-entry ranges, not triangle counts |

Do not apply bindMatrix to exported positions a second time. Keep it to transform
computed deltas back to mesh-local coordinates. Decode typed data explicitly as
little-endian when the host byte order differs. Group ranges select body/garment
triangles in shared meshes; overlapping render groups must not double samples.

`docs/golden.json` has format `bust-golden/1`, version 1, DEFAULT_PARAMS, synthetic
joints and a rotated/translated frame (S=1.6), 213 points in/around both windows,
per-target displacement/Jacobian/three transformed normals, window/share/lock
factors, falloff probes, and slider cases. It contains **no model data**. The
generator hash is SHA-256 of named generator/core source files in listed order,
normalizing CRLF/CR to LF and adding filename/newline separators. There is no
timestamp. Regenerate with `npm run golden` in `web`; check without writing with
`node scripts/gen-golden.mjs --check`. The test regenerates and compares every
number within absolute 1e-12. Ports should use the stored frame, params, points
and normal inputs and compare the same quantities, preserving h=1e-3*S.

## Teacher → distillation → field → runtime

`docs/research/decision-v2.md` defines the architecture; these are its implemented
interfaces and limits. Offline teachers produce bind-space displacement samples
on skin, interior and an outer shell. Teacher A (`tools/teacher`) uses a proxy
tet volume and quasistatic elasticity, inverse rest shape and modal analysis.
Teacher B is planned to apply normal-directed ARAP on top of a size input; its
partial implementation remains unfinished at `wip/phase1/darap-stylize`, and
there is currently no integrated `tools/stylize` package. These computationally
expensive stages propose shape, rather than running per frame. Their convergence
and collision criteria require their own validation.

`tools/bustfield` fits fixed-centre brush amplitudes to those samples with ridge
least squares, preserving linear amplitude superposition. Distillation checks
fidelity and determinant margin, then writes ordinary field params. This shared
field transfers displacement to tight layers and bakes shapes. Bridging garments
need separate inpainting/contact correction; loose garments require a separate
cloth bake. Model data and generated teacher/renders belong in ignored caches.

The current viewer imports raw field params or `bust-morph-params/1` exports as
named A/B presets and preserves their fitted anchors instead of automatically
fitting them again. It bakes dedicated runtime targets with `withRuntimeTargets`
and combines sliders, pose correction and signed dynamics with `bustWeights`.
The HUD measures the baked bind-space shape using cached prepared geometry and
updates on a throttled schedule; it does not measure the currently skinned pose.
Character profiles provide explicit bone names, material roles and optional
region overrides. Their JSON format and viewer controls are documented in
[`VIEWER.md`](VIEWER.md).

At runtime, `modal.js`/`runtime.js` integrate damped modes with exact oscillator
steps, reset on cuts, and combine user sliders with dynamics and pose correction.
`vskin.js` adds linear field bases for velocity/acceleration stylization. The
renderer consumes baked position/normal arrays and weights. Teacher generation,
distillation, combination diagnostics and any port-specific re-bake stay offline.
The golden fixture verifies the delivery layer; it does not certify teacher
physics, garment collision freedom or aesthetic quality.
