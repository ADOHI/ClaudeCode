// Modal secondary motion as blend-shape weight drivers.
//
// Each mode k is a damped oscillator in a modal coordinate q_k (mass
// normalized, phi^T M phi = 1) driven by the inertial load of the chest's
// rigid motion, written in the chest (body) frame:
//
//   q'' + 2 zeta w q' + w^2 q = -phi^T M (a + alpha x r + w x (w x r) + 2 w x v - dg)
//                              = -p.a - prot.alpha + (|w|^2 tr C - w^T C w)
//                                - 2 sum_j (w . G_jk) q_j' + p.dg
//
// with the participation terms precomputed per mode:
//   p    = sum_i m_i phi_i            (linear acceleration)
//   prot = sum_i m_i r_i x phi_i      (angular acceleration / Euler)
//   C    = sum_i m_i phi_i r_i^T      (centrifugal; 3x3 row-major)
//   G_jk = sum_i m_i phi_j,i x phi_k,i (Coriolis / gyroscopic coupling)
// and dg = gravity in the body frame minus gravity at the (upright) rest pose,
// because the rest shape already contains the rest sag.
//
// Per mode the ODE is integrated with the EXACT solution for a forcing that
// varies linearly or quadratically over the step (first / second-order
// hold): no substeps, any dt, unconditionally stable, and the result does
// not depend on how the time span is cut into frames (up to how well the
// forcing is sampled). (Textbook exact discretization of a damped linear
// oscillator; no paper citation intended, see critique-v2 section 1.) The
// only non-exact term is the Coriolis coupling between modes, evaluated on
// a predicted trajectory at the start / middle / end of the step.
//
// Until FEM modes exist (decision-v2 3(d)), `pseudoModes` builds the six
// rigid translations of two point masses at the breast centroids: three
// mirror-symmetric (bounce, surge, breathe) and three antisymmetric (sway,
// seesaw, twist). They drive grab targets that are the existing lift /
// spread / size shapes in "compat" mapping, or dedicated targets
// (`modeTargets`, baked like any field target).

import { add, scale, cross, dot, normalize } from './vec.js';
import { DEFAULT_PARAMS } from './field.js';

// ---------------------------------------------------------------- art params

/** Damping ratio for a step-response overshoot fraction (0.25 = 25 %). */
export function dampingFromOvershoot(os) {
  if (!(os > 0)) return 1; // no overshoot: critically damped
  if (os >= 1) return 0;
  const l = Math.log(os);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}

export function overshootFromDamping(zeta) {
  if (zeta >= 1) return 0;
  if (zeta <= 0) return 1;
  return Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
}

// Decay rate of the slowest part of the free response (the envelope).
function envelopeRate(zeta) {
  return zeta < 1 ? zeta : zeta - Math.sqrt(zeta * zeta - 1);
}

/**
 * Natural frequency (rad/s) whose response envelope decays to `tol` of the
 * initial kick after `settle` seconds (2 % settling time by default).
 */
export function omegaFromSettle(settle, zeta, tol = 0.02) {
  return Math.log(1 / tol) / (Math.max(envelopeRate(zeta), 1e-3) * settle);
}

export function settleFromOmega(omega, zeta, tol = 0.02) {
  return Math.log(1 / tol) / (Math.max(envelopeRate(zeta), 1e-3) * omega);
}

/**
 * Resolve a mode's art parameters to {omega, zeta}. Accepts either
 * {overshoot, settle} (artist-facing) or {frequency (Hz) | omega, zeta}.
 */
export function modeArt(m) {
  const zeta = m.overshoot !== undefined ? dampingFromOvershoot(m.overshoot) : m.zeta ?? 0.25;
  let omega;
  if (m.settle !== undefined) omega = omegaFromSettle(m.settle, zeta, m.settleTol ?? 0.02);
  else if (m.omega !== undefined) omega = m.omega;
  else omega = 2 * Math.PI * (m.frequency ?? 2.4);
  return { omega, zeta };
}

// ---------------------------------------------------------------- exact step

