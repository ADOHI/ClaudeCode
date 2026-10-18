// Bust morphometrics (src/core/morpho.js): definitions behave as documented
// and the numbers do not depend on how the surface is tessellated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measureBust, prepareMorpho, measurePrepared, scoreBands, selectTriangles, BANDS, METRICS, MORPHO_DEFAULTS,
} from '../src/core/morpho.js';
import { createBustField, DEFAULT_PARAMS, cloneParams } from '../src/core/field.js';
import { bakeMesh } from '../src/core/bake.js';
import { synthTorso, midpointSubdivide, SYNTH_FRAME } from '../../tools/morpho/synth-torso.mjs';
import { bakeBind } from '../../tools/morpho/bindio.mjs';

const measure = (s, extra = {}) => measureBust({ frame: s.frame, meshes: [{ pos: s.pos, index: s.index }], apex: s.apex, ...extra });

// Relative difference used for the resolution criterion: |a - b| over the
// metric's magnitude, with a floor for metrics that can sit near zero
// (signed angles, sagitta ratios) or are positions (IMF height: relative to
// the breast's base height). Documented in the work-package report.
const FLOORS = { tiltDeg: 20, upperSlopeDeg: 20, divergenceDeg: 20, turnDeg: 20, upperConvexity: 0.2, lowerConvexity: 0.2 };
function relDiff(key, a, b, ref) {
  const floor = key === 'imfY' ? ref.baseHeight : FLOORS[key] ?? 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), floor);
}
function compare(ma, mb) {
  const out = {};
  for (const { key } of METRICS) {
    const a = ma[key], b = mb[key];
    if (a == null || b == null) out[key] = a === b ? 0 : Infinity;
    else out[key] = relDiff(key, a, b, mb);
  }
  return out;
}
const worst = (d) => Object.entries(d).sort((x, y) => y[1] - x[1])[0];

// Shapes the coarse grid can represent (bounded slopes, crease wider than one
// cell); Changli's bust has ~0.045 S edges, this coarse grid 0.02 S.
const SHAPES = {
  round: {},
  'full lower pole': { bUp: 0.12, bLo: 0.19 },
  'full upper pole': { bUp: 0.19, bLo: 0.13 },
  'lateral heavy': { aLat: 0.19, aMed: 0.12 },
  'flat rim': { R: 2.5 },
};

for (const [name, shape] of Object.entries(SHAPES)) {
  test(`resolution: ${name} mound, grid h=0.02 vs 4x finer h=0.005 differ < 2%`, () => {
    const coarse = measure(synthTorso({ h: 0.02, ...shape })).sides[0];
    const fine = measure(synthTorso({ h: 0.005, ...shape })).sides[0];
    assert.ok(coarse.ok && fine.ok, `${coarse.flags} / ${fine.flags}`);
    const d = compare(coarse, fine);
    const [k, v] = worst(d);
    assert.ok(v < 0.02, `${k}: ${coarse[k]} vs ${fine[k]} (${(v * 100).toFixed(2)}%)`);
  });
}

test('resolution: irregular (jittered) coarse mesh vs fine grid differ < 2% on the primary metrics', () => {
  const coarse = measure(synthTorso({ h: 0.02, jitter: 0.6 })).sides[0];
  const fine = measure(synthTorso({ h: 0.005 })).sides[0];
  const d = compare(coarse, fine);
  for (const k of ['upperPoleFrac', 'imfY', 'projection', 'baseWidth', 'baseHeight', 'projectionRatio', 'upperSlopeDeg', 'turnDeg']) {
    assert.ok(d[k] < 0.02, `${k}: ${coarse[k]} vs ${fine[k]} (${(d[k] * 100).toFixed(2)}%)`);
  }
  // curvature-like metrics on an irregular coarse mesh: looser, still far
  // below the band widths (tilt bands are 5-10 deg, convexity bands 0.04-0.05)
  assert.ok(Math.abs(coarse.tiltDeg - fine.tiltDeg) < 1, `tilt ${coarse.tiltDeg} vs ${fine.tiltDeg}`);
  assert.ok(Math.abs(coarse.upperConvexity - fine.upperConvexity) < 0.01);
  assert.ok(Math.abs(coarse.lowerConvexity - fine.lowerConvexity) < 0.01);
});

