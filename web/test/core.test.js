// Invariants the bust-morph method must keep regardless of the deformation
// kernel. These are what make the baked blend shapes safe to port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grab, scaleBrush } from '../src/core/kelvinlet.js';
import { buildBodyFrame, createBustField, DEFAULT_PARAMS, cloneParams, sliderToWeights, toBody, fromBody } from '../src/core/field.js';
import { bakeMesh, computeMask } from '../src/core/bake.js';
import { fieldCheck, meshCheck, normalCheck } from '../src/core/validate.js';

const FRAME = buildBodyFrame({
  hips: [0, -1.2, 0],
  chest: [0, 0, -0.05],
  neck: [0, 0.5, -0.05],
  leftUpperArm: [0.5, 0.35, -0.05],
  rightUpperArm: [-0.5, 0.35, -0.05],
});
const field = createBustField(FRAME, DEFAULT_PARAMS);
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

function divergence(fn, p, h = 1e-4) {
  let s = 0;
  for (let j = 0; j < 3; j++) {
    const a = p.slice(), b = p.slice();
    a[j] += h;
    b[j] -= h;
    s += (fn(a)[j] - fn(b)[j]) / (2 * h);
  }
  return s;
}

test('kelvinlet grab hits the requested displacement at the centre', () => {
  assert.ok(close(grab([0, 0, 0], [0.1, -0.2, 0.3], 0.5, 0.45), [0.1, -0.2, 0.3], 1e-12));
});

test('kelvinlet grab is divergence-free (volume preserving) at nu = 0.5', () => {
  for (const p of [[0.3, 0.2, 0.1], [1, 0.5, -0.3], [2, 1, 1]]) {
    assert.ok(Math.abs(divergence((q) => grab(q, [0, 1, 0], 1, 0.5), p)) < 1e-6);
  }
});

test('tri-scale kelvinlets are local (< 2% at 4 radii)', () => {
  assert.ok(Math.abs(grab([0, 4, 0], [0, 1, 0], 1, 0.45)[1]) < 0.02);
  assert.ok(Math.abs(scaleBrush([4, 0, 0], 0.3, 1, 0.2)[0]) < 0.02 * 4 * 0.3);
});

test('scale brush matches the requested dilation rate near the centre', () => {
  const u = scaleBrush([1e-4, 0, 0], 0.3, 1, 0.2);
  assert.ok(Math.abs(u[0] / 1e-4 - 0.3) < 1e-3);
});

test('field is exactly zero outside its compact support', () => {
  for (const b of [[0, -1.0, 0.2], [0.9, 0, 0.2], [0, 0.6, 0.2], [0.24, 0, -0.6]]) {
    const p = fromBody(FRAME, b.map((v) => v * FRAME.S));
    for (const t of field.targets) assert.deepEqual(field.delta(t, p), [0, 0, 0], `${t} at ${b}`);
  }
});

test('field is mirror symmetric across the midline', () => {
  for (const b of [[0.2, 0.05, 0.4], [0.35, -0.1, 0.3], [0.05, 0.1, 0.35]]) {
    const pL = fromBody(FRAME, b.map((v) => v * FRAME.S));
    const pR = fromBody(FRAME, [-b[0] * FRAME.S, b[1] * FRAME.S, b[2] * FRAME.S]);
    for (const t of field.targets) {
      const dL = toBody({ ...FRAME, origin: [0, 0, 0] }, field.delta(t, pL));
      const dR = toBody({ ...FRAME, origin: [0, 0, 0] }, field.delta(t, pR));
      assert.ok(close(dL, [-dR[0], dR[1], dR[2]], 1e-9), `${t} at ${b}`);
    }
  }
});

test('midline points never move laterally', () => {
  for (const y of [-0.2, 0, 0.1]) {
    const p = fromBody(FRAME, [0, y * FRAME.S, 0.35 * FRAME.S]);
    for (const t of field.targets) {
      const d = toBody({ ...FRAME, origin: [0, 0, 0] }, field.delta(t, p));
      assert.ok(Math.abs(d[0]) < 1e-12, `${t} lateral ${d[0]}`);
    }
  }
});

test('default parameters are injective at every slider extreme', () => {
  const r = fieldCheck(field, { res: 10 });
  assert.ok(r.injective && r.minDet > 0.1, `min det ${r.minDet} @ ${r.minCombo}`);
});

