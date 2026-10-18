import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinationCheck, targetCombinations } from '../src/core/validate.js';
import { buildBodyFrame, createBustField, DEFAULT_PARAMS } from '../src/core/field.js';
import { m3Inverse, m3Transpose, m3Vec, normalize, cross, dot } from '../src/core/vec.js';

const ZERO = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const POINTS = [[0.1, 0.2, 0.3], [-0.1, 0.2, 0.4]];
const affine = (matrices) => ({
  targets: Object.keys(matrices), jacobian: (t) => matrices[t],
  delta: (t, p) => m3Vec(matrices[t], p),
});
const transform = (J, n) => normalize(m3Vec(m3Transpose(m3Inverse(J.map((v, i) => v + (i % 4 === 0 ? 1 : 0)))), n));
const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) * 180 / Math.PI;

test('pair/triple enumeration covers independent endpoint and in-between weights', () => {
  const cases = targetCombinations(['A', 'B', 'C'], { levels: [0.5, 1] });
  assert.equal(cases.length, 20); // 3 pairs * 2^2 + one triple * 2^3
  assert.ok(cases.some((w) => w.A === 0.5 && w.B === 1 && !('C' in w)));
  assert.ok(cases.some((w) => w.A === 1 && w.B === 0.5 && w.C === 1));
  assert.equal(new Set(cases.map(JSON.stringify)).size, cases.length);
  const defaults = targetCombinations(Object.keys(DEFAULT_PARAMS.targets));
  assert.equal(defaults.length, 21 * 16 + 35 * 64);
  assert.ok(defaults.some((w) => w.bust_size_down === 0.25 && w.bust_lift_up === 0.5 && w.bust_spread_in === 0.75));
});

test('identity combinations have zero normal error and expose a map for every sample', () => {
  const result = combinationCheck(affine({ A: ZERO, B: ZERO }), { points: POINTS });
  assert.equal(result.combinations.length, 16);
  assert.equal(result.minDet, 1);
  assert.equal(result.maxNormalError, 0);
  assert.deepEqual(result.correctiveCombinations, []);
  for (const c of result.combinations) {
    assert.deepEqual(c.map.determinants, [1, 1]);
    assert.deepEqual(c.map.normalErrorDegrees, [0, 0]);
  }
});

test('combined F^-T detects the actual endpoint-normal blending error at partial weights', () => {
  const A = [0, 1, 0, 0, 0, 0, 0, 0, 0];
  const B = [0, 0, 0, 1, 0, 0, 0, 0, 0];
  const n = [1, 0, 0], weights = { A: 0.5, B: 0.25 };
  const exact = transform(A.map((v, i) => weights.A * v + weights.B * B[i]), n);
  const a = transform(A, n), b = transform(B, n);
  const blended = normalize(n.map((v, i) => v + weights.A * (a[i] - v) + weights.B * (b[i] - v)));
  const expected = angle(exact, blended);
  assert.ok(expected > 1);
  const result = combinationCheck(affine({ A, B }), {
    points: POINTS, normals: POINTS.map(() => n), combinations: [weights], normalErrorThreshold: 1,
  });
  const c = result.combinations[0];
  assert.ok(Math.abs(c.minDet - 0.875) < 1e-12);
  assert.ok(Math.abs(c.normalError.max - expected) < 1e-12);
  assert.deepEqual(c.reasons, ['normal-error']);
  assert.equal(result.correctiveCombinations[0].index, 0);
  assert.equal(c.map.normalErrorDegrees.length, POINTS.length);
});

test('a single target is exact at its baked endpoint but may require an in-between normal', () => {
  const A = [0, 1.2, 0, 0, 0, 0, 0, 0, 0];
  const result = combinationCheck(affine({ A }), {
    points: [POINTS[0]], normals: [[1, 0, 0]], combinations: [{ A: 1 }, { A: 0.5 }],
  });
  assert.ok(result.combinations[0].normalError.max < 1e-12);
  assert.ok(result.combinations[1].normalError.max > 1);
});