test('resolution: midpoint subdivision (same surface, 4x the triangles) gives the same numbers', () => {
  const s = synthTorso({ h: 0.02, bUp: 0.13, bLo: 0.17 });
  const sub = midpointSubdivide(s.pos, s.index);
  const a = measure(s).sides[0];
  const b = measure({ ...s, pos: sub.pos, index: sub.index }).sides[0];
  for (const { key } of METRICS) {
    if (a[key] == null) continue;
    assert.ok(Math.abs(a[key] - b[key]) <= 1e-9 * Math.max(1, Math.abs(a[key])), `${key}: ${a[key]} vs ${b[key]}`);
  }
});

test('a cap symmetric about its apex measures 50:50, zero tilt, zero divergence', () => {
  const r = measure(synthTorso({ h: 0.01, flatChest: true, bUp: 0.15, bLo: 0.15, aLat: 0.15, aMed: 0.15 }));
  for (const m of r.sides) {
    assert.ok(m.ok, m.flags.join(','));
    assert.ok(Math.abs(m.upperPoleFrac - 0.5) < 0.005, `UP ${m.upperPoleFrac}`);
    assert.ok(Math.abs(m.tiltDeg) < 0.3, `tilt ${m.tiltDeg}`);
    assert.ok(Math.abs(m.divergenceDeg) < 0.3, `divergence ${m.divergenceDeg}`);
    assert.ok(Math.abs(m.upperConvexity - m.lowerConvexity) < 0.002, `${m.upperConvexity} vs ${m.lowerConvexity}`);
    assert.ok(Math.abs(m.nipple[1] - m.apex[1]) < 0.002);
  }
});

test('landmarks sit where the construction puts them', () => {
  // sharp crease (softplus width k) so the fold is at the cap rim
  const s = synthTorso({ h: 0.004, k: 0.004, flatChest: true, x: [-0.6, 0.6], y: [-0.2, 0.75] });
  const m = measure(s).sides[0];
  const p = s.params;
  // apex at the cap centre, projection = P over the plane chest (softplus adds ~k ln2 at the rim only)
  assert.ok(Math.abs(m.apex[0] - p.xc) < 0.003 && Math.abs(m.apex[1] - p.yc) < 0.003, `apex ${m.apex}`);
  assert.ok(Math.abs(m.projection - p.P) < 0.01, `projection ${m.projection}`);
  // IMF = lower rim of the cap (fold), base height ~ bUp + bLo minus the edgeFrac rims
  // the knee is a soft argmax: on a fold that is steep above and flat below it
  // leans toward the flat side by ~(1 - kneeFrac) * depth / slope (here 0.007)
  assert.ok(Math.abs(m.imfY - (p.yc - p.bLo)) < 0.01, `imf ${m.imfY} vs ${p.yc - p.bLo}`);
  assert.ok(m.baseHeight < p.bUp + p.bLo && m.baseHeight > 0.8 * (p.bUp + p.bLo), `base height ${m.baseHeight}`);
  assert.ok(Math.abs(m.baseWidth - (p.aLat + p.aMed)) < 0.06, `base width ${m.baseWidth}`);
});

test('left and right sides of a mirror-symmetric mesh measure the same', () => {
  // h = 0.01 -> odd column count, so the alternating diagonals mirror exactly
  const r = measure(synthTorso({ h: 0.01, bUp: 0.13, bLo: 0.17, aLat: 0.17, aMed: 0.13 }));
  const [L, R] = r.sides;
  for (const { key } of METRICS) assert.ok(Math.abs(L[key] - R[key]) < 1e-9, `${key} ${L[key]} vs ${R[key]}`);
});

