// Runtime drivers that only set blend shape weights (no extra bones), so they
// port 1:1 to a Unity MonoBehaviour calling SkinnedMeshRenderer.SetBlendShapeWeight
// in LateUpdate.
//
//   ChestTracker   - turns per-frame chest poses into the chest's motion over
//                    each frame interval (body frame), with cut detection.
//   BustDynamics   - modal jiggle (modal.js, exact per-mode step) plus the
//                    Velocity-Skinning style layer (vskin.js).
//   poseCorrective - pose-space correction: raising the arms lifts the bust.
//   bustWeights    - user sliders + dynamics + pose -> blend shape weights,
//                    with one documented clamping policy.
//   runtimeTargets - the extra field targets the dynamics drive (bake them
//                    like the sliders); weightSetCheck validates them.
//
// Time handling (critique-v2 section 2): the frame's real dt is what the
// chest positions were sampled with, so it is the ONLY dt used to
// differentiate them; it is never clamped. The integrator needs no substeps
// (exact discretization), so a long frame is integrated exactly for the
// motion model below instead of being shortened. Frames longer than `maxDt`,
// or implying impossible speeds, are treated as cuts / teleports: the state
// is reset to the quasi-static equilibrium instead of being kicked.
//
// Motion model between samples: the chest's position (and rotation vector)
// over [t_n-1, t_n] is the cubic through the last four samples (quadratic /
// three samples right after a reset). It interpolates both ends exactly (no
// lag), its acceleration is linear over the interval, and its velocity may
// jump slightly at the knots; a jump is applied as the matching velocity
// impulse on the tissue (it keeps its inertial velocity). The modes see this
// model's inertial load exactly (quadratic-hold step), so the only frame-rate
// dependence left is how well the cubic matches the real motion (O(dt^4) in
// position), which is what makes 30/60/120 fps trajectories agree.
// Constant-velocity motion produces no response whatever the frame timing (no
// fake kicks; only round-off). The first interval after a reset is
// integrated one frame late, once three samples define its acceleration.

import { sub, add, scale, dot, cross, normalize, length, clamp } from './vec.js';
import { sliderToWeights, DEFAULT_PARAMS, cloneParams, linearBrush } from './field.js';
import { grab, scaleBrush } from './kelvinlet.js';
import { ModalSystem, pseudoModes, modeTargets, oscillatorStep, stepCoeffs } from './modal.js';
import { DEFAULT_VSKIN, vskinWeights, vskinTargets } from './vskin.js';
import { fieldCheck, extremeCombos } from './validate.js';

export const DEFAULT_DYNAMICS = {
  enabled: true,
  // Legacy art controls (kept for the viewer GUI): the bounce mode's
  // frequency / damping ratio; the other pseudo-modes scale with them.
  frequency: 2.4, // Hz
  damping: 0.22, // damping ratio (lower = more overshoot / wobble)
  gain: 1.0, // how strongly chest motion excites the modes
  squashStretch: 0.5, // compat only: spread = -squashStretch * lift
  liftAmount: 0.06, // compat: bounce displacement (S) for lift slider 1
  spreadAmount: 0.065, // compat: breathe displacement (S) for spread slider 1
  sizeAmount: 0.06, // compat: surge displacement (S) for size slider 1
  limit: 1.0, // bound on every dynamic weight / slider contribution
  softLimit: true, // tanh saturation instead of a hard clamp
  // Modes: null = pseudoModes(params). Supply FEM modes here later.
  modes: null,
  params: null, // field params (anchor / depth place the pseudo-mode masses)
  coriolis: true,
  // 'compat': symmetric modes drive the existing lift / spread / size
  // sliders (runs with the 7 standard targets); 'dedicated': every mode
  // drives its own bust_dyn_* target (bake runtimeTargets()).
  mapping: 'compat',
  // World gravity (world units / s^2). The rest shape already sags under
  // gravity in the rest pose, so only the change of gravity in the body
  // frame relative to `restAxes` ({left, up, forward} of the body frame at
  // rest, world) is applied. null = the axes of the first pose ever passed
  // (rest frames are often tilted a few degrees: hips -> neck is not
  // vertical, so "body up = -gravity" would sag the rest shape).
  gravity: [0, -9.81, 0],
  gravityGain: 1.0,
  restAxes: null,
  vskin: { ...DEFAULT_VSKIN },
  smoothHz: 8, // cutoff of the angular / relative velocity estimates (vskin)
  accelHz: 4, // cutoff of the angular acceleration estimate (vskin)
  // Cut / teleport detection.
  maxDt: 0.5, // s
  maxSpeed: 50, // S / s
  maxAngularSpeed: 30, // rad / s
  minDt: 1e-4, // shorter frames are merged into the next one
};

