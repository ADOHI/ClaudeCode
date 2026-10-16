// Bust deformation field.
//
// Every blend shape is a smooth displacement field defined in *bind space*
// (the space skinned vertices and bones share at bind/rest pose), baked by
// evaluating it at each vertex. Because it depends only on position (plus an
// optional skin-weight mask), split vertices on UV seams and separate meshes
// (body, bra, top, jacket...) get identical displacement: seams never open and
// clothing layers keep their order as long as the field is injective
// (det(I + J) > 0, checked by validate.js).
//
// Field of one target  =  sum over sides  W(q) * sum over brushes K(p)
//   W : compact C2 window around each breast (hard guarantee of locality)
//   K : regularized Kelvinlet brushes (grab / scale), see kelvinlet.js
//
// docs/METHOD.md is the specification; docs/golden.json holds reference values
// the Blender / Unity ports are checked against.

import { add, sub, scale, dot, cross, length, normalize, clamp } from './vec.js';
import { grab, scaleBrush, grabSmooth, scaleSmooth } from './kelvinlet.js';

// Bipolar UI sliders -> one-sided blend shapes (weights stay 0..1, i.e.
// Unity 0..100). `style` mixes the two size-up variants:
//   size_up_natural  * size * (1 - style)  +  size_up_stylized * size * style
export function sliderToWeights({ size = 0, style = 0.5, lift = 0, spread = 0 }) {
  size = clamp(size, -1, 1);
  style = clamp(style, 0, 1);
  lift = clamp(lift, -1, 1);
  spread = clamp(spread, -1, 1);
  const up = Math.max(size, 0);
  return {
    bust_size_up_natural: up * (1 - style),
    bust_size_up_stylized: up * style,
    bust_size_down: Math.max(-size, 0),
    bust_lift_up: Math.max(lift, 0),
    bust_lift_down: Math.max(-lift, 0),
    bust_spread_out: Math.max(spread, 0),
    bust_spread_in: Math.max(-spread, 0),
  };
}

// All lengths are in units of S (shoulder width = distance between the two
// upper-arm joints), so the same parameters work in meters, centimeters, and
// across Blender / FBX / Unity scale conventions.
//
// Brush positions `at` are in the side frame relative to the apex:
//   x = outward (away from the midline), y = up, z = forward.
// Brush displacements `d` use the same axes (S units). Scale brushes take a
// dimensionless dilation rate `k` (0.3 ~ +30% locally around the centre).
export const DEFAULT_PARAMS = {
  // Base centre of each breast in the body frame, relative to the chest
  // origin: x = distance from the midline, y = up, z = forward. The apex is
  // `depth` in front of it.
  anchor: { x: 0.24, y: 0.05, z: 0.2 },
  depth: 0.2,
  // Compact window around the base centre (side frame radii) with a plateau
  // fraction (`hardness`) before the smootherstep falloff.
  // (yDown must leave room below the lower pole: a tight window there folds
  // space when size_up + lift_down stack; validate.js checks det(F) > 0.)
  window: { x: 0.32, yUp: 0.44, yDown: 0.42, zFront: 1.0, zBack: 0.3, hardness: 0.15, hardnessZ: 0.3 },
  // Half-width of the midline blend band. Left/right fields are multiplied by
  // a partition of unity across the midline (they blend instead of adding),
  // so overlapping windows cannot double the displacement at the cleavage.
  midline: 0.1,
  // Width of the band around the midline where lateral motion is locked to 0
  // at the plane (see lockLateral in createBustField).
  midlineLock: 0.15,
  kernel: 'kelvinlet', // 'kelvinlet' | 'smooth' (non-physical baseline for A/B)
  targets: {
    // Natural growth: lower pole grows more (≈45:55 upper:lower), slight
    // gravity on the apex, nearly incompressible tissue around it.
    bust_size_up_natural: [
      { type: 'scale', at: [0, -0.04, -0.09], k: 0.55, radius: 0.19, nu: 0.2 },
      { type: 'grab', at: [0, -0.03, -0.08], d: [0.0, -0.03, 0.015], radius: 0.2, nu: 0.45 },
    ],
    // Stylized growth: fuller, rounder upper pole, gravity-defying apex that
    // tilts up and projects forward (anime-style appeal).
    bust_size_up_stylized: [
      { type: 'scale', at: [0, 0.015, -0.09], k: 0.6, radius: 0.19, nu: 0.2 },
      { type: 'grab', at: [0, 0.0, -0.08], d: [0.0, 0.035, 0.025], radius: 0.21, nu: 0.45 },
    ],
    bust_size_down: [
      { type: 'scale', at: [0, -0.02, -0.09], k: -0.4, radius: 0.19, nu: 0.2 },
      { type: 'grab', at: [0, 0, -0.08], d: [0, 0.01, -0.015], radius: 0.2, nu: 0.45 },
    ],
    bust_lift_up: [{ type: 'grab', at: [0, 0, -0.08], d: [0, 0.07, 0.005], radius: 0.19, nu: 0.48 }],
    bust_lift_down: [{ type: 'grab', at: [0, 0, -0.08], d: [0, -0.08, -0.005], radius: 0.19, nu: 0.48 }],
    bust_spread_out: [{ type: 'grab', at: [0, 0, -0.08], d: [0.065, 0, 0], radius: 0.19, nu: 0.48 }],
    bust_spread_in: [{ type: 'grab', at: [0, 0, -0.08], d: [-0.065, 0, 0], radius: 0.19, nu: 0.48 }],
  },
  mask: { excludeArms: true, excludeHead: true },
};