/**
 * Coefficients of the exact homogeneous step of x'' + 2 zeta w x' + w^2 x = 0
 * over h: x(h) = Cc x0 + Cs (v0 + zeta w x0), v(h) = Cc v0 - Cs (w^2 x0 + zeta w v0).
 * Valid for every zeta >= 0 (under-, critically and over-damped).
 */
export function stepCoeffs(h, omega, zeta) {
  const zw = zeta * omega;
  const mu = omega * omega * (1 - zeta * zeta); // damped frequency^2 (< 0 if overdamped)
  const x = mu * h * h;
  let Cc, Cs;
  if (Math.abs(x) < 1e-3) {
    // Series of cos(sqrt(mu) h) and sin(sqrt(mu) h)/sqrt(mu) around zeta = 1.
    const d = Math.exp(-zw * h);
    Cc = d * (1 - x / 2 + (x * x) / 24 - (x * x * x) / 720);
    Cs = d * h * (1 - x / 6 + (x * x) / 120 - (x * x * x) / 5040);
  } else if (mu > 0) {
    const wd = Math.sqrt(mu), d = Math.exp(-zw * h);
    Cc = d * Math.cos(wd * h);
    Cs = (d * Math.sin(wd * h)) / wd;
  } else {
    // Overdamped: combine exponentials directly so large h cannot overflow.
    const g = Math.sqrt(-mu);
    const ep = Math.exp((-zw + g) * h), em = Math.exp((-zw - g) * h);
    Cc = (ep + em) / 2;
    Cs = (ep - em) / (2 * g);
  }
  return { h, omega, zeta, Cc, Cs };
}

/**
 * Advance st = {q, v} by k.h under a forcing given at the start (f0) and end
 * (f1) of the step, and optionally at its middle (fm): linear (first-order
 * hold) or quadratic (second-order hold) in time. Exact for that forcing:
 * the particular solution q_p = A + B t + C t^2 plus the free response.
 */
export function oscillatorStep(st, k, f0, f1, fm) {
  const { h, omega: w, zeta: z, Cc, Cs } = k;
  const w2 = w * w;
  // f(t) = f0 + c1 t + c2 t^2 through (0, f0), (h/2, fm), (h, f1).
  const c2 = fm === undefined ? 0 : (2 * (f0 - 2 * fm + f1)) / (h * h);
  const c1 = (f1 - f0) / h - c2 * h;
  const C = c2 / w2;
  const B = (c1 - 4 * z * w * C) / w2;
  const A = (f0 - 2 * C - 2 * z * w * B) / w2;
  const e0 = st.q - A, e1 = st.v - B;
  st.q = Cc * e0 + Cs * (e1 + z * w * e0) + A + (B + C * h) * h;
  st.v = Cc * e1 - Cs * (w2 * e0 + z * w * e1) + B + 2 * C * h;
  return st;
}

// Value at t of the quadratic through (0, f0), (h/2, fm), (h, f1).
export function quadAt(f0, fm, f1, h, t) {
  const c2 = (2 * (f0 - 2 * fm + f1)) / (h * h);
  const c1 = (f1 - f0) / h - c2 * h;
  return f0 + (c1 + c2 * t) * t;
}

// ---------------------------------------------------------------- pseudo-modes

// Rigid translations of the two breast masses. `dir` is in the side frame
// (x outward, y up, z forward); parity +1 = both sides do the same thing in
// their (mirrored) side frames, -1 = opposite. Body-frame meaning:
//   bounce  sym  y : both up/down            <- vertical accel, pitch
//   surge   sym  z : both forward/back       <- forward accel, pitch
//   breathe sym  x : apart/together          <- centrifugal (yaw/roll spin)
//   sway    anti x : both to body left/right <- lateral accel, yaw, roll
//   seesaw  anti y : one up, other down      <- roll
//   twist   anti z : one forward, other back <- yaw
// `amp` = displacement (S units) of the dedicated target at weight 1;
// `compat` = existing slider channel it maps to when dedicated targets are
// not baked (anti modes have none).
export const PSEUDO_MODES = [
  { name: 'bounce', dir: [0, 1, 0], parity: 1, frequency: 2.4, zeta: 0.22, amp: 0.07, compat: 'lift' },
  { name: 'surge', dir: [0, 0, 1], parity: 1, frequency: 3.0, zeta: 0.3, amp: 0.05, compat: 'size' },
  { name: 'breathe', dir: [1, 0, 0], parity: 1, frequency: 2.2, zeta: 0.3, amp: 0.05, compat: 'spread' },
  { name: 'sway', dir: [1, 0, 0], parity: -1, frequency: 2.0, zeta: 0.25, amp: 0.05 },
  { name: 'seesaw', dir: [0, 1, 0], parity: -1, frequency: 2.6, zeta: 0.25, amp: 0.06 },
  { name: 'twist', dir: [0, 0, 1], parity: -1, frequency: 3.2, zeta: 0.3, amp: 0.04 },
];