// ---------------------------------------------------------------- rotations

// Orthonormal body axes from a pose {left?, up, forward?} (world vectors).
// Right-handed like buildBodyFrame: forward = left x up.
export function poseAxes(pose) {
  const up = normalize(pose.up);
  let fwd = pose.forward ? pose.forward : pose.left ? cross(pose.left, up) : null;
  if (!fwd) {
    // Legacy (up only): any fixed horizontal-ish forward.
    fwd = Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  }
  fwd = normalize(sub(fwd, scale(up, dot(fwd, up))));
  const left = cross(up, fwd);
  return [left, up, fwd];
}

// World vector -> body frame (R^T v with R's columns = axes).
const toBody = (ax, v) => [dot(ax[0], v), dot(ax[1], v), dot(ax[2], v)];

// Rotation vector of R0^T R1 (body frame of R0), via a quaternion so it is
// robust for every angle.
export function relativeRotation(ax0, ax1) {
  const M = (i, j) => dot(ax0[i], ax1[j]);
  const m00 = M(0, 0), m11 = M(1, 1), m22 = M(2, 2), tr = m00 + m11 + m22;
  let w, x, y, z, s;
  if (tr > 0) {
    s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (M(2, 1) - M(1, 2)) / s; y = (M(0, 2) - M(2, 0)) / s; z = (M(1, 0) - M(0, 1)) / s;
  } else if (m00 > m11 && m00 > m22) {
    s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (M(2, 1) - M(1, 2)) / s; x = s / 4; y = (M(0, 1) + M(1, 0)) / s; z = (M(0, 2) + M(2, 0)) / s;
  } else if (m11 > m22) {
    s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (M(0, 2) - M(2, 0)) / s; x = (M(0, 1) + M(1, 0)) / s; y = s / 4; z = (M(1, 2) + M(2, 1)) / s;
  } else {
    s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (M(1, 0) - M(0, 1)) / s; x = (M(0, 2) + M(2, 0)) / s; y = (M(1, 2) + M(2, 1)) / s; z = s / 4;
  }
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const n = Math.hypot(x, y, z);
  if (n < 1e-12) return [2 * x, 2 * y, 2 * z];
  const ang = 2 * Math.atan2(n, w);
  return [(x * ang) / n, (y * ang) / n, (z * ang) / n];
}

