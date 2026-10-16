// Runtime layer: exact modal integrator, chest tracking (dt bug fix, hitch,
// cuts), Velocity-Skinning style shapes as linear field ops, clamping policy
// and injectivity of the field at maximum dynamic amplitudes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBodyFrame, createBustField, DEFAULT_PARAMS, cloneParams, toBody, fromBody, sliderToWeights } from '../src/core/field.js';
import { fieldCheck, extremeCombos } from '../src/core/validate.js';
import { sub, dot, clamp } from '../src/core/vec.js';
import {
  dampingFromOvershoot, overshootFromDamping, omegaFromSettle, modeArt, stepCoeffs, oscillatorStep,
  pseudoModes, modeTargets, ModalSystem,
} from '../src/core/modal.js';
import { SQUASH_BASIS, stretchTensor, vskinWeights, vskinTargets, vskinShapes } from '../src/core/vskin.js';
import {
  BustDynamics, ChestTracker, poseAxes, relativeRotation, rotateVec, combineWeights, bustWeights,
  runtimeTargets, withRuntimeTargets, weightSetCheck, dynamicExtremes, sampleMaxDynamics, DYNAMIC_BUDGET,
} from '../src/core/runtime.js';

const FRAME = buildBodyFrame({
  hips: [0, -1.2, 0],
  chest: [0, 0, -0.05],
  neck: [0, 0.5, -0.05],
  leftUpperArm: [0.5, 0.35, -0.05],
  rightUpperArm: [-0.5, 0.35, -0.05],
});
const BODY0 = { ...FRAME, origin: [0, 0, 0] };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------ test motion

const S = 0.35; // world units per S (a 35 cm shoulder span, meters)
function axesFrom(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const R = mul(mul([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], [[1, 0, 0], [0, cp, -sp], [0, sp, cp]]), [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]]);
  const col = (j) => [R[0][j], R[1][j], R[2][j]];
  return { left: col(0), up: col(1), forward: col(2) };
}
// C-infinity fade-in from rest (t <= 0.1) to full motion (t >= 0.7), so every
// frame rate starts from the same (rest) state.
function ramp(t) {
  const u = (t - 0.1) / 0.6;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const a = Math.exp(-1 / u), b = Math.exp(-1 / (1 - u));
  return a / (a + b);
}
// Walk forward + bob + lateral sway + yaw / pitch / roll + a landing dip.
function chestAt(t) {
  const k = ramp(t);
  const land = Math.exp(-((t - 1.6) ** 2) / (2 * 0.12 ** 2)) * 0.15 * S;
  const pos = [0.06 * S * Math.sin(2 * Math.PI * 0.9 * t) * k, 1.2 + 0.035 * S * Math.sin(2 * Math.PI * 1.8 * t) * k - land, 1.2 * t];
  const ax = axesFrom(0.35 * Math.sin(2 * Math.PI * 0.6 * t) * k, 0.12 * Math.sin(2 * Math.PI * 1.1 * t + 0.5) * k, 0.1 * Math.sin(2 * Math.PI * 0.9 * t + 1) * k);
  return { pos, ...ax, S };
}

function simulate(times, opts = {}, pose = chestAt) {
  const d = new BustDynamics({ mapping: 'dedicated', ...opts });
  const out = new Map();
  let prev = null;
  for (const t of times) {
    const r = d.update(prev === null ? 0 : t - prev, pose(t));
    prev = t;
    out.set(Math.round(t * 1e6), { modes: { ...r.modes }, shapes: { ...r.shapes }, w: bustWeights({ sliders: { size: 0.3, lift: 0.2 }, extras: [r] }) });
  }
  return out;
}
const frames = (fps, T = 3) => Array.from({ length: Math.round(T * fps) + 1 }, (_, i) => i / fps);

// max |a - b| over the samples both runs share, relative to the peak of b
function relErr(A, B, key, name, after = -1) {
  let err = 0, peak = 0;
  for (const [k, b] of B) {
    const a = A.get(k);
    if (!a) continue;
    peak = Math.max(peak, Math.abs(b[key][name]));
    if (k / 1e6 > after) err = Math.max(err, Math.abs(a[key][name] - b[key][name]));
  }
  return { err, peak, rel: err / peak };
}

// ------------------------------------------------------------ modal.js

