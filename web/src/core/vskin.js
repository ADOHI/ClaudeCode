// Velocity-Skinning-style stylization, linearized into field targets.
//
// Velocity Skinning (Rohmer et al., EG 2021) deforms a part from its motion:
// "squashy" stretches it along its velocity (volume preserving), "floppy"
// makes it lag behind the rotation. Linearized around rest, both are affine
// fields u = A r around a centre, so they are exactly 'linear' field ops
// (field.js) and bake like every other target: windowed by W, midline-locked,
// identical on every clothing layer, analytic F^-T normals, det-checked.
//
//   squashy (5): A = traceless symmetric stretch tensor. The space of
//                traceless symmetric 3x3 matrices is 5-dimensional, so 5
//                orthonormal basis shapes represent it EXACTLY (no
//                approximation beyond linearization of the stretch).
//                Centre: breast centroid. Symmetric parity.
//   floppy  (3): A = skew(theta), the first-order (small-angle) rotation of
//                the breast about its base, lagging the chest's angular
//                velocity. A body-frame angular velocity is a pseudovector:
//                its x part (pitch) is mirror-symmetric, y (yaw) and z
//                (roll) are antisymmetric, so floppy_x / _y / _z use parity
//                +1 / -1 / -1 and represent ANY chest rotation exactly.
//   drag    (3): follow-through. A = e_i e_z^T / depth: the tip trails the
//                tissue's own motion relative to the chest, displacement
//                growing linearly from the chest wall (0) to the apex. x drag
//                is antisymmetric (in-phase sway is the common lateral
//                motion), y / z drags symmetric.
//
// Drivers (all available at runtime without bones):
//   squashy <- per-side modal relative velocity v (and optionally
//              displacement y): T = k (3/2 v v^T/|v| - |v|/2 I)
//   floppy  <- chest angular velocity w and angular acceleration alpha:
//              theta = -(k_w w + k_a alpha)
//   drag    <- per-side modal relative velocity: tip lag = -k v
// Per-side weights are split into the symmetric / antisymmetric parts the
// targets can express ((L + R)/2 or (L - R)/2). The dropped part of squashy
// and drag is zero for purely symmetric or purely antisymmetric motion; use
// `full: true` for both parities of every shape (22 targets).

import { DEFAULT_PARAMS } from './field.js';

const R2 = Math.SQRT1_2, R6 = 1 / Math.sqrt(6);

// Orthonormal (Frobenius) basis of traceless symmetric 3x3 matrices.
export const SQUASH_BASIS = [
  { key: 'a', E: [R2, 0, 0, 0, -R2, 0, 0, 0, 0] }, // xx - yy
  { key: 'b', E: [R6, 0, 0, 0, R6, 0, 0, 0, -2 * R6] }, // xx + yy - 2 zz
  { key: 'xy', E: [0, R2, 0, R2, 0, 0, 0, 0, 0] },
  { key: 'xz', E: [0, 0, R2, 0, 0, 0, R2, 0, 0] },
  { key: 'yz', E: [0, 0, 0, 0, 0, R2, 0, R2, 0] },
];

// skew(e_i): u = e_i x r.
const SKEW = {
  x: [0, 0, 0, 0, 0, -1, 0, 1, 0],
  y: [0, 0, 1, 0, 0, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 0],
};
// e_i e_z^T: u_i = r_z.
const SHEAR = {
  x: [0, 0, 1, 0, 0, 0, 0, 0, 0],
  y: [0, 0, 0, 0, 0, 1, 0, 0, 0],
  z: [0, 0, 0, 0, 0, 0, 0, 0, 1],
};

export const DEFAULT_VSKIN = {
  enabled: true,
  // Magnitude of each family at weight-vector norm 1 (= the maximum: every
  // family is limited by the NORM of its weight vector, because its weights
  // are the coordinates of one tensor / vector, not independent knobs).
  squashAmp: 0.15, // Frobenius norm of the stretch tensor (0.15 = 12 % stretch along v)
  floppyAmp: 0.15, // rotation angle (rad)
  dragAmp: 0.04, // tip displacement (S units)
  // C2 localization radii of the linear ops (S units, 0 = window only). An
  // affine field keeps growing with distance, and the window alone lets it
  // fold space in front of the apex (measured: min det -0.15 with all
  // families at max); localized, it behaves like the Kelvinlet brushes.
  squashRadius: 0.45,
  floppyRadius: 0.6,
  dragRadius: 0.6,
  // Driver gains.
  squash: 0.1, // strain per (S/s) of relative velocity
  squashDisp: 0, // strain per S of relative displacement (legacy-style stretch)
  floppy: 0.04, // rad per (rad/s) of chest angular velocity
  floppyAccel: 0.002, // rad per (rad/s^2) of chest angular acceleration
  drag: 0.04, // tip lag (S) per (S/s) of relative velocity
  full: false, // both parities for every shape
  limit: 1, // bound on the weight-vector norm of each family, per side
  softLimit: true, // tanh saturation of that norm instead of a hard clamp
};

const PARITY = {
  squash: { a: 1, b: 1, xy: 1, xz: 1, yz: 1 },
  floppy: { x: 1, y: -1, z: -1 },
  drag: { x: -1, y: 1, z: 1 },
};

/**
 * The basis: [{name, family, key, parity, A (at weight 1), at, radius}] with
 * `at` relative to the apex (S units, side frame), like every field op.
 */