// Breast centroid in the body frame (S units): base centre plus 40 % of the
// depth forward (a hemispherical cap has its centroid at 3/8 of its height).
export function breastCentroid(params = DEFAULT_PARAMS) {
  const a = params.anchor;
  return [a.x, a.y, a.z + 0.4 * params.depth];
}

const sideToBody = (s, v) => [s * v[0], v[1], v[2]];

/**
 * Participation terms of a mode given per-side point samples.
 * @param {Array<{r:number[], phi:number[], m:number}>} pts body frame
 */
export function participation(pts) {
  let p = [0, 0, 0], prot = [0, 0, 0];
  const C = new Array(9).fill(0);
  for (const { r, phi, m } of pts) {
    p = add(p, scale(phi, m));
    prot = add(prot, scale(cross(r, phi), m));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += m * phi[i] * r[j];
  }
  return { p, prot, C };
}

/**
 * Pseudo-modes for the current field params.
 * @param {object} params field params (anchor/depth place the masses)
 * @param {{specs?:object[], frequencyScale?:number, dampingScale?:number}} opts
 */
export function pseudoModes(params = DEFAULT_PARAMS, { specs = PSEUDO_MODES, frequencyScale = 1, dampingScale = 1 } = {}) {
  const c = breastCentroid(params);
  const rL = c, rR = [-c[0], c[1], c[2]];
  return specs.map((sp) => {
    const art = modeArt(sp);
    const e = normalize(sp.dir);
    const parity = sp.parity ?? 1;
    const phiL = e, phiR = scale(e, parity); // side frames
    const bL = sideToBody(1, phiL), bR = sideToBody(-1, phiR); // body frame
    const pts = [{ r: rL, phi: bL, m: 0.5 }, { r: rR, phi: bR, m: 0.5 }]; // modal mass 1
    return {
      name: sp.name,
      omega: art.omega * frequencyScale,
      zeta: Math.min(art.zeta * dampingScale, 4),
      ...participation(pts),
      pts,
      phi: { L: phiL, R: phiR },
      dir: e,
      parity,
      amp: sp.amp ?? 0.05,
      compat: sp.compat ?? null,
      target: sp.target ?? `bust_dyn_${sp.name}`,
    };
  });
}

/**
 * Field targets for modes: a grab of `amp * dir` at the lift/spread brush
 * centre, antisymmetric modes with parity -1. Signed weight = q / amp. With
 * `pairs`, `<name>_pos` / `<name>_neg` (exact negatives) for runtimes that
 * clamp weights to 0..1.
 */
export function modeTargets(modes, { pairs = false, at = [0, 0, -0.08], radius = 0.19, nu = 0.48 } = {}) {
  const out = {};
  for (const m of modes) {
    const op = (sgn) => {
      const o = { type: 'grab', at: at.slice(), d: m.dir.map((v) => sgn * m.amp * v), radius, nu };
      if (m.parity < 0) o.parity = -1;
      return o;
    };
    if (pairs) {
      out[`${m.target}_pos`] = [op(1)];
      out[`${m.target}_neg`] = [op(-1)];
    } else out[m.target] = [op(1)];
  }
  return out;
}

// ---------------------------------------------------------------- integrator