test('overshoot / settle art parameters reproduce the requested step response', () => {
  for (const os of [0.1, 0.25, 0.5]) {
    const zeta = dampingFromOvershoot(os);
    assert.ok(near(overshootFromDamping(zeta), os, 1e-12));
    const { omega } = modeArt({ overshoot: os, settle: 1.2 });
    assert.ok(near(omega, omegaFromSettle(1.2, zeta), 1e-12));
    // envelope reaches 2 % at the settle time
    assert.ok(near(Math.exp(-zeta * omega * 1.2), 0.02, 1e-12));
    // simulated step response: peak / final - 1 = overshoot
    const k = stepCoeffs(1e-3, omega, zeta);
    const st = { q: 0, v: 0 };
    let peak = 0;
    for (let i = 0; i < 5000; i++) peak = Math.max(peak, oscillatorStep(st, k, 1, 1).q);
    const final = 1 / (omega * omega);
    assert.ok(near(peak / final - 1, os, 2e-4), `os ${os}: ${peak / final - 1}`);
  }
  assert.equal(dampingFromOvershoot(0), 1);
});

test('exact step: one long step equals many short ones for polynomial forcing (any damping)', () => {
  const f = (t) => 3 - 40 * t + 90 * t * t; // quadratic forcing
  const H = 0.25;
  for (const zeta of [0, 0.1, 1, 2.5]) {
    const w = 15;
    const one = oscillatorStep({ q: 0.01, v: -0.2 }, stepCoeffs(H, w, zeta), f(0), f(H), f(H / 2));
    const st = { q: 0.01, v: -0.2 };
    const n = 200, h = H / n, k = stepCoeffs(h, w, zeta);
    for (let i = 0; i < n; i++) oscillatorStep(st, k, f(i * h), f((i + 1) * h), f((i + 0.5) * h));
    assert.ok(near(one.q, st.q, 1e-12) && near(one.v, st.v, 1e-10), `zeta ${zeta}: ${one.q} vs ${st.q}`);
  }
  // closed form for a constant force from rest (zeta = 0.3)
  const w = 12, z = 0.3, F = 2, t = 0.37, wd = w * Math.sqrt(1 - z * z);
  const q = oscillatorStep({ q: 0, v: 0 }, stepCoeffs(t, w, z), F, F).q;
  const exact = (F / (w * w)) * (1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t)));
  assert.ok(near(q, exact, 1e-14));
});

test('exact step is unconditionally stable (huge dt, stiff mode)', () => {
  const st = { q: 1, v: 0 };
  const k = stepCoeffs(2, 300, 0.05);
  for (let i = 0; i < 50; i++) oscillatorStep(st, k, 0, 0);
  assert.ok(Math.abs(st.q) <= 1 && Number.isFinite(st.v));
});

test('pseudo-modes: participation follows the mirror symmetry of rigid chest motion', () => {
  const M = Object.fromEntries(pseudoModes().map((m) => [m.name, m]));
  const x0 = DEFAULT_PARAMS.anchor.x;
  const vecNear = (a, b) => a.every((v, i) => near(v, b[i], 1e-15));
  assert.ok(vecNear(M.bounce.p, [0, 1, 0])); // vertical accel
  assert.ok(vecNear(M.surge.p, [0, 0, 1])); // forward accel
  assert.ok(vecNear(M.sway.p, [1, 0, 0])); // lateral accel (antisymmetric mode)
  assert.ok(vecNear(M.breathe.p, [0, 0, 0])); // no linear participation...
  assert.ok(vecNear(M.seesaw.prot, [0, 0, x0])); // roll
  assert.ok(vecNear(M.twist.prot, [0, -x0, 0])); // yaw
  // ...but a yaw spin pushes the breasts apart (centrifugal) and a pure roll
  // spin does too; spinning about the lateral axis does not.
  const sys = new ModalSystem(Object.values(M));
  const k = Object.keys(M).indexOf('breathe');
  const z = [0, 0, 0];
  assert.ok(near(sys.force(k, z, z, [0, 3, 0], z), x0 * 9, 1e-12));
  assert.ok(near(sys.force(k, z, z, [3, 0, 0], z), 0, 1e-12));
});