test('metrics are invariant to rigid motion and uniform scale of bind space', () => {
  const s = synthTorso({ h: 0.02, bUp: 0.13, bLo: 0.17 });
  const a = measure(s).mean;
  // rotate 30 deg about (1, 2, 0.5), scale 2.57 (MMD-like units), translate
  const k = [1, 2, 0.5].map((v) => v / Math.hypot(1, 2, 0.5)), th = Math.PI / 6, c = Math.cos(th), sn = Math.sin(th);
  const R = (v) => {
    const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [0, 1, 2].map((i) => v[i] * c + x[i] * sn + k[i] * d * (1 - c));
  };
  const sc = 2.57, t = [0.3, 15.5, -0.06];
  const P = new Float64Array(s.pos.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = R([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
    for (let j = 0; j < 3; j++) P[i + j] = q[j] * sc + t[j];
  }
  const frame = { origin: t, left: R([1, 0, 0]), up: R([0, 1, 0]), forward: R([0, 0, 1]), S: sc, hipsY: -sc, neckY: sc };
  const apex = s.apex.map((p) => R(p).map((v, j) => v * sc + t[j]));
  const b = measureBust({ frame, meshes: [{ pos: P, index: s.index }], apex }).mean;
  for (const { key } of METRICS) assert.ok(Math.abs(a[key] - b[key]) < 1e-6 * Math.max(1, Math.abs(a[key])), `${key}: ${a[key]} vs ${b[key]}`);
});

test('shape responses: fuller lower pole tilts up, fuller lateral side points inward, concave/straight/convex poles classify', () => {
  const tilt = [0.19, 0.16, 0.13].map((bLo) => measure(synthTorso({ h: 0.01, bUp: 0.15, bLo })).mean);
  assert.ok(tilt[0].tiltDeg > tilt[1].tiltDeg && tilt[1].tiltDeg > tilt[2].tiltDeg, tilt.map((m) => m.tiltDeg).join(' '));
  assert.ok(tilt[0].upperPoleFrac < tilt[1].upperPoleFrac && tilt[1].upperPoleFrac < tilt[2].upperPoleFrac);
  const div = [0.12, 0.15, 0.18].map((aLat) => measure(synthTorso({ h: 0.01, flatChest: true, aLat, aMed: 0.15 })).mean.divergenceDeg);
  assert.ok(div[0] > 0 && Math.abs(div[1]) < 0.3 && div[2] < 0, div.join(' '));
  for (const shape of ['concave', 'straight', 'convex']) {
    const m = measure(synthTorso({ h: 0.01, type: 'profile', upper: shape, flatChest: true })).sides[0];
    assert.equal(m.upperShape, shape, `${shape}: ${m.upperConvexity}`);
    assert.equal(m.lowerShape, 'convex');
  }
});

test('weights apply deltas exactly like measuring a pre-deformed mesh', () => {
  const s = synthTorso({ h: 0.02 });
  const n = s.pos.length / 3;
  const d = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) d[v * 3 + 1] = 0.05 * Math.exp(-((s.pos[v * 3] - 0.27) ** 2 + (s.pos[v * 3 + 1] - 0.27) ** 2) / 0.02); // lift
  const viaWeights = measureBust({ frame: s.frame, meshes: [{ pos: s.pos, index: s.index, deltas: { lift: d } }], apex: s.apex, weights: { lift: 0.7 } });
  const P = s.pos.map((v, i) => v + 0.7 * d[i]);
  const direct = measure({ ...s, pos: P });
  for (const { key } of METRICS) assert.ok(Math.abs(viaWeights.mean[key] - direct.mean[key]) < 1e-12 || viaWeights.mean[key] === direct.mean[key], key);
});

test('a hole in the measured surface (skin cut out under a garment) is flagged, not measured', () => {
  const s = synthTorso({ h: 0.02 });
  // drop the triangles over the lower pole of the left breast, add a back plate
  const keep = [];
  for (let t = 0; t < s.index.length; t += 3) {
    const c = [0, 1].map((k) => (s.pos[s.index[t] * 3 + k] + s.pos[s.index[t + 1] * 3 + k] + s.pos[s.index[t + 2] * 3 + k]) / 3);
    if (Math.abs(c[0] - 0.27) < 0.08 && c[1] > 0.15 && c[1] < 0.24) continue;
    keep.push(s.index[t], s.index[t + 1], s.index[t + 2]);
  }
  const back = s.pos.map((v, i) => (i % 3 === 2 ? -0.4 : v));
  const pos = new Float64Array(s.pos.length * 2);
  pos.set(s.pos);
  pos.set(back, s.pos.length);
  const nv = s.pos.length / 3;
  const index = Uint32Array.from([...keep, ...Array.from(s.index, (v) => v + nv)]);
  const r = measure({ ...s, pos, index });
  assert.ok(r.sides[0].flags.includes('hole') && !r.sides[0].ok, r.sides[0].flags.join(','));
  assert.ok(r.sides[1].ok);
  assert.ok(r.mean.ok && Math.abs(r.mean.upperPoleFrac - r.sides[1].upperPoleFrac) < 1e-12, 'mean uses the clean side only');
});

test('flat chest is flagged and not scored', () => {
  const r = measure(synthTorso({ h: 0.02, P: 0.01 }));
  assert.ok(r.sides.every((m) => m.flags.includes('flat') && !m.ok));
  assert.equal(scoreBands(r.mean, BANDS.natural).distance, null);
});

test('band score: 0 inside, grows with the gap, skips missing metrics, imfRise needs a reference', () => {
  const inside = { upperPoleFrac: 0.45, tiltDeg: 20, upperConvexity: -0.01, lowerConvexity: 0.05, imfY: 0.1 };
  const s0 = scoreBands(inside, BANDS.natural, { reference: { imfY: 0.12 } });
  assert.equal(s0.distance, 0);
  assert.ok(s0.inside);
  const s1 = scoreBands({ ...inside, tiltDeg: 30 }, BANDS.natural);
  const s2 = scoreBands({ ...inside, tiltDeg: 40 }, BANDS.natural);
  assert.ok(s1.distance > 0 && s2.distance > s1.distance && !s1.inside);
  assert.ok(s1.missing.includes('imfRise'), 'imfRise skipped without a reference');
  assert.ok(Math.abs(s1.per.tiltDeg.d - 0.5) < 1e-12);
  const anime = scoreBands({ upperPoleFrac: 0.5, tiltDeg: 27, upperConvexity: 0.03, lowerConvexity: 0.05, imfY: 0.13 }, BANDS.anime, { reference: { imfY: 0.12 } });
  assert.ok(anime.inside, JSON.stringify(anime.per));
  assert.ok(BANDS.anime.hypothesis);
});

test('selectTriangles keeps named material groups once (overlapping outline groups)', () => {
  const index = Uint32Array.from([0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5]);
  const groups = [
    { start: 0, count: 6, material: 'UP_Skin' },
    { start: 0, count: 6, material: 'UP_Skin (Outline)' },
    { start: 6, count: 3, material: 'Hair_Back' },
    { start: 9, count: 3, material: 'UP' },
  ];
  assert.deepEqual([...selectTriangles(index, 6, groups, { include: /skin/i })], [0, 1, 2, 1, 2, 3]);
  assert.deepEqual([...selectTriangles(index, 6, groups, { exclude: /hair/i })], [0, 1, 2, 1, 2, 3, 3, 4, 5]);
  assert.equal(selectTriangles(index, 6, [], {}).length, 12);
});

test('the real field moves the metrics the way its targets are named (synthetic torso)', () => {
  const s = synthTorso({ h: 0.01 });
  const frame = { ...SYNTH_FRAME, hipsY: -1.05, neckY: 1.0 };
  const params = cloneParams(DEFAULT_PARAMS);
  params.anchor = { x: s.params.xc, y: s.params.yc, z: 0.28 - params.depth };
  const field = createBustField(frame, params);
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const baked = bakeMesh({ positions: s.pos, normals: null, bindMatrix: I4, mask: null }, field);
  const deltas = Object.fromEntries(Object.entries(baked.targets).map(([k, v]) => [k, v.dPos]));
  const ctx = prepareMorpho({ frame, meshes: [{ pos: s.pos, tris: s.index, deltas }], apex: field.sides.map((x) => x.apex) });
  const m = (w) => measurePrepared(ctx, w).mean;
  const base = m(null), up = m({ bust_size_up_natural: 1 }), sty = m({ bust_size_up_stylized: 1 }), down = m({ bust_size_down: 1 });
  const lu = m({ bust_lift_up: 1 }), ld = m({ bust_lift_down: 1 });
  for (const x of [base, up, sty, down, lu, ld]) assert.ok(x.ok, x.flags.join(','));
  assert.ok(up.projection > base.projection && sty.projection > base.projection && down.projection < base.projection);
  assert.ok(lu.apexY > base.apexY && ld.apexY < base.apexY);
  assert.ok(lu.tiltDeg > base.tiltDeg && ld.tiltDeg < base.tiltDeg, `${ld.tiltDeg} ${base.tiltDeg} ${lu.tiltDeg}`);
  // stylized: apex up/forward vs natural: gravity
  assert.ok(sty.tiltDeg > up.tiltDeg && sty.upperPoleFrac < up.upperPoleFrac);
  // probe cost stays HUD friendly
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) m({ bust_size_up_stylized: i / 5 });
  assert.ok((performance.now() - t0) / 5 < 100);
});