test('slider mapping keeps one-sided weights in 0..1 and mixes style', () => {
  const w = sliderToWeights({ size: 0.8, style: 0.25, lift: -0.5, spread: 2 });
  assert.equal(w.bust_size_up_natural, 0.8 * 0.75);
  assert.equal(w.bust_size_up_stylized, 0.8 * 0.25);
  assert.equal(w.bust_lift_down, 0.5);
  assert.equal(w.bust_spread_out, 1);
  for (const v of Object.values(w)) assert.ok(v >= 0 && v <= 1);
});

// A UV-seamed "breast" sphere: duplicated vertices along a seam, placed at the left apex.
function seamedSphere(centre, radius, seg = 24) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI;
    for (let j = 0; j <= seg; j++) {
      // j = 0 and j = seg coincide: a UV seam with split vertices
      const ph = (j / seg) * 2 * Math.PI;
      const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      pos.push(centre[0] + radius * n[0], centre[1] + radius * n[1], centre[2] + radius * n[2]);
      nrm.push(...n);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), index: new Uint32Array(idx) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('baked deltas are identical on split seam vertices and nothing flips', () => {
  const apex = field.sides[0].apex;
  const centre = [apex[0], apex[1], apex[2] - 0.08 * FRAME.S];
  const s = seamedSphere(centre, 0.12 * FRAME.S);
  const res = bakeMesh({ ...s, bindMatrix: IDENTITY, mask: null }, field);
  const m = meshCheck([{ name: 'sphere', pos: s.positions, index: s.index, deltas: Object.fromEntries(Object.entries(res.targets).map(([k, v]) => [k, v.dPos])) }], FRAME.S);
  assert.ok(m.coincidentVertices > 0);
  for (const [t, e] of Object.entries(m.seamMismatch)) assert.equal(e, 0, t);
  assert.equal(m.flippedTriangles, 0);
});

test('analytic normal deltas agree with geometric normals on a smooth surface', () => {
  const apex = field.sides[0].apex;
  const s = seamedSphere([apex[0], apex[1], apex[2] - 0.08 * FRAME.S], 0.12 * FRAME.S, 48);
  const res = bakeMesh({ ...s, bindMatrix: IDENTITY, mask: null }, field);
  for (const t of ['bust_size_up_stylized', 'bust_lift_up']) {
    const r = normalCheck(s.positions, s.index, s.normals, res.targets[t].dPos, res.targets[t].dNrm, FRAME.S);
    assert.ok(r.median < 1.0 && r.p95 < 3.0, `${t} median ${r.median} p95 ${r.p95}`);
  }
});

test('baking is invariant to the mesh-to-bind transform', () => {
  const apex = field.sides[0].apex;
  const s = seamedSphere([0, 0, 0], 0.1 * FRAME.S, 12);
  // Local mesh placed with rotation (90 deg about Y), scale 2 and translation to the apex.
  const M = [0, 0, -2, 0, 0, 2, 0, 0, 2, 0, 0, 0, apex[0], apex[1], apex[2] - 0.05 * FRAME.S, 1];
  const local = { ...s, positions: s.positions.map((v) => v / 2), bindMatrix: M, mask: null };
  const world = { ...s, bindMatrix: IDENTITY, mask: null };
  // world copy = M applied to local positions
  const wp = new Float32Array(s.positions.length);
  for (let i = 0; i < wp.length; i += 3) {
    const x = local.positions[i], y = local.positions[i + 1], z = local.positions[i + 2];
    wp[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
    wp[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    wp[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  }
  world.positions = wp;
  world.normals = null;
  local.normals = null;
  const a = bakeMesh(local, field, ['bust_size_up_natural']).targets.bust_size_up_natural.dPos;
  const b = bakeMesh(world, field, ['bust_size_up_natural']).targets.bust_size_up_natural.dPos;
  for (let i = 0; i < a.length; i += 3) {
    const dx = a[i], dy = a[i + 1], dz = a[i + 2];
    const w = [M[0] * dx + M[4] * dy + M[8] * dz, M[1] * dx + M[5] * dy + M[9] * dz, M[2] * dx + M[6] * dy + M[10] * dz];
    assert.ok(close(w, [b[i], b[i + 1], b[i + 2]], 1e-6), `vertex ${i / 3}`);
  }
});

test('skin-weight mask removes arm-weighted vertices', () => {
  const mask = computeMask(new Float32Array([0, 1, 0, 0, 2, 0, 0, 0]), new Float32Array([0.25, 0.75, 0, 0, 1, 0, 0, 0]), 4, 2, new Set([1]));
  assert.equal(mask[0], 0.25);
  assert.equal(mask[1], 1);
});