test('antisymmetric mode targets move both breasts the same world way', () => {
  const p = cloneParams(DEFAULT_PARAMS);
  Object.assign(p.targets, modeTargets(pseudoModes()));
  const f = createBustField(FRAME, p);
  const [L, R] = f.sides;
  const dL = toBody(BODY0, f.delta('bust_dyn_sway', L.apex));
  const dR = toBody(BODY0, f.delta('bust_dyn_sway', R.apex));
  assert.ok(dL[0] > 0.03 * FRAME.S && near(dL[0], dR[0], 1e-12), `${dL} ${dR}`); // both to body +left
  const bL = toBody(BODY0, f.delta('bust_dyn_breathe', L.apex));
  const bR = toBody(BODY0, f.delta('bust_dyn_breathe', R.apex));
  assert.ok(near(bL[0], -bR[0], 1e-12) && bL[0] > 0); // symmetric: apart
});

test('Coriolis coupling is gyroscopic: no energy injected at constant spin', () => {
  // Undamped modes with the external loads removed (only the coupling,
  // still computed from the point samples, acts).
  const z = [0, 0, 0];
  const modes = pseudoModes().map((m) => ({ ...m, zeta: 0, p: z, prot: z, C: new Array(9).fill(0) }));
  const sys = new ModalSystem(modes);
  sys.v[0] = 1; // bounce moving
  const energy = () => modes.reduce((e, m, k) => e + 0.5 * (sys.v[k] ** 2 + m.omega ** 2 * sys.q[k] ** 2), 0);
  const w = [2, 0, 0], E0 = energy(); // spin about the lateral axis couples bounce and surge
  const spin = { a: [z, z, z], alpha: [z, z, z], w: [w, w, w], g: [z, z, z], gain: 1 };
  let surge = 0;
  for (let i = 0; i < 120; i++) {
    sys.step(1 / 60, spin);
    surge = Math.max(surge, Math.abs(sys.q[1]));
  }
  assert.ok(surge > 1e-3, `coupling did not act: ${surge}`);
  assert.ok(Math.abs(energy() / E0 - 1) < 0.005, `energy drift ${energy() / E0 - 1}`);
});

// ------------------------------------------------------------ field linear op + vskin

test('linear field op: Jacobian at its centre is A, linear in A, parity -1 antisymmetric', () => {
  const A = [0.1, -0.05, 0.02, 0.03, -0.08, 0.04, -0.02, 0.06, 0.05];
  const p = cloneParams(DEFAULT_PARAMS);
  const at = [0, 0, -0.12];
  p.targets.lin = [{ type: 'linear', at, A, radius: 0.45 }];
  p.targets.lin2 = [{ type: 'linear', at, A: A.map((v) => 2 * v), radius: 0.45 }];
  p.targets.linAnti = [{ type: 'linear', at, A, radius: 0.45, parity: -1 }];
  const f = createBustField(FRAME, p);
  const side = f.sides[0];
  const q = [0, 0, (p.depth + at[2]) * FRAME.S]; // op centre, side frame rel. base
  const qv = f.fromSideVec(side, q);
  const c = [side.base[0] + qv[0], side.base[1] + qv[1], side.base[2] + qv[2]];
  const J = f.jacobian('lin', c);
  // expected: R A R^T with R = [xAxis | up | forward]
  const R = [side.xAxis, FRAME.up, FRAME.forward];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let e = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) e += R[a][i] * A[a * 3 + b] * R[b][j];
      assert.ok(near(J[i * 3 + j], e, 1e-6), `J[${i}${j}] ${J[i * 3 + j]} vs ${e}`);
    }
  for (const b of [[0.2, 0.05, 0.4], [0.3, -0.12, 0.3], [0.05, 0.1, 0.35]]) {
    const pL = fromBody(FRAME, b.map((v) => v * FRAME.S));
    const pR = fromBody(FRAME, [-b[0] * FRAME.S, b[1] * FRAME.S, b[2] * FRAME.S]);
    const u = f.delta('lin', pL), u2 = f.delta('lin2', pL);
    for (let i = 0; i < 3; i++) assert.ok(near(u2[i], 2 * u[i], 1e-12));
    const sL = toBody(BODY0, f.delta('lin', pL)), sR = toBody(BODY0, f.delta('lin', pR));
    const aL = toBody(BODY0, f.delta('linAnti', pL)), aR = toBody(BODY0, f.delta('linAnti', pR));
    assert.ok(near(sL[0], -sR[0], 1e-12) && near(sL[1], sR[1], 1e-12) && near(sL[2], sR[2], 1e-12)); // mirror
    assert.ok(near(aL[0], aR[0], 1e-12) && near(aL[1], -aR[1], 1e-12) && near(aL[2], -aR[2], 1e-12)); // anti-mirror
  }
});

