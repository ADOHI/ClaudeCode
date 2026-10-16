// Regularized Kelvinlets (de Goes & James, "Regularized Kelvinlets: Sculpting
// Brushes based on Fundamental Solutions of Elasticity", SIGGRAPH 2017,
// Pixar Technical Memo #17-03).
//
// Closed-form displacement of an infinite linear-elastic medium under a
// regularized point load. Implemented with the full tensor term (b r r^T f),
// which Blender's Elastic Deform brush approximates by a scalar; the full form
// is what makes nu = 0.5 volume preserving.
//
// Multi-scale extrapolation (tri-scale, eps_i = eps * {1, 2, 4}) cancels the
// 1/r and 1/r^3 far-field terms so the displacement decays as 1/r^5 -> local.
// Weights match Blender's BKE_kelvinlet_grab_triscale.

const EPS_SCALE = [1, 2, 4];

function triWeights(e) {
  const [e1, e2, e3] = e.map((x) => x * x);
  return [1, -(e3 - e1) / (e3 - e2), (e2 - e1) / (e3 - e2)];
}
const W = triWeights(EPS_SCALE);

// Shear modulus cancels after normalization; use mu = 1.
function coeffs(nu) {
  const a = 1 / (4 * Math.PI);
  const b = a / (4 * (1 - nu));
  return { a, b };
}

/**
 * Grab brush: displacement at offset r (point - centre) such that the
 * displacement at the centre equals `d` exactly.
 * @param {number[]} r offset from brush centre
 * @param {number[]} d desired displacement at the centre
 * @param {number} eps brush radius (regularization)
 * @param {number} nu Poisson ratio in [0, 0.5]
 */
export function grab(r, d, eps, nu) {
  const { a, b } = coeffs(nu);
  const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  const rd = r[0] * d[0] + r[1] * d[1] + r[2] * d[2];
  let s1 = 0, s2 = 0, norm = 0;
  for (let i = 0; i < 3; i++) {
    const e = eps * EPS_SCALE[i];
    const re2 = r2 + e * e;
    const re = Math.sqrt(re2);
    const re3 = re2 * re;
    s1 += W[i] * ((a - b) / re + (a * e * e) / (2 * re3));
    s2 += W[i] * (b / re3);
    norm += W[i] * ((3 * a - 2 * b) / (2 * e)); // u_eps(0) / f
  }
  // u = (s1 I + s2 r r^T) f, with f = d / norm.
  const k1 = s1 / norm, k2 = (s2 * rd) / norm;
  return [k1 * d[0] + k2 * r[0], k1 * d[1] + k2 * r[1], k1 * d[2] + k2 * r[2]];
}

/**
 * Scale (dilation) brush: near the centre u ~= k * r. Needs nu < 0.5 (an
 * incompressible medium cannot dilate: the (2b - a) factor vanishes).
 * @param {number[]} r offset from brush centre
 * @param {number} k dilation rate at the centre (0.3 => +30% locally)
 */
export function scaleBrush(r, k, eps, nu) {
  const { a, b } = coeffs(nu);
  const c = 2 * b - a;
  if (Math.abs(c) < 1e-9) return [0, 0, 0];
  const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  let s = 0, norm = 0;
  for (let i = 0; i < 3; i++) {
    const e = eps * EPS_SCALE[i];
    const re2 = r2 + e * e;
    const re = Math.sqrt(re2);
    const re3 = re2 * re, re5 = re3 * re2;
    s += W[i] * c * (1 / re3 + (3 * e * e) / (2 * re5));
    norm += W[i] * c * (5 / (2 * e * e * e)); // value of the bracket at r = 0
  }
  const f = (k * s) / norm;
  return [f * r[0], f * r[1], f * r[2]];
}

// Non-physical baseline kernels (smootherstep falloff) for A/B comparison.
function smoother(t) {
  if (t >= 1) return 0;
  return 1 - t * t * t * (t * (t * 6 - 15) + 10);
}
export function grabSmooth(r, d, eps) {
  const f = smoother(Math.hypot(r[0], r[1], r[2]) / (eps * 3));
  return [d[0] * f, d[1] * f, d[2] * f];
}
export function scaleSmooth(r, k, eps) {
  const f = k * smoother(Math.hypot(r[0], r[1], r[2]) / (eps * 3));
  return [r[0] * f, r[1] * f, r[2] * f];
}