// Rotate v by the rotation vector th (Rodrigues).
export function rotateVec(v, th) {
  const a = Math.hypot(th[0], th[1], th[2]);
  if (a < 1e-12) return add(v, cross(th, v));
  const k = scale(th, 1 / a), c = Math.cos(a), s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

// ---------------------------------------------------------------- tracker

const ZERO = [0, 0, 0];

// Polynomial velocity over one interval of length h from the mean velocities
// of the last intervals (newest last; hs = their lengths): Newton form of the
// interpolant of the positions. Returns vel(t) = v0 + a0 t + j t^2 / 2.
function intervalModel(vb, hs) {
  const n = vb.length, h = hs[n - 1], vbar = vb[n - 1];
  if (n === 1) return { v0: vbar, a0: ZERO, j: ZERO };
  const an = scale(sub(vbar, vb[n - 2]), 2 / (h + hs[n - 2]));
  if (n === 2) return { v0: sub(vbar, scale(an, h / 2)), a0: an, j: ZERO };
  const h1 = hs[n - 2];
  const ap = scale(sub(vb[n - 2], vb[n - 3]), 2 / (h1 + hs[n - 3]));
  const c3 = scale(sub(an, ap), 1 / (2 * (h + h1 + hs[n - 3])));
  return {
    v0: sub(sub(vbar, scale(an, h / 2)), scale(c3, h * h1)),
    a0: add(an, scale(c3, 2 * (h1 - h))),
    j: scale(c3, 6),
  };
}
const velAt = (m, t) => add(add(m.v0, scale(m.a0, t)), scale(m.j, (t * t) / 2));
const accAt = (m, t) => add(m.a0, scale(m.j, t));

export class ChestTracker {
  constructor(opts = {}) {
    this.o = { ...DEFAULT_DYNAMICS, ...opts };
    this.reset();
  }
  reset() {
    this.prev = null; // last accepted sample {pos, ax}
    this.pending = 0; // time of merged too-short frames
    this.hist = []; // last <= 3 intervals {h, vbar (world S/s), wbar (body rad/s), ax0, ax1, rot}
    this.vEnd = null; // model velocity at the end of the last integrated interval
    this.wEnd = null;
    this.lastCut = null;
  }

  /**
   * @param {number} dt real time since the previous call (seconds)
   * @param {number[]} pos chest origin, world
   * @param {number[][]} ax body axes [left, up, forward], world, orthonormal
   * @param {number} S body scale (world units)
   * @param {number[]} g world gravity (world units / s^2)
   * @param {number[][]} restAx body axes at rest (gravity reference); default ax
   * @returns {{status:'init'|'warmup'|'skip'|'cut'|'step', steps?:object[], g?:number[]}}
   *          `steps`: the intervals to integrate, in order (two right after
   *          warm-up), each with body-frame inertial inputs sampled at the
   *          start / middle / end (see ModalSystem.step) and the knot jumps.
   */
  push(dt, pos, ax, S, g = ZERO, restAx = ax) {
    const o = this.o;
    const gw = scale(g, 1 / S);
    const gRest = toBody(restAx, gw);
    if (!this.prev) {
      this.prev = { pos: pos.slice(), ax };
      return { status: 'init', g: sub(toBody(ax, gw), gRest) };
    }
    const h = this.pending + (dt > 0 ? dt : 0);
    if (h < o.minDt) {
      // Too short to differentiate: merge into the next frame.
      this.pending = h;
      return { status: 'skip' };
    }
    this.pending = 0;
    const vbar = scale(sub(pos, this.prev.pos), 1 / (h * S));
    const rot = relativeRotation(this.prev.ax, ax);
    const wbar = scale(rot, 1 / h);
    const why =
      h > o.maxDt ? 'dt' : length(vbar) > o.maxSpeed ? 'speed' : length(wbar) > o.maxAngularSpeed ? 'spin' : length(rot) > Math.PI / 2 ? 'angle' : null;
    if (why) {
      this.reset();
      this.lastCut = why;
      this.prev = { pos: pos.slice(), ax };
      return { status: 'cut', reason: why, g: sub(toBody(ax, gw), gRest) };
    }
    this.hist.push({ h, vbar, wbar, ax0: this.prev.ax, ax1: ax, rot });
    if (this.hist.length > 3) this.hist.shift();
    this.prev = { pos: pos.slice(), ax };
    const H = this.hist;
    if (H.length === 1) return { status: 'warmup' }; // acceleration unknown yet

    const hs = H.map((x) => x.h);
    const seg = (iv, lin, ang, dv, dw) => {
      const { h: L, ax0, ax1, rot: r } = iv;
      const half = scale(r, -0.5); // body frame 0 -> middle of the interval
      const body = [(v) => toBody(ax0, v), (v) => rotateVec(toBody(ax0, v), half), (v) => toBody(ax1, v)];
      const ts = [0, L / 2, L];
      return {
        h: L,
        dv: toBody(ax0, dv), // knot jump of the chest velocity (body, S/s)
        dw, // knot jump of the angular velocity (body, rad/s)
        a: ts.map((t, i) => body[i](accAt(lin, t))), // chest acceleration (body, S/s^2)
        alpha: ts.map((t) => accAt(ang, t)), // angular acceleration (body, rad/s^2)
        w: ts.map((t) => velAt(ang, t)), // angular velocity (body, rad/s)
        g: ts.map((t, i) => sub(body[i](gw), gRest)), // gravity change (body, S/s^2)
      };
    };
    const steps = [];
    if (!this.vEnd) {
      // Warm-up: one quadratic through the first three samples covers both
      // intervals; the tissue starts at rest relative to the chest.
      const lin = intervalModel(H.map((x) => x.vbar), hs);
      const ang = intervalModel(H.map((x) => x.wbar), hs);
      const back = (m) => ({ v0: sub(m.v0, scale(m.a0, H[0].h)), a0: m.a0, j: ZERO });
      steps.push(seg(H[0], back(lin), back(ang), ZERO, ZERO));
      steps.push(seg(H[1], lin, ang, ZERO, ZERO));
      this.vEnd = velAt(lin, H[1].h);
      this.wEnd = velAt(ang, H[1].h);
    } else {
      const lin = intervalModel(H.map((x) => x.vbar), hs);
      const ang = intervalModel(H.map((x) => x.wbar), hs);
      steps.push(seg(H[H.length - 1], lin, ang, sub(lin.v0, this.vEnd), sub(ang.v0, this.wEnd)));
      this.vEnd = velAt(lin, h);
      this.wEnd = velAt(ang, h);
    }
    return { status: 'step', steps };
  }
}

// ---------------------------------------------------------------- dynamics

const softClamp = (x, lim, soft) => (soft ? lim * Math.tanh(x / lim) : clamp(x, -lim, lim));

export class BustDynamics {
  constructor(opts = {}) {
    this.o = { ...DEFAULT_DYNAMICS, ...opts, vskin: { ...DEFAULT_VSKIN, ...(opts.vskin ?? {}) } };
    this.tracker = new ChestTracker(this.o);
    this.modal = null;
    this._modesKey = null;
    this.reset();
  }

  /** Forget all motion history (call on camera cuts / teleports / respawn). */
  reset() {
    this.tracker.reset();
    this.modal?.reset();
    const z3 = () => [0, 1, 2].map(() => ({ q: 0, v: 0 }));
    this.wf = z3(); // smoothed angular velocity
    this.af = z3(); // slower twin, its derivative is the angular acceleration
    this.wfInit = false;
    this.rf = { L: z3(), R: z3() }; // smoothed relative velocity per side
    this.rfInit = false;
    this.status = 'reset';
    this.out = this._output();
  }

  // (Re)build the modal system when its inputs change (GUI edits `o`).
  _ensureModes() {
    const o = this.o;
    const params = o.params ?? DEFAULT_PARAMS;
    const key = JSON.stringify([o.frequency, o.damping, o.coriolis, o.modes ? o.modes.length : 0, params.anchor, params.depth]);
    if (key === this._modesKey && (!o.modes || this.modal.modes === o.modes)) return;
    const modes =
      o.modes ?? pseudoModes(params, { frequencyScale: o.frequency / 2.4, dampingScale: o.damping / 0.22 });
    const old = this.modal;
    this.modal = new ModalSystem(modes, { coriolis: o.coriolis });
    if (old && old.n === this.modal.n) {
      this.modal.q.set(old.q);
      this.modal.v.set(old.v);
    }
    this._modesKey = key;
  }

  /**
   * @param {number} dt real seconds since the last call (never clamped)
   * @param {{pos:number[], up:number[], forward?:number[], left?:number[], S?:number}|number[]} chest
   *        chest pose in world space: body-frame origin + axes (left / up /
   *        forward as in buildBodyFrame, rotated with the chest bone). Legacy
   *        form: update(dt, chestPos, up, S) (orientation assumed constant).
   * @returns {{lift:number, spread:number, size:number, shapes:Object<string,number>, modes:Object<string,number>, status:string}}
   */
  update(dt, chest, up, S) {
    const o = this.o;
    if (!o.enabled) return this._zero();
    const pose = Array.isArray(chest) ? { pos: chest, up, S } : chest;
    const s = pose.S ?? S ?? o.S ?? 1;
    const ax = poseAxes(pose);
    // Gravity reference: explicit rest axes, else the first pose ever seen
    // (kept across reset() / cuts, which may happen in any pose).
    const restAx = o.restAxes ? poseAxes(o.restAxes) : (this.restAx ??= ax);
    this._ensureModes();
    this.tracker.o = o;
    const r = this.tracker.push(dt, pose.pos, ax, s, o.gravity ?? ZERO, restAx);
    if (r.status === 'skip' || r.status === 'warmup') {
      // Nothing to integrate yet: keep the last weights.
      this.status = r.status;
      this.out = { ...this.out, status: r.status, cut: null };
      return this.out;
    }
    this.status = r.status;
    if (r.status !== 'step') {
      // First sample after reset or a cut: start at rest in the current pose.
      this.modal.settle(r.g, o.gravityGain);
      this.wfInit = this.rfInit = false;
      for (const st of [...this.wf, ...this.af, ...this.rf.L, ...this.rf.R]) st.q = st.v = 0;
      this.out = this._output();
      this.out.cut = r.status === 'cut' ? r.reason : null;
      return this.out;
    }
    const M = this.modal;
    for (const sg of r.steps) {
      M.impulse(sg.dv, sg.dw, o.gain);
      const v0 = M.sideVelocity(M.v);
      M.step(sg.h, { ...sg, gain: o.gain, gravityGain: o.gravityGain });
      this._smoothRel(sg.h, [v0, ...M.vSub.map((v) => M.sideVelocity(v)), M.sideVelocity(M.v)]);
      this._smoothSpin(sg);
    }
    this.out = this._output();
    return this.out;
  }

  // Same low-pass on the per-side relative velocity that drives squash and
  // drag. Its value at a frame end carries the error of the chest velocity
  // estimate there (O(dt^3)), but that error averages out over the interval
  // (the motion model interpolates positions), so the filter is fed the
  // exact modal velocity at 5 points per frame instead of the end value.
  _smoothRel(h, vs) {
    const W = 2 * Math.PI * this.o.smoothHz, W2 = W * W;
    if (!this.rfInit) {
      for (const s of ['L', 'R']) this.rf[s].forEach((st, i) => { st.q = vs[0][s][i]; st.v = 0; });
      this.rfInit = true;
    }
    const k = stepCoeffs(h / 2, W, 1);
    for (const s of ['L', 'R'])
      this.rf[s].forEach((st, i) => {
        oscillatorStep(st, k, W2 * vs[0][s][i], W2 * vs[2][s][i], W2 * vs[1][s][i]);
        oscillatorStep(st, k, W2 * vs[2][s][i], W2 * vs[4][s][i], W2 * vs[3][s][i]);
      });
  }

  // Critically damped 2nd-order low-passes of the angular velocity, stepped
  // exactly like the modes (their input is quadratic over the interval): a
  // frame-rate independent angular velocity (wf, value) and acceleration
  // (af, derivative). The acceleration uses a lower cutoff: the motion
  // model's angular velocity has a zero-mean O(dt^3) ripple inside each
  // frame, and a derivative filter only averages it out if it is slow
  // compared to the frame rate.
  _smoothSpin(sg) {
    for (const [states, hz] of [[this.wf, this.o.smoothHz], [this.af, this.o.accelHz]]) {
      const W = 2 * Math.PI * hz, W2 = W * W;
      if (!this.wfInit) states.forEach((st, i) => { st.q = sg.w[0][i]; st.v = sg.alpha[0][i]; });
      const k = stepCoeffs(sg.h, W, 1);
      states.forEach((st, i) => oscillatorStep(st, k, W2 * sg.w[0][i], W2 * sg.w[2][i], W2 * sg.w[1][i]));
    }
    this.wfInit = true;
  }

  _zero() {
    return { lift: 0, spread: 0, size: 0, shapes: {}, modes: {}, status: 'disabled' };
  }

  _output() {
    const o = this.o;
    if (!this.modal) this._ensureModes();
    const M = this.modal, lim = o.limit, soft = o.softLimit;
    const shapes = {}, modes = {};
    const ch = { lift: 0, spread: 0, size: 0 };
    const amount = { lift: o.liftAmount, spread: o.spreadAmount, size: o.sizeAmount };
    M.modes.forEach((m, k) => {
      const q = M.q[k];
      modes[m.name] = q;
      if (o.mapping === 'compat' && m.compat) ch[m.compat] += q / amount[m.compat];
      else shapes[m.target] = softClamp(q / m.amp, lim, soft);
    });
    let { lift, spread, size } = ch;
    if (o.mapping === 'compat') {
      lift = softClamp(lift, lim, soft);
      // Legacy squash & stretch (stretch tall = thin) until the vskin
      // targets are baked; 'dedicated' mapping uses vskin instead.
      spread = softClamp(spread - o.squashStretch * lift, lim, soft);
      size = softClamp(size, lim, soft);
    }
    if (o.vskin?.enabled !== false) {
      const ss = M.sideState();
      const side = {};
      for (const s of ['L', 'R']) side[s] = { y: ss[s].y, v: this.rf[s].map((st) => st.q) };
      // vskin limits each family by the norm of its weight vector.
      const vs = vskinWeights(
        { omega: this.wf.map((st) => st.q), alpha: this.af.map((st) => st.v), side },
        { ...o.vskin, limit: lim, softLimit: soft },
      );
      Object.assign(shapes, vs);
    }
    return { lift, spread, size, shapes, modes, status: this.status };
  }
}

// ---------------------------------------------------------------- pose

export const DEFAULT_POSE = { enabled: true, startDeg: 100, endDeg: 170, lift: 0.45 };

/**
 * Pose-space corrective from upper-arm elevation (angle between the upper arm
 * and the body's down axis: 0 = arms down, 90 = T-pose, 180 = arms up).
 */
export function poseCorrective(shoulderL, elbowL, shoulderR, elbowR, up, opts = DEFAULT_POSE) {
  if (!opts.enabled) return { lift: 0, spread: 0 };
  const elev = (s, e) => (Math.acos(clamp(-dot(normalize(sub(e, s)), up), -1, 1)) * 180) / Math.PI;
  const deg = (elev(shoulderL, elbowL) + elev(shoulderR, elbowR)) / 2;
  const t = clamp((deg - opts.startDeg) / (opts.endDeg - opts.startDeg), 0, 1);
  const s = t * t * (3 - 2 * t);
  return { lift: s * opts.lift, spread: 0, armDeg: deg };
}

// ---------------------------------------------------------------- weights

// Unwindowed displacement at the apex (side frame, S units, per side) of a
// target at weight 1: its brushes evaluated at the apex. A cheap proxy of
// where a shape moves the tissue, used by the clamping policy below (not by
// the bake).
export function apexDisplacement(ops) {
  const out = { L: [0, 0, 0], R: [0, 0, 0] };
  for (const op of ops) {
    const r = op.at.map((v) => -v); // apex - at
    let u;
    if (op.type === 'grab') u = grab(r, op.d, op.radius, op.nu ?? 0.45);
    else if (op.type === 'scale') u = scaleBrush(r, op.k ?? 0, op.radius, op.nu ?? 0.45);
    else if (op.type === 'linear') u = linearBrush(r, op.A, op.radius ?? 0);
    else continue;
    out.L = add(out.L, u);
    out.R = add(out.R, op.parity < 0 ? scale(u, -1) : u);
  }
  return out;
}

// Slider targets that span each shared axis (side frame x = lateral, y = up).
const AXES = [
  { axis: 0, targets: ['bust_spread_out', 'bust_spread_in'] },
  { axis: 1, targets: ['bust_lift_up', 'bust_lift_down'] },
];

/**
 * What the clamping policy needs to know about the targets: apex
 * displacements of every slider / dynamic target and, per shared axis, the
 * range the slider shapes span (the range fieldCheck validates).
 */
export function dynamicEnvelope(params = DEFAULT_PARAMS, dynTargets = runtimeTargets(params)) {
  const disp = {};
  for (const [k, ops] of Object.entries({ ...params.targets, ...dynTargets })) disp[k] = apexDisplacement(ops);
  const bounds = AXES.map(({ axis, targets }) => {
    const v = targets.map((t) => disp[t]?.L[axis] ?? 0);
    return [Math.min(0, ...v), Math.max(0, ...v)];
  });
  return { disp, bounds, knee: 0.5 };
}

let defaultEnvelope = null;

// Bound on the Euclidean norm of all dedicated dynamic weights together.
// Each weight may still reach +-1 alone; the budget only limits adversarial
// simultaneous extremes (which the dynamics do not produce: displacement
// and velocity driven shapes peak in quadrature). Chosen with
// weightSetCheck (see runtime.test.js) for det > 0 at every slider extreme.
export const DYNAMIC_BUDGET = 1.5;

// |D| -> |D'| <= room: identity up to knee * room, then a C1 tanh shoulder.
function compress(D, room, knee) {
  const a = Math.abs(D), k = knee * room;
  if (a <= k) return D;
  if (room <= 0) return 0;
  const r = room - k;
  return Math.sign(D) * (k + r * Math.tanh((a - k) / r));
}

/**
 * weights = f(user sliders, dynamics, pose corrective). Clamping policy:
 *  1. Slider channels (size, lift, spread) are summed in SIGNED slider space:
 *     user + pose + compat dynamics (each dynamic part already bounded by
 *     DEFAULT_DYNAMICS.limit). The sum is clamped to [-1, 1] and split into
 *     the one-sided 0..1 targets by sliderToWeights, so up/down twins are
 *     never both active and the slider extremes validated by fieldCheck
 *     stay the extremes. Jiggle on a channel the user already maxed is
 *     clipped there.
 *  2. Dedicated dynamic shapes (bust_dyn_*, bust_vs_*) are signed, summed
 *     over the extras and clamped to [-maxDynamic, maxDynamic].
 *  3. Shared envelope: along the two axes the sliders already use to their
 *     validated limit (lateral = spread, vertical = lift), the dynamic
 *     shapes may only use the room the sliders leave. Per side, the dynamic
 *     apex displacement D is compressed (identity up to half the room, then a
 *     smooth shoulder) so slider + dynamics never leaves the slider range,
 *     and every dynamic shape moving the apex along that axis is scaled by
 *     the same factor (the smaller of the two sides). Without this,
 *     spread_in + inward jiggle crosses the midline lock and folds the field.
 *     Dynamic shapes that do not move the apex along x / y are untouched.
 *  Negative weights need Unity's legacy blend-shape clamping off; with
 *  `pairs` they are split into `<name>_pos` / `<name>_neg` (0..1), which
 *  needs the targets baked with runtimeTargets(params, {pairs: true}).
 * @param {object} o
 * @param {object} [o.envelope] dynamicEnvelope(params) (default: for
 *        DEFAULT_PARAMS); null disables step 3
 * @returns {Object<string, number>} target name -> weight (Unity x100)
 */
export function bustWeights({ sliders = {}, extras = [], pairs = false, maxDynamic = 1, budget = DYNAMIC_BUDGET, envelope } = {}) {
  const ch = { size: sliders.size ?? 0, lift: sliders.lift ?? 0, spread: sliders.spread ?? 0 };
  const shapes = {};
  for (const e of extras) {
    if (!e) continue;
    for (const c of ['size', 'lift', 'spread']) ch[c] += e[c] ?? 0;
    for (const [k, v] of Object.entries(e.shapes ?? {})) shapes[k] = (shapes[k] ?? 0) + v;
  }
  const w = sliderToWeights({ ...ch, style: sliders.style ?? 0.5 });
  for (const k of Object.keys(shapes)) shapes[k] = clamp(shapes[k], -maxDynamic, maxDynamic);
  if (budget > 0) {
    // Joint budget on the dynamic weight vector (L2), smooth shoulder.
    const n = Math.hypot(...Object.values(shapes));
    if (n > 0) {
      const f = compress(n, budget, 0.7) / n;
      for (const k of Object.keys(shapes)) shapes[k] *= f;
    }
  }

  if (envelope === undefined) envelope = defaultEnvelope ??= dynamicEnvelope();
  if (envelope) {
    const { disp, bounds, knee } = envelope;
    const factor = {};
    AXES.forEach(({ axis, targets }, ai) => {
      const [lo, hi] = bounds[ai];
      let S = 0;
      for (const t of targets) S += (w[t] ?? 0) * (disp[t]?.L[axis] ?? 0);
      let kappa = 1;
      for (const s of ['L', 'R']) {
        let D = 0;
        for (const [k, v] of Object.entries(shapes)) D += v * (disp[k]?.[s][axis] ?? 0);
        if (D === 0) continue;
        const room = D > 0 ? hi - S : S - lo;
        kappa = Math.min(kappa, compress(D, Math.max(room, 0), knee) / D);
      }
      for (const k of Object.keys(shapes)) {
        const d = disp[k];
        if (d && (Math.abs(d.L[axis]) > 1e-9 || Math.abs(d.R[axis]) > 1e-9)) factor[k] = Math.min(factor[k] ?? 1, kappa);
      }
    });
    for (const [k, f] of Object.entries(factor)) shapes[k] *= f;
  }

  for (const [k, v] of Object.entries(shapes)) {
    if (pairs) {
      w[`${k}_pos`] = Math.max(v, 0);
      w[`${k}_neg`] = Math.max(-v, 0);
    } else w[k] = v;
  }
  return w;
}

// Legacy entry point (viewer): combineWeights(sliders, dynamics, pose).
export function combineWeights(user, ...extra) {
  return bustWeights({ sliders: user, extras: extra });
}

// ---------------------------------------------------------------- targets

/**
 * Field targets the runtime drives besides the 7 slider shapes: one grab
 * per pseudo-mode (bust_dyn_*) and the 11 linear vskin shapes (bust_vs_*).
 */
export function runtimeTargets(params = DEFAULT_PARAMS, { pairs = false, modes = null, vskin = {} } = {}) {
  return {
    ...modeTargets(modes ?? pseudoModes(params), { pairs }),
    ...vskinTargets(params, { ...vskin, pairs }),
  };
}

/** Clone of `params` with the runtime targets added (for baking). */
export function withRuntimeTargets(params = DEFAULT_PARAMS, opts = {}) {
  const p = cloneParams(params);
  Object.assign(p.targets, runtimeTargets(params, opts));
  return p;
}

// ---------------------------------------------------------------- validation

/**
 * Injectivity of arbitrary weight combinations: min det(I + sum_t w_t J_t)
 * over the field's support for each full weight dict in `weightSets`
 * (slider + dynamic targets, as bustWeights returns them). Each set is
 * checked by validate.js fieldCheck on a view of the field with ONE virtual
 * target whose Jacobian is the weighted sum, selected by the slider combo
 * {size: -1} (weight 1 on that single target). Jacobians are cached per
 * sample point, so many sets cost little more than one.
 */
export function weightSetCheck(field, weightSets, { res = 10 } = {}) {
  const VIRT = 'bust_size_down'; // the only target {size: -1} weights (by 1)
  const cache = new Map();
  const jac = (p) => {
    const key = `${p[0]},${p[1]},${p[2]}`;
    let c = cache.get(key);
    if (!c) {
      c = {};
      for (const t of field.targets) c[t] = field.jacobian(t, p);
      cache.set(key, c);
    }
    return c;
  };
  let worst = { minDet: Infinity, index: -1 };
  weightSets.forEach((ws, index) => {
    const entries = Object.entries(ws).filter(([k, v]) => v && field.targets.includes(k));
    const view = {
      ...field,
      targets: [VIRT],
      jacobian(t, p) {
        const J = jac(p), out = new Array(9).fill(0);
        for (const [k, a] of entries) for (let e = 0; e < 9; e++) out[e] += a * J[k][e];
        return out;
      },
    };
    const r = fieldCheck(view, { res, combos: [{ size: -1 }] });
    if (r.minDet < worst.minDet) worst = { minDet: r.minDet, minAt: r.minAt, index, weights: ws };
  });
  return { ...worst, injective: worst.minDet > 0, checks: weightSets.length };
}

/**
 * Reachable maximum-amplitude dynamic states: every mode weight at +-1
 * (independent signs; modes are independent coordinates) and every vskin
 * family saturated (weight-vector norm 1) in a random direction, produced by
 * driving vskinWeights with huge random inputs so the sets are exactly what
 * the runtime can output. Deterministic for a given seed.
 */
export function sampleMaxDynamics({ count = 64, seed = 1, modes = pseudoModes(), vskin = {} } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const big = () => [0, 1, 2].map(() => (rnd() - 0.5) * 1e6);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = {};
    for (const m of modes) d[m.target] = rnd() < 0.5 ? -1 : 1;
    Object.assign(
      d,
      vskinWeights({ omega: big(), alpha: big(), side: { L: { v: big(), y: big() }, R: { v: big(), y: big() } } }, { ...vskin, softLimit: false }),
    );
    out.push(d);
  }
  return out;
}

/**
 * Full weight dicts for "every slider extreme x every dynamic extreme",
 * passed through bustWeights (so the clamping policy is part of what is
 * validated). `dynamicSets`: raw signed dynamic weights, e.g. each target
 * at +-1 alone, or all of them at +-1 with mixed signs.
 */
export function dynamicExtremes(dynamicSets, { combos = extremeCombos(), envelope, maxDynamic = 1, budget = DYNAMIC_BUDGET } = {}) {
  const out = [];
  for (const c of combos) for (const d of dynamicSets) out.push(bustWeights({ sliders: c, extras: [{ shapes: d }], envelope, maxDynamic, budget }));
  return out;
}