test('vskin basis: squash tensors are represented exactly, floppy covers any chest rotation', () => {
  // orthonormal traceless symmetric basis
  for (const [i, a] of SQUASH_BASIS.entries()) {
    assert.ok(near(a.E[0] + a.E[4] + a.E[8], 0, 1e-15));
    assert.ok(a.E[1] === a.E[3] && a.E[2] === a.E[6] && a.E[5] === a.E[7]);
    for (const [j, b] of SQUASH_BASIS.entries()) assert.ok(near(a.E.reduce((s, x, e) => s + x * b.E[e], 0), i === j ? 1 : 0, 1e-15));
  }
  const v = [0.3, -0.5, 0.2]; // same side-frame velocity on both sides (symmetric motion)
  const k = 0.1, amp = 0.15;
  const w = vskinWeights({ side: { L: { v, y: [0, 0, 0] }, R: { v, y: [0, 0, 0] } } }, { squash: k, squashAmp: amp, softLimit: false });
  const T = stretchTensor(v, k);
  const rec = new Array(9).fill(0);
  for (const { key, E } of SQUASH_BASIS) for (let e = 0; e < 9; e++) rec[e] += w[`bust_vs_squash_${key}`] * amp * E[e];
  for (let e = 0; e < 9; e++) assert.ok(near(rec[e], T[e], 1e-15), `T[${e}]`);
  assert.ok(near(T[0] + T[4] + T[8], 0, 1e-15)); // volume preserving to first order
  // floppy: theta = -k w, any axis; the targets' parities mirror a pseudovector
  const om = [0.4, -0.7, 0.9];
  const wf = vskinWeights({ omega: om }, { floppy: 0.05, floppyAccel: 0, floppyAmp: 0.15, softLimit: false });
  ['x', 'y', 'z'].forEach((a, i) => assert.ok(near(wf[`bust_vs_floppy_${a}`] * 0.15, -0.05 * om[i], 1e-15)));
  const par = Object.fromEntries(vskinShapes().map((s) => [s.name, s.parity]));
  assert.equal(par.bust_vs_floppy_x, 1);
  assert.equal(par.bust_vs_floppy_y, -1);
  assert.equal(par.bust_vs_floppy_z, -1);
  assert.equal(Object.keys(vskinTargets()).length, 11);
  // each family is bounded by the norm of its weight vector
  const big = vskinWeights({ omega: [1e6, 2e6, -3e6] }, { softLimit: false });
  assert.ok(near(Math.hypot(big.bust_vs_floppy_x, big.bust_vs_floppy_y, big.bust_vs_floppy_z), 1, 1e-12));
});

// ------------------------------------------------------------ tracker / dt bug

// The pre-fix BustDynamics.update (base commit 3a2b3ad), for contrast.
class PreFixDynamics {
  constructor() {
    this.y = 0; this.v = 0; this.prevPos = null; this.prevVel = 0;
  }
  update(dt, chestPos, up, s) {
    dt = Math.min(dt, 1 / 30);
    let acc = 0;
    if (this.prevPos) {
      const vel = dot(sub(chestPos, this.prevPos), up) / dt / s;
      acc = (vel - this.prevVel) / dt;
      this.prevVel = vel;
    }
    this.prevPos = chestPos.slice();
    const w = 2 * Math.PI * 2.4, n = 4, h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-w * w * this.y - 2 * 0.22 * w * this.v - acc) * h;
      this.y += this.v * h;
    }
    return { lift: clamp(this.y / 0.06, -1, 1), y: this.y };
  }
}