test('defaults are serializable data (shared with the Python mirror)', () => {
  const o = JSON.parse(JSON.stringify(MORPHO_DEFAULTS));
  assert.equal(o.axisDepths.length, 17);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(BANDS))), ['natural', 'anime']);
});

test('bind exports are baked in bind space even when the source mesh has a transform', () => {
  const params = cloneParams(DEFAULT_PARAMS);
  const pos = Float32Array.from([0.24, 0.05, 0.4, -0.24, 0.05, 0.4]);
  const mask = Float32Array.from([1, 0.6]);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Exported positions are already bind-space points. This matrix records
  // the original mesh transform solely for eventual local-space output.
  const transform = [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 0.5, 0, 5, -2, 7, 1];
  const mesh = { pos, mask, bindMatrix: transform };
  const { field, deltas } = bakeBind({ frame: SYNTH_FRAME, meshes: [mesh] }, params);
  const canonical = bakeBind({ frame: SYNTH_FRAME, meshes: [{ ...mesh, bindMatrix: identity }] }, params);
  for (const name of field.targets) {
    for (let v = 0; v < pos.length / 3; v++) {
      const expected = field.delta(name, Array.from(pos.subarray(v * 3, v * 3 + 3)));
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(deltas[0][name][v * 3 + j] - expected[j] * mask[v]) < 1e-8, `${name} vertex ${v} axis ${j}`);
    }
    assert.deepEqual(deltas[0][name], canonical.deltas[0][name]);
  }
});

test('flagged side metrics and flagged IMF references are never scored', () => {
  const r = measure(synthTorso({ h: 0.02, P: 0.01 }));
  const invalid = r.sides[0];
  assert.equal(invalid.ok, false);
  assert.equal(scoreBands(invalid, BANDS.natural).distance, null);
  const valid = { ok: true, upperPoleFrac: 0.45, tiltDeg: 20, imfY: 0.1 };
  const score = scoreBands(valid, BANDS.natural, { reference: { ok: false, imfY: 0.12 } });
  assert.ok(score.missing.includes('imfRise'));
});