test('near-singular, folded and singular combinations are reported without NaN', () => {
  const shrink = (x) => [x, 0, 0, 0, 0, 0, 0, 0, 0];
  const result = combinationCheck(affine({ A: shrink(-0.6), B: shrink(-0.4) }), {
    points: [POINTS[0]], combinations: [{ A: 1, B: 0.75 }, { A: 1, B: 1 }, { A: 1, B: 1.25 }],
  });
  assert.ok(Math.abs(result.combinations[0].minDet - 0.1) < 1e-12);
  assert.ok(result.combinations[0].reasons.includes('determinant'));
  assert.equal(result.combinations[1].singularSamples, 1);
  assert.equal(result.combinations[1].normalError.max, 180);
  assert.ok(result.combinations[1].reasons.includes('singular-normal-transform'));
  assert.ok(result.combinations[2].minDet < 0);
  assert.equal(result.correctiveCombinations.length, 3);
});

test('singular target endpoints cannot silently supply a valid blended normal', () => {
  const result = combinationCheck(affine({ A: [-1, 0, 0, 0, 0, 0, 0, 0, 0], B: ZERO }), {
    points: [POINTS[0]], combinations: [{ A: 0.5, B: 0.5 }],
  });
  assert.equal(result.combinations[0].minDet, 0.5);
  assert.equal(result.combinations[0].normalError.max, 180);
  assert.equal(result.combinations[0].singularSamples, 1);
});

test('normalizing supplied normals and omitting maps preserve summary results', () => {
  const field = affine({ A: ZERO, B: ZERO });
  const a = combinationCheck(field, { points: POINTS, normals: [[2, 0, 0], [0, 3, 0]] });
  const b = combinationCheck(field, { points: POINTS, normals: [[1, 0, 0], [0, 1, 0]], includeMaps: false });
  for (const [i, c] of b.combinations.entries()) {
    assert.equal(c.map, undefined);
    assert.equal(c.minDet, a.combinations[i].minDet);
    assert.deepEqual(c.normalError, a.combinations[i].normalError);
  }
});

test('invalid validation inputs fail explicitly instead of producing a passing report', () => {
  const field = affine({ A: ZERO, B: ZERO });
  assert.throws(() => combinationCheck(field, { points: [] }), /sample/);
  assert.throws(() => combinationCheck(field, { points: POINTS, normals: [[0, 0, 0]] }), /normals/);
  assert.throws(() => combinationCheck(field, { points: [[NaN, 0, 0]] }), /finite/);
  assert.throws(() => combinationCheck(field, { points: POINTS, combinations: [{ nope: 1 }] }), /unknown target/);
  assert.throws(() => combinationCheck(field, { points: POINTS, combinations: [{ A: Infinity }] }), /finite/);
  assert.throws(() => combinationCheck(field, { points: POINTS, minDetThreshold: -1 }), /thresholds/);
  assert.throws(() => targetCombinations(['A', 'A']), /duplicate/);
  assert.throws(() => targetCombinations(['A'], { levels: [0, 1] }), /levels/);
  assert.throws(() => targetCombinations(['A'], { sizes: [1.5] }), /sizes/);
});

test('default field positions superpose exactly by amplitudes and combined Jacobian is their derivative', () => {
  const frame = buildBodyFrame({ hips: [0, -1, 0], chest: [0, 0, 0], neck: [0, 0.5, 0], leftUpperArm: [0.5, 0.3, 0], rightUpperArm: [-0.5, 0.3, 0] });
  const p = [0.24, 0.04, 0.36];
  const weights = { bust_size_up_stylized: 0.75, bust_lift_up: 0.5, bust_spread_in: 0.25 };
  const base = createBustField(frame);
  // Assemble a single target from scaled atoms, independently of the runtime
  // weight accumulation. Both brush kinds are linear in d/k (and A).
  const ops = Object.entries(weights).flatMap(([target, w]) => DEFAULT_PARAMS.targets[target].map((op) => ({
    ...op, ...(op.d ? { d: op.d.map((v) => v * w) } : {}), ...(op.k !== undefined ? { k: op.k * w } : {}),
  })));
  const joined = createBustField(frame, { ...DEFAULT_PARAMS, targets: { combined: ops } });
  const expected = [0, 0, 0], J = ZERO.slice();
  for (const [target, w] of Object.entries(weights)) {
    const d = base.delta(target, p), j = base.jacobian(target, p);
    d.forEach((v, i) => { expected[i] += w * v; });
    j.forEach((v, i) => { J[i] += w * v; });
  }
  joined.delta('combined', p).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-14));
  joined.jacobian('combined', p).forEach((v, i) => assert.ok(Math.abs(v - J[i]) < 1e-12));
  const report = combinationCheck(base, { res: 2, combinations: [weights], includeMaps: false });
  assert.ok(report.sampleCount > 0);
  assert.ok(Number.isFinite(report.minDet));
});