test('constant-velocity motion gives no response for any frame timing (incl. a 250 ms frame)', () => {
  const dts = [1 / 60, 1 / 60, 1 / 30, 0.25, 0.004, 1 / 144, 1 / 60, 0.1, 1 / 60, 1 / 60, 1 / 60];
  const d = new BustDynamics({ mapping: 'dedicated' });
  const old = new PreFixDynamics();
  const ax = axesFrom(0.3, 0.05, -0.02); // tilted but constant: gravity part is static
  const pose = (tt) => ({ pos: [0.4 * tt, 1 + 0.9 * tt, 1.1 * tt], ...ax, S });
  // one second of steady 60 fps first (lets the pre-fix integrator's own
  // start-up transient die out, so only the hitch is compared)
  let t = 0;
  for (let i = 0; i <= 60; i++, t = i / 60) {
    d.update(i ? 1 / 60 : 0, pose(t));
    old.update(i ? 1 / 60 : 0, pose(t).pos, [0, 1, 0], S);
  }
  t = 1;
  const q0 = { ...d.out.modes };
  let oldMax = 0, newMax = 0;
  for (const dt of dts) {
    t += dt;
    const r = d.update(dt, pose(t));
    for (const [k, q] of Object.entries(r.modes)) newMax = Math.max(newMax, Math.abs(q - q0[k]));
    oldMax = Math.max(oldMax, Math.abs(old.update(dt, pose(t).pos, [0, 1, 0], S).lift));
  }
  assert.ok(newMax < 1e-9, `modes moved by ${newMax} S`);
  assert.ok(oldMax > 0.5, `pre-fix integrator kicks on the hitch: |lift| ${oldMax}`);
});

test('a 250 ms hitch causes no spurious kick (pre-fix integrator: large kick)', (t) => {
  const K = 72; // the frame after t = 1.2 s arrives 250 ms later
  const ref = frames(60), hit = ref.filter((_, i) => !(i > K && i < K + 15));
  const A = simulate(ref), B = simulate(hit);
  const notes = [];
  for (const n of ['bounce', 'surge', 'sway']) {
    const e = relErr(B, A, 'modes', n, K / 60);
    let post = 0, postRef = 0;
    for (const [k, b] of B) if (k / 1e6 > K / 60) { post = Math.max(post, Math.abs(b.modes[n])); postRef = Math.max(postRef, Math.abs(A.get(k).modes[n])); }
    // The 250 ms of motion the frame skipped are unknown, so the trajectory
    // may deviate, but it must not overshoot the uninterrupted one.
    assert.ok(post <= 1.1 * postRef, `${n} kicked: ${post} vs ${postRef}`);
    assert.ok(e.rel < 0.25, `${n} deviation ${e.rel}`);
    notes.push(`${n} dev ${(e.rel * 100).toFixed(1)} % peak x${(post / postRef).toFixed(3)}`);
  }
  // same scenario through the pre-fix integrator
  const old = (times) => {
    const d = new PreFixDynamics();
    const out = new Map();
    let prev = null;
    for (const t of times) {
      const c = chestAt(t);
      out.set(Math.round(t * 1e6), { y: { y: d.update(prev === null ? 0 : t - prev, c.pos, [0, 1, 0], S).y } });
      prev = t;
    }
    return out;
  };
  const OA = old(ref), OB = old(hit);
  const oe = relErr(OB, OA, 'y', 'y', K / 60);
  let post = 0, postRef = 0;
  for (const [k, b] of OB) if (k / 1e6 > K / 60) { post = Math.max(post, Math.abs(b.y.y)); postRef = Math.max(postRef, Math.abs(OA.get(k).y.y)); }
  assert.ok(oe.rel > 1 && post > 1.25 * postRef, `pre-fix deviation ${oe.rel}, peak x${post / postRef}`);
  t.diagnostic(`new: ${notes.join(', ')}; pre-fix: dev ${(oe.rel * 100).toFixed(0)} % peak x${(post / postRef).toFixed(2)}`);
});

test('a hitch during slow motion barely changes the trajectory', (t) => {
  const slow = (t) => {
    const k = ramp(t);
    return { pos: [0.08 * S * Math.sin(2 * Math.PI * 0.5 * t) * k, 1 + 0.05 * S * Math.sin(2 * Math.PI * 0.7 * t) * k, 0.8 * t], ...axesFrom(0.2 * Math.sin(2 * Math.PI * 0.4 * t) * k, 0, 0), S };
  };
  const K = 90;
  const ref = frames(60), hit = ref.filter((_, i) => !(i > K && i < K + 15));
  const A = simulate(ref, {}, slow), B = simulate(hit, {}, slow);
  const notes = [];
  for (const n of ['bounce', 'sway', 'twist']) {
    const e = relErr(B, A, 'modes', n, K / 60);
    assert.ok(e.rel < 0.05, `${n} deviation ${e.rel}`);
    notes.push(`${n} ${(e.rel * 100).toFixed(2)} %`);
  }
  t.diagnostic(`post-hitch deviation: ${notes.join(', ')}`);
});