export const TARGETS = Object.keys(DEFAULT_PARAMS.targets);

export function cloneParams(p) {
  return JSON.parse(JSON.stringify(p));
}

// Body frame from five bind-space joint positions. Assumes a right-handed
// coordinate system (three.js, Blender, glTF). A Unity (left-handed) port must
// flip the cross product: forward = cross(up, left).
export function buildBodyFrame({ hips, chest, neck, leftUpperArm, rightUpperArm }) {
  const lr = sub(leftUpperArm, rightUpperArm);
  const S = length(lr);
  const left = normalize(lr);
  const upRaw = sub(neck, hips);
  const up = normalize(sub(upRaw, scale(left, dot(upRaw, left))));
  const forward = cross(left, up);
  const mid = scale(add(leftUpperArm, rightUpperArm), 0.5);
  // Chest joint projected onto the midline (sagittal) plane.
  const origin = sub(chest, scale(left, dot(sub(chest, mid), left)));
  const frame = { origin, left, up, forward, S };
  frame.hipsY = toBody(frame, hips)[1];
  frame.neckY = toBody(frame, neck)[1];
  return frame;
}

export function toBody(f, p) {
  const d = sub(p, f.origin);
  return [dot(d, f.left), dot(d, f.up), dot(d, f.forward)];
}

export function fromBody(f, b) {
  return [
    f.origin[0] + f.left[0] * b[0] + f.up[0] * b[1] + f.forward[0] * b[2],
    f.origin[1] + f.left[1] * b[0] + f.up[1] * b[1] + f.forward[1] * b[2],
    f.origin[2] + f.left[2] * b[0] + f.up[2] * b[1] + f.forward[2] * b[2],
  ];
}

// 1 inside the plateau, smootherstep (C2) down to 0 at t = 1.
export function falloff(t, hard) {
  if (t <= hard) return 1;
  if (t >= 1) return 0;
  const u = (t - hard) / (1 - hard);
  return 1 - u * u * u * (u * (u * 6 - 15) + 10);
}