export function vskinShapes(params = DEFAULT_PARAMS, opts = {}) {
  const o = { ...DEFAULT_VSKIN, ...opts };
  const depth = params.depth;
  const centroid = [0, 0, -0.6 * depth]; // = base + 0.4 depth (modal.js)
  const base = [0, 0, -depth];
  const out = [];
  const push = (family, key, A, at, radius) => {
    const parities = o.full ? [1, -1] : [PARITY[family][key]];
    for (const parity of parities) {
      const suffix = o.full ? (parity > 0 ? '_sym' : '_anti') : '';
      out.push({ name: `bust_vs_${family}_${key}${suffix}`, family, key, parity, A, at, radius });
    }
  };
  for (const { key, E } of SQUASH_BASIS) push('squash', key, E.map((v) => v * o.squashAmp), centroid, o.squashRadius);
  for (const key of ['x', 'y', 'z']) push('floppy', key, SKEW[key].map((v) => v * o.floppyAmp), base, o.floppyRadius);
  for (const key of ['x', 'y', 'z']) push('drag', key, SHEAR[key].map((v) => (v * o.dragAmp) / depth), base, o.dragRadius);
  return out;
}

/** Field targets {name: [linear op]} for the basis (pairs: _pos/_neg). */
export function vskinTargets(params = DEFAULT_PARAMS, opts = {}) {
  const { pairs = false } = opts;
  const out = {};
  for (const s of vskinShapes(params, opts)) {
    const op = (sgn) => {
      const o = { type: 'linear', at: s.at.slice(), A: s.A.map((v) => sgn * v) };
      if (s.radius > 0) o.radius = s.radius;
      if (s.parity < 0) o.parity = -1;
      return o;
    };
    if (pairs) {
      out[`${s.name}_pos`] = [op(1)];
      out[`${s.name}_neg`] = [op(-1)];
    } else out[s.name] = [op(1)];
  }
  return out;
}

// Velocity-Skinning stretch tensor along v: k (3/2 v v^T / |v| - |v| / 2 I).
// Traceless (volume preserving to first order), continuous at v = 0.
export function stretchTensor(v, k) {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n === 0 || k === 0) return new Array(9).fill(0);
  const T = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) T[i * 3 + j] = k * ((1.5 * v[i] * v[j]) / n - (i === j ? 0.5 * n : 0));
  return T;
}

const fro = (A, B) => A.reduce((s, a, i) => s + a * B[i], 0);

// Limit the Euclidean norm of a weight vector (smoothly by default).
export function limitNorm(w, lim, soft = true) {
  const n = Math.hypot(...w);
  if (n === 0) return w;
  const m = soft ? lim * Math.tanh(n / lim) : Math.min(n, lim);
  return w.map((x) => (x * m) / n);
}

/**
 * Signed weights of the basis targets.
 * @param {object} input
 * @param {number[]} input.omega chest angular velocity, body frame (rad/s)
 * @param {number[]} input.alpha chest angular acceleration, body frame (rad/s^2)
 * @param {{L:{y:number[],v:number[]},R:{y:number[],v:number[]}}} input.side
 *        modal relative displacement / velocity per side, side frame (S, S/s)
 * @returns {Object<string, number>}
 */
export function vskinWeights(input, opts = {}) {
  const o = { ...DEFAULT_VSKIN, ...opts };
  const out = {};
  if (!o.enabled) return out;
  const lim = (w) => limitNorm(w, o.limit, o.softLimit);
  const put = (family, keys, wL, wR) =>
    keys.forEach((key, i) => {
      const sym = (wL[i] + wR[i]) / 2, anti = (wL[i] - wR[i]) / 2;
      if (o.full) {
        out[`bust_vs_${family}_${key}_sym`] = sym;
        out[`bust_vs_${family}_${key}_anti`] = anti;
      } else out[`bust_vs_${family}_${key}`] = PARITY[family][key] > 0 ? sym : anti;
    });

  // squashy: per-side tensor projected on the orthonormal basis.
  const sq = {};
  for (const s of ['L', 'R']) {
    const st = input.side?.[s] ?? { y: [0, 0, 0], v: [0, 0, 0] };
    const a = stretchTensor(st.v, o.squash), b = stretchTensor(st.y, o.squashDisp);
    const T = a.map((x, i) => x + b[i]);
    sq[s] = lim(SQUASH_BASIS.map(({ E }) => fro(T, E) / o.squashAmp));
  }
  put('squash', SQUASH_BASIS.map((b) => b.key), sq.L, sq.R);

  // floppy: lag rotation, body frame -> side frames (pseudovector mirror).
  const w = input.omega ?? [0, 0, 0], al = input.alpha ?? [0, 0, 0];
  const th = lim([0, 1, 2].map((i) => -(o.floppy * w[i] + o.floppyAccel * al[i]) / o.floppyAmp));
  put('floppy', ['x', 'y', 'z'], th, [th[0], -th[1], -th[2]]);

  // drag: the tip trails the relative velocity.
  const dr = {};
  for (const s of ['L', 'R']) dr[s] = lim((input.side?.[s]?.v ?? [0, 0, 0]).map((v) => (-o.drag * v) / o.dragAmp));
  put('drag', ['x', 'y', 'z'], dr.L, dr.R);
  return out;
}