test('trajectories at 30 / 60 / 120 fps agree within 1 %', (t) => {
  const R = simulate(frames(480));
  const runs = { 30: simulate(frames(30)), 60: simulate(frames(60)), 120: simulate(frames(120)) };
  let worstMode = 0, worstShape = 0, worstW = 0;
  for (const [fps, run] of Object.entries(runs)) {
    for (const n of Object.keys(R.get(0).modes)) {
      const e = relErr(run, R, 'modes', n);
      worstMode = Math.max(worstMode, e.rel);
      assert.ok(e.rel <= 0.01, `${fps} fps mode ${n}: ${(e.rel * 100).toFixed(3)} %`);
    }
  }
  for (const [a, b] of [[30, 120], [60, 120], [30, 60]]) {
    for (const n of Object.keys(R.get(0).shapes)) {
      const e = relErr(runs[a], runs[b], 'shapes', n);
      worstShape = Math.max(worstShape, e.rel);
      assert.ok(e.rel <= 0.01, `${a} vs ${b} fps shape ${n}: ${(e.rel * 100).toFixed(3)} %`);
    }
    for (const n of Object.keys(R.get(0).w)) {
      const e = relErr(runs[a], runs[b], 'w', n);
      worstW = Math.max(worstW, e.err);
      assert.ok(e.err <= 0.01, `${a} vs ${b} fps final weight ${n}: ${e.err}`);
    }
  }
  t.diagnostic(`worst: modes ${(worstMode * 100).toFixed(3)} % of peak, shape weights ${(worstShape * 100).toFixed(3)} % of peak, final weights ${worstW.toExponential(2)} abs`);
});

test('cuts: teleports and long gaps reset to the quasi-static state; reset() restarts', () => {
  const restAxes = { left: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] };
  const d = new BustDynamics({ mapping: 'dedicated', restAxes });
  const ts = frames(60, 1);
  for (const t of ts) d.update(t ? 1 / 60 : 0, chestAt(t + 1));
  assert.ok(Math.abs(d.out.modes.bounce) > 1e-3);
  // teleport 10 S sideways, then keep moving from there
  const moved = (tt) => { const c = chestAt(tt); return { ...c, pos: [c.pos[0] + 10 * S, c.pos[1], c.pos[2]] }; };
  const r = d.update(1 / 60, moved(2));
  assert.equal(r.status, 'cut');
  assert.equal(r.cut, 'speed');
  for (const k of d.modal.v) assert.equal(k, 0);
  // settled to gravity only: the same as a fresh start in that pose
  const fresh = new BustDynamics({ mapping: 'dedicated', restAxes });
  fresh.update(0, moved(2));
  for (const [k, q] of Object.entries(r.modes)) assert.ok(near(q, fresh.out.modes[k], 1e-15));
  assert.equal(d.update(1 / 60, moved(2 + 1 / 60)).status, 'warmup');
  assert.equal(d.update(1 / 60, moved(2 + 2 / 60)).status, 'step');
  assert.equal(d.update(0.8, moved(3)).cut, 'dt'); // longer than maxDt: a cut, not a kick
  d.reset();
  assert.equal(d.update(1 / 60, chestAt(4)).status, 'init');
  assert.equal(d.update(0, chestAt(4)).status, 'skip'); // zero dt is merged, not differentiated
});

