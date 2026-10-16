// Runtime drivers that only set blend shape weights (no extra bones), so they
// port 1:1 to a Unity MonoBehaviour calling SkinnedMeshRenderer.SetBlendShapeWeight
// in LateUpdate.
//
//   BustDynamics   - bone-free secondary motion: a damped spring driven by the
//                    chest's acceleration, mapped onto the lift shapes, plus a
//                    squash & stretch term on the spread shapes (classic
//                    animation exaggeration: stretch tall = thin, squash = wide).
//   poseCorrective - pose-space correction: raising the arms lifts the bust.

import { sub, dot, normalize, clamp } from './vec.js';
import { sliderToWeights } from './field.js';

export const DEFAULT_DYNAMICS = {
  enabled: true,
  frequency: 2.4, // Hz, natural frequency of the bounce
  damping: 0.22, // damping ratio (lower = more overshoot / wobble)
  gain: 1.0, // how strongly chest acceleration excites the bounce
  squashStretch: 0.5, // spread response to vertical motion (0 = off)
  liftAmount: 0.06, // apex lift of bust_lift_up at weight 1, in S units
  limit: 1.0, // clamp on the dynamic slider contribution
};

export class BustDynamics {
  constructor(opts = {}) {
    this.o = { ...DEFAULT_DYNAMICS, ...opts };
    this.reset();
  }
  reset() {
    this.y = 0; // vertical offset of the tissue relative to the chest, S units
    this.v = 0;
    this.prevPos = null;
    this.prevVel = 0;
  }
  /**
   * @param {number} dt seconds
   * @param {number[]} chestPos chest joint world position
   * @param {number[]} up body up axis in world space (unit)
   * @param {number} S body scale
   * @returns {{lift: number, spread: number}} slider-space contributions
   */
  update(dt, chestPos, up, S) {
    const o = this.o;
    if (!o.enabled || dt <= 0) return { lift: 0, spread: 0 };
    dt = Math.min(dt, 1 / 30);
    let acc = 0;
    if (this.prevPos) {
      const vel = dot(sub(chestPos, this.prevPos), up) / dt / S;
      acc = (vel - this.prevVel) / dt;
      this.prevVel = vel;
    }
    this.prevPos = chestPos.slice();
    // Spring-damper in the chest's frame: the tissue lags behind the chest.
    const w = 2 * Math.PI * o.frequency;
    // Semi-implicit Euler with substeps for stability.
    const n = 4, h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -w * w * this.y - 2 * o.damping * w * this.v - o.gain * acc;
      this.v += a * h;
      this.y += this.v * h;
    }
    const lift = clamp(this.y / o.liftAmount, -o.limit, o.limit);
    return { lift, spread: -o.squashStretch * lift };
  }
}

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

// Combine user sliders with runtime contributions into blend shape weights.
export function combineWeights(user, ...extra) {
  const v = { ...user };
  for (const e of extra) {
    v.lift = (v.lift ?? 0) + (e.lift ?? 0);
    v.spread = (v.spread ?? 0) + (e.spread ?? 0);
  }
  return sliderToWeights(v);
}