export function createBustField(frame, params = DEFAULT_PARAMS) {
  const S = frame.S;
  const P = params;
  const Wn = P.window;
  const R = {
    x: Wn.x * S,
    yUp: Wn.yUp * S,
    yDown: Wn.yDown * S,
    zFront: Wn.zFront * S,
    zBack: Wn.zBack * S,
  };
  const depth = P.depth * S;
  const physical = P.kernel !== 'smooth';

  const sides = [1, -1].map((s) => {
    const xAxis = scale(frame.left, s);
    const base = fromBody(frame, [s * P.anchor.x * S, P.anchor.y * S, P.anchor.z * S]);
    const apex = add(base, scale(frame.forward, depth));
    return { s, xAxis, base, apex };
  });

  // Pre-resolve brushes into side-frame coordinates (absolute units) relative
  // to the base centre, so evaluation is a few dot products + kernels.
  const targets = {};
  for (const [name, ops] of Object.entries(P.targets)) {
    targets[name] = ops.map((op) => ({
      type: op.type,
      at: [op.at[0] * S, op.at[1] * S, op.at[2] * S + depth],
      d: op.d ? op.d.map((v) => v * S) : null,
      k: op.k ?? 0,
      eps: op.radius * S,
      nu: op.nu ?? 0.45,
    }));
  }

  function windowWeight(q) {
    const ry = q[1] >= 0 ? R.yUp : R.yDown;
    const wl = falloff(Math.hypot(q[0] / R.x, q[1] / ry), Wn.hardness);
    if (wl === 0) return 0;
    const wz = q[2] >= 0 ? falloff(q[2] / R.zFront, Wn.hardnessZ) : falloff(-q[2] / R.zBack, Wn.hardnessZ);
    return wl * wz;
  }

  function toSide(side, p) {
    const d = sub(p, side.base);
    return [dot(d, side.xAxis), dot(d, frame.up), dot(d, frame.forward)];
  }

  // Partition of unity across the midline: phi_L + phi_R = 1 (C2).
  const mid = (P.midline ?? 0.1) * S;
  function sideShare(side, p) {
    const x = side.s * dot(sub(p, frame.origin), frame.left); // >0 on this side
    if (x >= mid) return 1;
    if (x <= -mid) return 0;
    return falloff((mid - x) / (2 * mid), 0);
  }

  // Window weight of one side including the midline share.
  function sideWeight(side, p, q) {
    const w = windowWeight(q);
    return w === 0 ? 0 : w * sideShare(side, p);
  }

  function fromSideVec(side, v) {
    const a = side.xAxis, u = frame.up, f = frame.forward;
    return [
      a[0] * v[0] + u[0] * v[1] + f[0] * v[2],
      a[1] * v[0] + u[1] * v[1] + f[1] * v[2],
      a[2] * v[0] + u[2] * v[1] + f[2] * v[2],
    ];
  }

  // Unwindowed brush sum in the side frame.
  function brushes(name, q) {
    const ops = targets[name];
    if (!ops) throw new Error(`unknown target ${name}`);
    let u = [0, 0, 0];
    for (const op of ops) {
      const r = [q[0] - op.at[0], q[1] - op.at[1], q[2] - op.at[2]];
      let v;
      if (op.type === 'grab') v = physical ? grab(r, op.d, op.eps, op.nu) : grabSmooth(r, op.d, op.eps);
      else if (op.type === 'scale') v = physical ? scaleBrush(r, op.k, op.eps, op.nu) : scaleSmooth(r, op.k, op.eps);
      else throw new Error(`unknown brush ${op.type}`);
      u = add(u, v);
    }
    return u;
  }

  // Max side weight over both sides (0 => outside the support).
  function weight(p) {
    let m = 0;
    for (const side of sides) m = Math.max(m, sideWeight(side, p, toSide(side, p)));
    return m;
  }

  // Midline constraint: the lateral (body-x) component is multiplied by
  // psi(|x| / m), psi(t) = t(2 - t) for t < 1, so points near the sagittal
  // plane cannot cross it (no left/right interpenetration at the cleavage)
  // and midline vertices of symmetric meshes stay exactly on the midline.
  // Safe (no crossing) while the lateral displacement stays below m / 2.
  const midLock = (P.midlineLock ?? 0.15) * S;
  function lockLateral(p, d) {
    if (midLock <= 0) return d;
    const x = Math.abs(dot(sub(p, frame.origin), frame.left));
    if (x >= midLock) return d;
    const t = x / midLock;
    const k = t * (2 - t) - 1; // psi - 1
    const dl = dot(d, frame.left) * k;
    return [d[0] + frame.left[0] * dl, d[1] + frame.left[1] * dl, d[2] + frame.left[2] * dl];
  }

  // Bind-space displacement of target `name` at bind-space point p (unmasked).
  function delta(name, p) {
    let out = [0, 0, 0];
    let any = false;
    for (const side of sides) {
      const q = toSide(side, p);
      const w = sideWeight(side, p, q);
      if (w === 0) continue;
      any = true;
      out = add(out, scale(fromSideVec(side, brushes(name, q)), w));
    }
    return any ? lockLateral(p, out) : out;
  }

  // Jacobian d(delta)/dp, row-major 3x3, by central differences.
  const h = 1e-3 * S;
  function jacobian(name, p) {
    const J = new Array(9);
    for (let j = 0; j < 3; j++) {
      const pp = p.slice(), pm = p.slice();
      pp[j] += h;
      pm[j] -= h;
      const a = delta(name, pp), b = delta(name, pm);
      for (let i = 0; i < 3; i++) J[i * 3 + j] = (a[i] - b[i]) / (2 * h);
    }
    return J;
  }

  // Side-frame bounding box of the support, for validation sampling.
  const box = { x: [-R.x, R.x], y: [-R.yDown, R.yUp], z: [-R.zBack, R.zFront] };

  return {
    frame,
    params: P,
    sides,
    targets: Object.keys(targets),
    weight,
    windowWeight,
    delta,
    jacobian,
    toSide,
    fromSideVec,
    box,
    S,
  };
}