export class ModalSystem {
  /**
   * @param {object[]} modes {omega, zeta, p, prot, C, phi:{L,R}, pts?}
   * @param {{coriolis?: boolean, G?: Float64Array}} opts G: n*n*3 coupling
   *        (computed from `pts` when absent)
   */
  constructor(modes, { coriolis = true, G = null } = {}) {
    this.modes = modes;
    const n = (this.n = modes.length);
    this.q = new Float64Array(n);
    this.v = new Float64Array(n);
    this.f = new Float64Array(n); // forcing at the end of the last step
    this.coriolis = coriolis;
    this.G = G ?? this._couplingFromPoints();
    this._k = null;
    this._kh = -1;
  }

  _couplingFromPoints() {
    const n = this.n, M = this.modes;
    if (!M.every((m) => m.pts)) return null;
    const G = new Float64Array(n * n * 3);
    let any = false;
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        let g = [0, 0, 0];
        M[j].pts.forEach((pj, i) => {
          g = add(g, scale(cross(pj.phi, M[k].pts[i].phi), pj.m));
        });
        G.set(g, (j * n + k) * 3);
        if (g[0] || g[1] || g[2]) any = true;
      }
    return any ? G : null;
  }

  reset() {
    this.q.fill(0);
    this.v.fill(0);
    this.f.fill(0);
  }

  // Generalized force of mode k without the Coriolis term.
  force(k, a, alpha, w, g, gain = 1, gravityGain = 1) {
    const m = this.modes[k], C = m.C;
    const ww = dot(w, w);
    const trC = C[0] + C[4] + C[8];
    const wCw =
      w[0] * (C[0] * w[0] + C[1] * w[1] + C[2] * w[2]) +
      w[1] * (C[3] * w[0] + C[4] * w[1] + C[5] * w[2]) +
      w[2] * (C[6] * w[0] + C[7] * w[1] + C[8] * w[2]);
    return gain * (-dot(m.p, a) - dot(m.prot, alpha) + ww * trC - wCw) + gravityGain * dot(m.p, g);
  }

  _coriolis(k, w, v, gain) {
    if (!this.G) return 0;
    const n = this.n;
    let s = 0;
    for (let j = 0; j < n; j++) {
      if (!v[j]) continue;
      const o = (j * n + k) * 3;
      s += v[j] * (w[0] * this.G[o] + w[1] * this.G[o + 1] + w[2] * this.G[o + 2]);
    }
    return -2 * gain * s;
  }

  // Quasi-static equilibrium under gravity only (used after a reset / cut).
  settle(g, gravityGain = 1) {
    const z = [0, 0, 0];
    for (let k = 0; k < this.n; k++) {
      const f = this.force(k, z, z, z, g, 0, gravityGain);
      const w = this.modes[k].omega;
      this.q[k] = f / (w * w);
      this.v[k] = 0;
      this.f[k] = f;
    }
  }

  // Velocity impulse from a jump of the chest's (body-frame) linear / angular
  // velocity: the tissue keeps its inertial velocity, so the relative
  // velocity jumps the other way.
  impulse(dv, dw, gain = 1) {
    for (let k = 0; k < this.n; k++) {
      const m = this.modes[k];
      this.v[k] -= gain * (dot(m.p, dv) + dot(m.prot, dw));
    }
  }

  // Step coefficients depend only on h: cached for the common fixed-dt case.
  _coeffs(h) {
    if (h !== this._kh) {
      this._k = this.modes.map((m) => stepCoeffs(h, m.omega, m.zeta));
      this._kh = h;
    }
    return this._k;
  }
  _coeffsHalf(h) {
    if (h !== this._khh) {
      this._kHalf = this.modes.map((m) => stepCoeffs(h / 2, m.omega, m.zeta));
      this._khh = h;
    }
    return this._kHalf;
  }

  /**
   * Exact step over h. Body-frame inputs in S units, each sampled at the
   * start, middle and end of the step ([x0, xm, x1], quadratic in time):
   * a chest-origin acceleration, alpha angular acceleration, w angular
   * velocity, g gravity change.
   */
  step(h, { a, alpha, w, g, gain = 1, gravityGain = 1 }) {
    const n = this.n, K = this._coeffs(h);
    const F = [0, 1, 2].map((j) => {
      const f = new Float64Array(n);
      for (let k = 0; k < n; k++) f[k] = this.force(k, a[j], alpha[j], w[j], g[j], gain, gravityGain);
      return f;
    });
    const [f0, fm, f1] = F;
    const st = { q: 0, v: 0 };
    if (this.coriolis && this.G) {
      // The gyroscopic coupling depends on the modal velocities, so it is not
      // part of the exact per-mode step. Evaluate it on a predicted
      // trajectory at the start, middle and end of the step (quadratic hold),
      // re-predicting once with the corrected forcing.
      const Kh = this._coeffsHalf(h);
      const c = [0, 1, 2].map(() => new Float64Array(n));
      for (let k = 0; k < n; k++) c[0][k] = c[1][k] = c[2][k] = this._coriolis(k, w[0], this.v, gain);
      const vm = new Float64Array(n), ve = new Float64Array(n);
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < n; k++) {
          const g0 = f0[k] + c[0][k], gm = fm[k] + c[1][k], g1 = f1[k] + c[2][k];
          // forcing at h/4 on the quadratic through (0, g0), (h/2, gm), (h, g1)
          const gq = (3 * g0 + 6 * gm - g1) / 8;
          st.q = this.q[k];
          st.v = this.v[k];
          vm[k] = oscillatorStep(st, Kh[k], g0, gm, gq).v;
          st.q = this.q[k];
          st.v = this.v[k];
          ve[k] = oscillatorStep(st, K[k], g0, g1, gm).v;
        }
        for (let k = 0; k < n; k++) {
          c[1][k] = this._coriolis(k, w[1], vm, gain);
          c[2][k] = this._coriolis(k, w[2], ve, gain);
        }
      }
      for (let k = 0; k < n; k++) {
        f0[k] += c[0][k];
        fm[k] += c[1][k];
        f1[k] += c[2][k];
      }
    }
    // Exact modal velocity at h/4, h/2, 3h/4 (for continuous-time filters of
    // the relative velocity, see BustDynamics), then the step itself.
    const Ks = this._coeffsSub(h);
    this.vSub = [0, 1, 2].map(() => new Float64Array(n));
    for (let k = 0; k < n; k++) {
      const q0 = this.q[k], v0 = this.v[k];
      for (let i = 0; i < 3; i++) {
        const t = ((i + 1) * h) / 4;
        st.q = q0;
        st.v = v0;
        this.vSub[i][k] = oscillatorStep(st, Ks[i][k], f0[k], quadAt(f0[k], fm[k], f1[k], h, t), quadAt(f0[k], fm[k], f1[k], h, t / 2)).v;
      }
      st.q = q0;
      st.v = v0;
      oscillatorStep(st, K[k], f0[k], f1[k], fm[k]);
      this.q[k] = st.q;
      this.v[k] = st.v;
      this.f[k] = f1[k];
    }
  }

  _coeffsSub(h) {
    if (h !== this._khs) {
      this._kSub = [1, 2, 3].map((i) => this.modes.map((m) => stepCoeffs((i * h) / 4, m.omega, m.zeta)));
      this._khs = h;
    }
    return this._kSub;
  }

  // Per-side relative velocity (side frame) from modal velocities v[k].
  sideVelocity(v) {
    const out = {};
    for (const s of ['L', 'R']) {
      let a = [0, 0, 0];
      for (let k = 0; k < this.n; k++) a = add(a, scale(this.modes[k].phi[s], v[k]));
      out[s] = a;
    }
    return out;
  }

  // Modal acceleration at the end of the last step.
  accel(k) {
    const m = this.modes[k];
    return this.f[k] - 2 * m.zeta * m.omega * this.v[k] - m.omega * m.omega * this.q[k];
  }

  /**
   * Relative displacement / velocity / acceleration of each breast centroid
   * in its side frame (S units), the input of the stylization layer.
   */
  sideState() {
    const out = {};
    for (const s of ['L', 'R']) {
      let y = [0, 0, 0], v = [0, 0, 0], a = [0, 0, 0];
      for (let k = 0; k < this.n; k++) {
        const phi = this.modes[k].phi[s];
        y = add(y, scale(phi, this.q[k]));
        v = add(v, scale(phi, this.v[k]));
        a = add(a, scale(phi, this.accel(k)));
      }
      out[s] = { y, v, a };
    }
    return out;
  }
}