test('gravity: only the change from the upright rest pose loads the modes', () => {
  const d = new BustDynamics({ mapping: 'dedicated' });
  d.update(0, { pos: [0, 1, 0], left: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], S });
  for (const q of Object.values(d.out.modes)) assert.ok(Math.abs(q) < 1e-15); // upright: rest shape
  // lying on the back: body forward = world up, body up = world -z
  d.reset();
  const lying = { pos: [0, 0.2, 0], left: [1, 0, 0], up: [0, 0, -1], forward: [0, 1, 0], S };
  d.update(0, lying);
  const M = Object.fromEntries(d.modal.modes.map((m) => [m.name, m]));
  const g = 9.81 / S;
  assert.ok(near(d.out.modes.bounce, g / M.bounce.omega ** 2, 1e-12)); // no longer sagging toward the feet
  assert.ok(near(d.out.modes.surge, -g / M.surge.omega ** 2, 1e-12)); // sinks toward the chest
  for (let i = 1; i <= 120; i++) d.update(1 / 60, lying); // stays there when static
  assert.ok(near(d.out.modes.bounce, g / M.bounce.omega ** 2, 1e-9));
  // A rest frame tilted forward (hips -> neck is rarely vertical, ~6 deg on
  // an MMD model) is the reference, not "body up = world up": no rest sag,
  // through the legacy call and with explicit rest axes.
  const tilt = axesFrom(0, 0.11, 0);
  const legacy = new BustDynamics();
  for (let i = 0; i < 30; i++) legacy.update(i ? 1 / 60 : 0, [0, 1, 0], tilt.up, S);
  for (const q of Object.values(legacy.out.modes)) assert.ok(Math.abs(q) < 1e-12);
  const full = new BustDynamics({ mapping: 'dedicated', restAxes: tilt });
  full.update(0, { pos: [0, 1, 0], ...axesFrom(0, 0.11 + Math.PI / 2, 0), S }); // starts lying
  assert.ok(Math.abs(full.out.modes.surge) > 1e-3);
  full.update(0, { pos: [0, 1, 0], ...tilt, S });
  full.reset();
  full.update(0, { pos: [0, 1, 0], ...tilt, S });
  for (const q of Object.values(full.out.modes)) assert.ok(Math.abs(q) < 1e-12);
});

test('chest rotations: relative rotation and Rodrigues agree', () => {
  const a = axesFrom(0.3, -0.2, 0.1), b = axesFrom(0.5, 0.1, -0.3);
  const ax0 = poseAxes(a), ax1 = poseAxes(b);
  const th = relativeRotation(ax0, ax1);
  // rotating body-frame-0 coordinates of each axis of frame 1 by -th gives e_i
  for (let i = 0; i < 3; i++) {
    const c = [dot(ax0[0], ax1[i]), dot(ax0[1], ax1[i]), dot(ax0[2], ax1[i])];
    const e = rotateVec(c, th.map((v) => -v));
    for (let j = 0; j < 3; j++) assert.ok(near(e[j], i === j ? 1 : 0, 1e-12));
  }
  const tr = new ChestTracker();
  assert.equal(tr.push(0, [0, 0, 0], ax0, 1).status, 'init');
});

test('legacy API: update(dt, chestPos, up, S) and combineWeights keep working', () => {
  const d = new BustDynamics(); // compat mapping (viewer today)
  let lift = 0, spread = 0;
  for (let i = 0; i <= 90; i++) {
    const t = i / 60;
    const r = d.update(i ? 1 / 60 : 0, [0, 1 + 0.05 * S * Math.sin(2 * Math.PI * 1.8 * t) * ramp(t), 0], [0, 1, 0], S);
    if (Math.abs(r.lift) > Math.abs(lift)) ({ lift, spread } = r);
  }
  assert.ok(Math.abs(lift) > 0.05 && Math.sign(spread) === -Math.sign(lift)); // stretch tall = thin
  const w = combineWeights({ size: 0.5, style: 0.5, lift: 0.95, spread: 0 }, { lift: 0.3, spread: -0.2, shapes: { bust_vs_squash_a: 0.4 } }, { lift: 0.1 });
  assert.equal(w.bust_lift_up, 1); // slider channel: summed then clamped
  assert.ok(near(w.bust_spread_in, 0.2, 1e-12));
  assert.ok(near(w.bust_vs_squash_a, 0.4, 1e-12));
  for (const [k, v] of Object.entries(sliderToWeights({ size: 0.5 }))) assert.ok(k in w && v >= 0);
});

test('clamping policy: pairs, joint budget and the envelope shared with the sliders', () => {
  const p = bustWeights({ extras: [{ shapes: { bust_dyn_bounce: -0.3 } }], pairs: true });
  assert.equal(p.bust_dyn_bounce_pos, 0);
  assert.ok(near(p.bust_dyn_bounce_neg, 0.3, 1e-12));
  // joint budget on the dynamic weight vector
  const many = Object.fromEntries(Object.keys(runtimeTargets()).map((k) => [k, 1]));
  const b = bustWeights({ extras: [{ shapes: many }], envelope: null });
  const n = Math.hypot(...Object.keys(many).map((k) => b[k]));
  assert.ok(n <= DYNAMIC_BUDGET + 1e-12 && n > 0.99 * DYNAMIC_BUDGET);
  // small dynamics at neutral sliders pass through unchanged
  const small = bustWeights({ extras: [{ shapes: { bust_dyn_breathe: 0.3, bust_vs_floppy_y: -0.2 } }] });
  assert.equal(small.bust_dyn_breathe, 0.3);
  assert.equal(small.bust_vs_floppy_y, -0.2);
  // spread fully in: no lateral room left inward, plenty outward
  const inward = bustWeights({ sliders: { spread: -1 }, extras: [{ shapes: { bust_dyn_breathe: -1 } }] });
  const outward = bustWeights({ sliders: { spread: -1 }, extras: [{ shapes: { bust_dyn_breathe: 1 } }] });
  assert.ok(Math.abs(inward.bust_dyn_breathe) < 1e-12 && outward.bust_dyn_breathe === 1);
  // lift fully down: the bounce may only go up
  const down = bustWeights({ sliders: { lift: -1 }, extras: [{ shapes: { bust_dyn_bounce: -0.5, bust_vs_squash_b: 0.5 } }] });
  assert.ok(Math.abs(down.bust_dyn_bounce) < 1e-12 && down.bust_vs_squash_b === 0.5); // squash_b does not move the apex vertically
  const up = bustWeights({ sliders: { lift: -1 }, extras: [{ shapes: { bust_dyn_bounce: 0.5 } }] });
  assert.equal(up.bust_dyn_bounce, 0.5);
});

test('dedicated mapping only drives targets that runtimeTargets bakes', () => {
  const d = new BustDynamics({ mapping: 'dedicated' });
  for (let i = 0; i < 40; i++) d.update(i ? 1 / 60 : 0, chestAt(1 + i / 60));
  const baked = new Set(Object.keys(runtimeTargets()));
  for (const k of Object.keys(d.out.shapes)) assert.ok(baked.has(k), k);
  assert.equal(d.out.lift, 0);
  const p = withRuntimeTargets();
  assert.equal(Object.keys(p.targets).length, 7 + 6 + 11);
  assert.equal(Object.keys(DEFAULT_PARAMS.targets).length, 7); // not mutated
});

// ------------------------------------------------------------ injectivity

test('det(I + sum w J) > 0 at maximum dynamic amplitudes on every slider extreme (fieldCheck)', (t) => {
  const field = createBustField(FRAME, withRuntimeTargets());
  const res = 10;
  // the virtual-target view reproduces fieldCheck on plain slider combos
  const base = fieldCheck(field, { res });
  const same = weightSetCheck(field, extremeCombos().map((c) => sliderToWeights(c)), { res });
  assert.ok(near(base.minDet, same.minDet, 1e-12), `${base.minDet} vs ${same.minDet}`);
  const dyn = Object.keys(runtimeTargets());
  // (a) every runtime target alone at +-1
  const singles = weightSetCheck(field, dynamicExtremes(dyn.flatMap((n) => [{ [n]: 1 }, { [n]: -1 }])), { res });
  // (b) all six modes at +-1 together, every sign pattern
  const modes = dyn.filter((n) => n.startsWith('bust_dyn_'));
  const patterns = Array.from({ length: 64 }, (_, m) => Object.fromEntries(modes.map((n, i) => [n, (m >> i) & 1 ? 1 : -1])));
  const allModes = weightSetCheck(field, dynamicExtremes(patterns), { res });
  // (c) reachable maxima of everything at once (modes at +-1, each vskin family saturated)
  const all = weightSetCheck(field, dynamicExtremes(sampleMaxDynamics({ count: 24, seed: 5 })), { res });
  t.diagnostic(`min det: sliders only ${base.minDet.toFixed(3)}, +single target ${singles.minDet.toFixed(3)}, +all modes ${allModes.minDet.toFixed(3)}, +everything ${all.minDet.toFixed(3)}`);
  assert.ok(singles.injective && singles.minDet > 0.05, `singles ${singles.minDet}`);
  assert.ok(allModes.injective && allModes.minDet > 0.02, `all modes ${allModes.minDet}`);
  assert.ok(all.injective && all.minDet > 0.02, `everything ${all.minDet}`);
});
